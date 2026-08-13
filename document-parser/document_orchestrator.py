from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from document_processing import extract_text, is_image_document, to_data_uri
from document_identity import build_document_identity
from firebase_processed_files import (
	build_firebase_tracker,
	check_drive_documents_to_process,
)
from firebase_workspace_config import (
	FirebaseWorkspaceConfigManager,
	RuleObject,
	WorkspaceConfig,
)
from google_drive_service import (
	DRIVE_FILE_SCOPE,
	DRIVE_METADATA_READONLY_SCOPE,
	GoogleDriveConfigError,
	build_drive_service,
	move_file_to_path,
	scan_drive_supported_documents,
)
from google_oauth_credentials import GOOGLE_OAUTH_SCOPES, GoogleOAuthConfigError, build_google_oauth_credentials
from google_sheets_service import GoogleSheetsConfigError, append_row_to_google_sheet
from receipt_ai import extract_receipt_json, extract_receipt_json_from_image, extract_receipt_json_from_pdf, extract_receipt_json_from_document
from receipt_results import build_empty_result
from rule_selection import select_rule_for_document


load_dotenv()


logger = logging.getLogger(__name__)
if not logger.handlers:
	handler = logging.StreamHandler()
	handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
	logger.addHandler(handler)
logger.setLevel(logging.DEBUG)
logger.propagate = False


SHEET_COLUMNS = ["invoice_date", "source_file", "display_description", "total"]
CORRUPTED_SHEET_NAME = "corrupted data"


def _build_display_description(parsed: dict[str, Any]) -> str:
	provider_name = str(parsed.get("supplier_name") or "").strip()
	provider_cuit = str(parsed.get("supplier_tax_id") or "").strip()
	city = str(parsed.get("ciudad") or parsed.get("city") or "").strip()
	parts = [part for part in [provider_name, provider_cuit, city] if part]
	return " - ".join(parts)


def _build_sheet_row(parsed: dict[str, Any]) -> dict[str, Any]:
	return {
		"invoice_date": parsed.get("invoice_date"),
		"source_file": parsed.get("source_file"),
		"display_description": _build_display_description(parsed),
		"total": parsed.get("total"),
	}


def _is_blank_sheet_value(value: Any) -> bool:
	if value is None:
		return True

	if isinstance(value, str):
		return not value.strip()

	return False


def _is_complete_sheet_row(row: dict[str, Any]) -> bool:
	return all(not _is_blank_sheet_value(row.get(column)) for column in SHEET_COLUMNS)


def _create_openai_client_from_key(api_key: str) -> OpenAI:
	"""Create OpenAI client from API key."""
	if not api_key.strip():
		raise RuntimeError("Missing OPENAI_API_KEY.")
	return OpenAI(api_key=api_key)


def _get_openai_api_key_from_env() -> str:
	return (os.getenv("OPENAI_API_KEY") or "").strip()


def _parse_invoice_date(value: Any) -> datetime | None:
	text = str(value or "").strip()
	if not text:
		return None

	for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
		try:
			return datetime.strptime(text, fmt)
		except ValueError:
			continue

	try:
		return datetime.fromisoformat(text.replace("Z", "+00:00"))
	except ValueError:
		return None


def _resolve_drive_destination_path(parsed: dict[str, Any]) -> tuple[str, bool]:
	base_path = (os.getenv("GOOGLE_DRIVE_INVOICES_BASE_PATH") or "Facturas").strip().strip("/") or "Facturas"

	row_for_sheet = _build_sheet_row(parsed)
	if not _is_complete_sheet_row(row_for_sheet):
		return f"Corrupted", True

	invoice_date = _parse_invoice_date(parsed.get("invoice_date"))
	if invoice_date is None:
		return f"Corrupted", True

	return f"{invoice_date.strftime('%Y%m')}", False


def _build_drive_file_url(file_id: str) -> str:
	return f"https://drive.google.com/file/d/{file_id}/view"


def _build_hyperlink_formula(url: str, label: str) -> str:
	safe_url = str(url).replace('"', '""')
	safe_label = str(label).replace('"', '""')
	return f'=HYPERLINK("{safe_url}","{safe_label}")'


def _parse_document(
	client: OpenAI,
	model: str,
	local_path: str,
	source_file: str,
	schema_id: str,
) -> dict[str, Any]:
	path = Path(local_path)
	
	# Debug: Check if file exists
	if not path.exists():
		logger.error("Document file does not exist: %s", local_path)
		return build_empty_result(source_file)
	
	logger.debug("Parsing document: %s (size: %s bytes)", local_path, path.stat().st_size)
	
	try:
		# Send all documents in their original format to OpenAI
		file_type = path.suffix.lower()
		
		if file_type in {".jpg", ".jpeg", ".png"}:
			# Send image in original format
			logger.debug("Sending image in original format to OpenAI")
			parsed = extract_receipt_json_from_image(client, model, path, to_data_uri(path), schema_id)
		
		elif file_type == ".pdf":
			# Send PDF in original format
			logger.debug("Sending PDF in original format to OpenAI")
			parsed = extract_receipt_json_from_pdf(client, model, path, schema_id)
		
		else:
			# Send other document types (TXT, DOCX, etc) in original format
			logger.debug("Sending %s in original format to OpenAI", file_type)
			parsed = extract_receipt_json_from_document(client, model, path, schema_id)
		
		parsed["source_file"] = source_file
		return parsed
	
	except Exception as exc:
		logger.exception("Error parsing document %s: %s", local_path, exc)
		parsed = build_empty_result(source_file)
		parsed["source_file"] = source_file
		return parsed


def orchestrate_single_rule(
	workspace_id: str,
	workspace_config: WorkspaceConfig,
	rule: RuleObject,
	model: str,
	include_subfolders: bool = True,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	"""Orchestrate document processing for a single rule of a workspace.
	
	Args:
		workspace_id: Unique workspace identifier
		workspace_config: Workspace configuration
		rule: The processing rule to orchestrate
		model: OpenAI model to use for parsing
		include_subfolders: Whether to include subfolders when scanning Drive
		send_to_sheet: Whether to append results to Google Sheets
	
	Returns:
		Summary dict with processing results
	"""
	logger.info(
		"Starting orchestration for workspace=%s rule=%s model=%s",
		workspace_id,
		rule.rule_id,
		model,
	)
	
	openai_api_key = _get_openai_api_key_from_env()
	if not openai_api_key:
		logger.error("Workspace=%s rule=%s missing OPENAI_API_KEY environment variable", workspace_id, rule.rule_id)
		return {
			"ok": False,
			"error": "Missing OPENAI_API_KEY environment variable",
			"workspace_id": workspace_id,
			"rule_id": rule.rule_id,
		}
	
	if not workspace_config.credentials.google_refresh_token:
		logger.error("Workspace=%s rule=%s missing refresh_token", workspace_id, rule.rule_id)
		return {
			"ok": False,
			"error": f"Workspace {workspace_id} missing Google OAuth refresh token",
			"workspace_id": workspace_id,
			"rule_id": rule.rule_id,
		}
	
	# Set up clients for this workspace
	try:
		client = _create_openai_client_from_key(openai_api_key)
		tracker = build_firebase_tracker(workspace_id=workspace_id, rule_id=rule.rule_id)
		extraction_scheme = FirebaseWorkspaceConfigManager().get_extraction_scheme(rule.schema_id)
	except RuntimeError as exc:
		logger.error("Workspace=%s rule=%s failed to initialize clients: %s", workspace_id, rule.rule_id, exc)
		return {
			"ok": False,
			"error": str(exc),
			"workspace_id": workspace_id,
			"rule_id": rule.rule_id,
		}
	
	# Set up Google Drive service with workspace credentials
	scan_temp_dir: str | None = None
	try:
		google_credentials = build_google_oauth_credentials(
			workspace_config.credentials.google_refresh_token,
			GOOGLE_OAUTH_SCOPES,
		)
		drive_service = build_drive_service(scope=[DRIVE_FILE_SCOPE, DRIVE_METADATA_READONLY_SCOPE], credentials=google_credentials)
		
		# Scan the rule's source folder
		scan_result = scan_drive_supported_documents(
			folder_ids=[rule.source_folder_id],
			include_subfolders=include_subfolders,
			service=drive_service,
		)
		drive_documents = scan_result.documents
		scan_temp_dir = scan_result.temp_dir
	except (GoogleDriveConfigError, GoogleOAuthConfigError) as exc:
		logger.error("Workspace=%s rule=%s Google Drive config error: %s", workspace_id, rule.rule_id, exc)
		return {
			"ok": False,
			"error": f"Google Drive configuration error: {exc}",
			"workspace_id": workspace_id,
			"rule_id": rule.rule_id,
		}
	
	logger.info(
		"Workspace=%s rule=%s scan completed documents_found=%s",
		workspace_id,
		rule.rule_id,
		len(drive_documents),
	)
	
	# Prepare docs payload
	docs_payload = [
		{
			"document_id": doc.document_id,
			"source_file": doc.source_file,
			"modificationDate": doc.modificationDate,
			"local_path": doc.local_path,
		}
		for doc in drive_documents
	]
	
	# Check which documents need processing
	to_process, skipped, tracking_warning = check_drive_documents_to_process(
		tracker,
		docs_payload,
		rule.schema_id,
		extraction_scheme["version"],
	)
	logger.info(
		"Workspace=%s rule=%s to_process=%s skipped=%s",
		workspace_id,
		rule.rule_id,
		len(to_process),
		len(skipped),
	)
	if tracking_warning:
		logger.warning("Workspace=%s rule=%s tracking warning: %s", workspace_id, rule.rule_id, tracking_warning)
	
	# Process documents
	parsed_count = 0
	modified_count = 0
	sent_count = 0
	moved_count = 0
	corrupted_count = 0
	error_items: list[dict[str, str]] = []
	processed_items: list[dict[str, Any]] = []
	
	for document in to_process:
		document_id = str(document.get("document_id") or "").strip()
		source_file = str(document.get("source_file") or "").strip()
		local_path = str(document.get("local_path") or "").strip()
		modification_date = document.get("modificationDate")
		status = str(document.get("target_status") or "Parsed")
		previous_identity_key = str(document.get("previous_identity_key") or "").strip() or None
		identity_key: str | None = None
		identity_claim_created = False
		identity_previously_present = False
		sent_to_sheet = False
		
		logger.info(
			"Workspace=%s rule=%s processing document_id=%s source_file=%s",
			workspace_id,
			rule.rule_id,
			document_id,
			source_file,
		)
		
		try:
			parsed = _parse_document(
				client,
				model,
				local_path,
				source_file,
				rule.schema_id,
			)
			logger.info(
				"Workspace=%s rule=%s parsed document_id=%s",
				workspace_id,
				rule.rule_id,
				document_id,
			)

			identity = build_document_identity(parsed, extraction_scheme["identity"])
			if identity is not None:
				identity_key = identity["identity_key"]
				parsed.update(identity)
				claim_result = tracker.claim_document_identity(
					identity=identity,
					source_document_id=document_id,
					source_file=source_file,
					schema_id=rule.schema_id,
					parsed_data=parsed,
					source_modified_at=modification_date,
					schema_version=extraction_scheme["version"],
					execution_mode="source_by_rule",
					selected_rule_id=rule.rule_id,
				)
				identity_claim_created = claim_result == "created"
				identity_previously_present = claim_result == "existing_source"
				if claim_result is None:
					logger.info(
						"Workspace=%s rule=%s skipping redundant document_id=%s identity=%s",
						workspace_id,
						rule.rule_id,
						document_id,
						identity_key,
					)
					skipped.append({
						"document_id": document_id,
						"source_file": source_file,
						"skip_reason": "duplicate_business_identity",
						"identity_key": identity_key,
					})
					continue
			else:
				logger.warning(
					"Workspace=%s rule=%s document_id=%s has no complete identity strategy",
					workspace_id,
					rule.rule_id,
					document_id,
				)
			
			# Determine destination and whether corrupted
			if identity_key is None:
				destination_path, is_corrupted = "Corrupted", True
			else:
				destination_path, is_corrupted = _resolve_drive_destination_path(parsed)
			if is_corrupted:
				corrupted_count += 1
			
			# Move file to destination (if target_folder_id is set)
			if rule.target_folder_id:
				move_file_to_path(
					service=drive_service,
					file_id=document_id,
					destination_path=destination_path,
					root_folder_id=rule.target_folder_id,
				)
				moved_count += 1
				logger.info(
					"Workspace=%s rule=%s moved document_id=%s to %s",
					workspace_id,
					rule.rule_id,
					document_id,
					destination_path,
				)
			
			# Save document record
			if identity_key is not None:
				tracker.save_document_record(
					identity_key=identity_key,
					drive_file_id=document_id,
					source_file=source_file,
					source_modified_at=modification_date,
					status="Corrupted" if is_corrupted else "Parsed",
					schema_id=rule.schema_id,
					schema_version=extraction_scheme["version"],
					execution_mode="source_by_rule",
					selected_rule_id=rule.rule_id,
					parsed_data=parsed,
				)
			else:
				tracker.save_source_record(
					drive_file_id=document_id,
					source_file=source_file,
					source_modified_at=modification_date,
					status="Corrupted" if is_corrupted else "Parsed",
					schema_id=rule.schema_id,
					schema_version=extraction_scheme["version"],
					execution_mode="source_by_rule",
					selected_rule_id=rule.rule_id,
					parsed_data=parsed,
				)
			if previous_identity_key and previous_identity_key != identity_key:
				tracker.release_document_identity(previous_identity_key, document_id)
			
			if status == "Modified":
				modified_count += 1
			else:
				parsed_count += 1
			
			# Send to Google Sheets if enabled
			worksheet_name: str | None = None
			if rule.target_sheet_id and send_to_sheet and not identity_previously_present and not is_corrupted:
				row_for_sheet = _build_sheet_row(parsed)
				row_for_sheet["source_file"] = _build_hyperlink_formula(
					_build_drive_file_url(document_id),
					source_file,
				)
				worksheet_name = "Corrupted_data" if not _is_complete_sheet_row(row_for_sheet) else rule.sheet_tab_name
				
				try:
					append_row_to_google_sheet(
						row_for_sheet,
						SHEET_COLUMNS,
						worksheet_name=worksheet_name,
						spreadsheet_id=rule.target_sheet_id,
						credentials=google_credentials,
					)
					logger.info(
						"Workspace=%s rule=%s sent document_id=%s to sheet=%s",
						workspace_id,
						rule.rule_id,
						document_id,
						worksheet_name,
					)
					if identity_key is not None:
						tracker.mark_document_sent(identity_key)
					sent_to_sheet = True
					sent_count += 1
				except GoogleSheetsConfigError as exc:
					logger.error(
						"Workspace=%s rule=%s sheet error for document_id=%s: %s",
						workspace_id,
						rule.rule_id,
						document_id,
						exc,
					)
					error_items.append({
						"document_id": document_id,
						"source_file": source_file,
						"error": f"Google Sheets error: {exc}",
					})
					continue
			elif rule.target_sheet_id and send_to_sheet and is_corrupted:
				logger.info(
					"Workspace=%s rule=%s skipping corrupted document_id=%s",
					workspace_id,
					rule.rule_id,
					document_id,
				)
			elif rule.target_sheet_id and send_to_sheet and identity_previously_present:
				logger.info(
					"Workspace=%s rule=%s skipping sheet append for existing document_id=%s identity=%s",
					workspace_id,
					rule.rule_id,
					document_id,
					identity_key,
				)
			
			processed_items.append({
				"document_id": document_id,
				"source_file": source_file,
				"modificationDate": modification_date,
				"status": "Corrupted" if is_corrupted else ("Sent" if sent_to_sheet else status),
				"destination_path": destination_path,
				"identity_key": identity_key,
			})
		
		except Exception as exc:
			if identity_claim_created and identity_key is not None:
				try:
					tracker.release_document_identity(identity_key, document_id)
				except Exception:
					logger.exception("Failed to release identity claim=%s", identity_key)
			logger.exception(
				"Workspace=%s rule=%s failed processing document_id=%s",
				workspace_id,
				rule.rule_id,
				document_id,
			)
			tracker.save_source_record(
				drive_file_id=document_id,
				source_file=source_file,
				source_modified_at=modification_date,
				status="Failed",
				schema_id=rule.schema_id,
				schema_version=extraction_scheme["version"],
				execution_mode="source_by_rule",
				selected_rule_id=rule.rule_id,
			)
			error_items.append({
				"document_id": document_id,
				"source_file": source_file,
				"error": str(exc),
			})
	
	# Cleanup
	if scan_temp_dir:
		shutil.rmtree(scan_temp_dir, ignore_errors=True)
		logger.info("Workspace=%s rule=%s cleaned up temp directory", workspace_id, rule.rule_id)
	
	logger.info(
		"Workspace=%s rule=%s orchestration finished parsed=%s modified=%s sent=%s moved=%s corrupted=%s errors=%s",
		workspace_id,
		rule.rule_id,
		parsed_count,
		modified_count,
		sent_count,
		moved_count,
		corrupted_count,
		len(error_items),
	)
	
	return {
		"ok": True,
		"workspace_id": workspace_id,
		"rule_id": rule.rule_id,
		"rule_name": rule.rule_name,
		"scanned": len(drive_documents),
		"to_process": len(to_process),
		"skipped": len(skipped),
		"parsed": parsed_count,
		"modified": modified_count,
		"sent": sent_count,
		"moved": moved_count,
		"corrupted": corrupted_count,
		"tracking_warning": tracking_warning,
		"processed_items": processed_items,
		"skipped_items": skipped,
		"errors": error_items,
	}


def _build_rule_set_version(rules: list[RuleObject]) -> str:
	payload = [
		{
			"rule_id": rule.rule_id,
			"priority": rule.priority,
			"condition_mode": rule.condition_mode,
			"conditions": rule.conditions or [],
			"is_enabled": rule.is_enabled,
		}
		for rule in sorted(rules, key=lambda item: item.rule_id)
	]
	rendered = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
	return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def orchestrate_single_source(
	workspace_id: str,
	workspace_config: WorkspaceConfig,
	rules: list[RuleObject],
	model: str,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	"""Scan one workspace inbox, parse once, select one rule, and execute its actions."""
	routing = workspace_config.routing
	if routing is None or not routing.inbox_folder_id:
		return {
			"ok": False,
			"workspace_id": workspace_id,
			"execution_mode": "single_source",
			"error": "Workspace single_source routing requires inbox_folder_id.",
		}

	openai_api_key = _get_openai_api_key_from_env()
	if not openai_api_key:
		return {
			"ok": False,
			"workspace_id": workspace_id,
			"execution_mode": "single_source",
			"error": "Missing OPENAI_API_KEY environment variable",
		}
	if not workspace_config.credentials.google_refresh_token:
		return {
			"ok": False,
			"workspace_id": workspace_id,
			"execution_mode": "single_source",
			"error": f"Workspace {workspace_id} missing Google OAuth refresh token",
		}

	enabled_rules = [rule for rule in rules if rule.is_enabled]
	rule_set_version = _build_rule_set_version(enabled_rules)
	config_manager = FirebaseWorkspaceConfigManager()
	try:
		client = _create_openai_client_from_key(openai_api_key)
		tracker = build_firebase_tracker(
			workspace_id=workspace_id,
			legacy_rule_ids=[rule.rule_id for rule in enabled_rules],
		)
		extraction_scheme = config_manager.get_extraction_scheme(routing.schema_id)
		run_id = tracker.start_run("single_source")
	except RuntimeError as exc:
		return {
			"ok": False,
			"workspace_id": workspace_id,
			"execution_mode": "single_source",
			"error": str(exc),
		}

	scan_temp_dir: str | None = None
	try:
		google_credentials = build_google_oauth_credentials(
			workspace_config.credentials.google_refresh_token,
			GOOGLE_OAUTH_SCOPES,
		)
		drive_service = build_drive_service(
			scope=[DRIVE_FILE_SCOPE, DRIVE_METADATA_READONLY_SCOPE],
			credentials=google_credentials,
		)
		scan_result = scan_drive_supported_documents(
			folder_ids=[routing.inbox_folder_id],
			include_subfolders=routing.include_subfolders,
			service=drive_service,
		)
		drive_documents = scan_result.documents
		scan_temp_dir = scan_result.temp_dir
	except (GoogleDriveConfigError, GoogleOAuthConfigError) as exc:
		summary = {"scanned": 0, "parsed": 0, "matched": 0, "unmatched": 0, "errors": 1}
		tracker.finish_run(run_id, "failed", summary)
		return {
			"ok": False,
			"workspace_id": workspace_id,
			"execution_mode": "single_source",
			"error": f"Google Drive configuration error: {exc}",
			**summary,
		}

	docs_payload = [
		{
			"document_id": document.document_id,
			"source_file": document.source_file,
			"modificationDate": document.modificationDate,
			"local_path": document.local_path,
		}
		for document in drive_documents
	]
	to_process, skipped, tracking_warning = check_drive_documents_to_process(
		tracker,
		docs_payload,
		routing.schema_id,
		extraction_scheme["version"],
		rule_set_version,
	)

	parsed_count = 0
	modified_count = 0
	matched_count = 0
	unmatched_count = 0
	sent_count = 0
	moved_count = 0
	corrupted_count = 0
	error_items: list[dict[str, str]] = []
	processed_items: list[dict[str, Any]] = []

	for document in to_process:
		document_id = str(document.get("document_id") or "").strip()
		source_file = str(document.get("source_file") or "").strip()
		local_path = str(document.get("local_path") or "").strip()
		modification_date = document.get("modificationDate")
		previous_identity_key = str(document.get("previous_identity_key") or "").strip() or None
		identity_key: str | None = None
		identity_claim_created = False
		try:
			parsed = _parse_document(client, model, local_path, source_file, routing.schema_id)
			selected_rule = select_rule_for_document(client, model, parsed, enabled_rules)
			identity = build_document_identity(parsed, extraction_scheme["identity"])
			if identity is not None:
				identity_key = identity["identity_key"]
				parsed.update(identity)
				claim_result = tracker.claim_document_identity(
					identity,
					document_id,
					source_file,
					routing.schema_id,
					parsed,
					modification_date,
					extraction_scheme["version"],
					"single_source",
					selected_rule.rule_id if selected_rule else None,
					rule_set_version,
				)
				identity_claim_created = claim_result == "created"
				if claim_result is None:
					skipped.append({
						"document_id": document_id,
						"source_file": source_file,
						"skip_reason": "duplicate_business_identity",
						"identity_key": identity_key,
					})
					continue

			if selected_rule is None:
				unmatched_count += 1
				if identity_key:
					tracker.save_document_record(
						identity_key=identity_key,
						drive_file_id=document_id,
						source_file=source_file,
						source_modified_at=modification_date,
						status="Unmatched",
						parsed_data=parsed,
						schema_id=routing.schema_id,
						schema_version=extraction_scheme["version"],
						execution_mode="single_source",
						rule_set_version=rule_set_version,
					)
				else:
					tracker.save_source_record(
						document_id,
						source_file,
						modification_date,
						"Unmatched",
						schema_id=routing.schema_id,
						schema_version=extraction_scheme["version"],
						execution_mode="single_source",
						parsed_data=parsed,
						rule_set_version=rule_set_version,
					)
				processed_items.append({
					"document_id": document_id,
					"source_file": source_file,
					"status": "Unmatched",
					"selected_rule_id": None,
				})
			else:
				matched_count += 1
				destination_path, is_corrupted = (
					("Corrupted", True) if identity_key is None else _resolve_drive_destination_path(parsed)
				)
				if is_corrupted:
					corrupted_count += 1

				actions = selected_rule.actions or {}
				move_enabled = actions.get("move_to_folder", bool(selected_rule.target_folder_id))
				sheet_enabled = actions.get("append_to_sheet", bool(selected_rule.target_sheet_id))
				if move_enabled and selected_rule.target_folder_id:
					move_file_to_path(
						service=drive_service,
						file_id=document_id,
						destination_path=destination_path,
						root_folder_id=selected_rule.target_folder_id,
					)
					moved_count += 1

				sent_to_sheet = False
				if sheet_enabled and selected_rule.target_sheet_id and send_to_sheet and not is_corrupted:
					row_for_sheet = _build_sheet_row(parsed)
					row_for_sheet["source_file"] = _build_hyperlink_formula(
						_build_drive_file_url(document_id),
						source_file,
					)
					append_row_to_google_sheet(
						row_for_sheet,
						SHEET_COLUMNS,
						worksheet_name=selected_rule.sheet_tab_name,
						spreadsheet_id=selected_rule.target_sheet_id,
						credentials=google_credentials,
					)
					sent_to_sheet = True
					sent_count += 1

				final_status = "Corrupted" if is_corrupted else ("Sent" if sent_to_sheet else ("Moved" if move_enabled else "Matched"))
				if identity_key:
					tracker.save_document_record(
						identity_key=identity_key,
						drive_file_id=document_id,
						source_file=source_file,
						source_modified_at=modification_date,
						status=final_status,
						parsed_data=parsed,
						schema_id=routing.schema_id,
						schema_version=extraction_scheme["version"],
						execution_mode="single_source",
						selected_rule_id=selected_rule.rule_id,
						rule_set_version=rule_set_version,
					)
				else:
					tracker.save_source_record(
						document_id,
						source_file,
						modification_date,
						final_status,
						schema_id=routing.schema_id,
						schema_version=extraction_scheme["version"],
						execution_mode="single_source",
						selected_rule_id=selected_rule.rule_id,
						parsed_data=parsed,
						rule_set_version=rule_set_version,
					)
				processed_items.append({
					"document_id": document_id,
					"source_file": source_file,
					"status": final_status,
					"selected_rule_id": selected_rule.rule_id,
					"destination_path": destination_path,
				})

			if previous_identity_key and previous_identity_key != identity_key:
				tracker.release_document_identity(previous_identity_key, document_id)
			if str(document.get("target_status") or "Parsed") == "Modified":
				modified_count += 1
			else:
				parsed_count += 1
		except Exception as exc:
			if identity_claim_created and identity_key:
				tracker.release_document_identity(identity_key, document_id)
			tracker.save_source_record(
				document_id,
				source_file,
				modification_date,
				"Failed",
				schema_id=routing.schema_id,
				schema_version=extraction_scheme["version"],
				execution_mode="single_source",
				rule_set_version=rule_set_version,
			)
			logger.exception("Workspace=%s failed processing document_id=%s", workspace_id, document_id)
			error_items.append({"document_id": document_id, "source_file": source_file, "error": str(exc)})

	if scan_temp_dir:
		shutil.rmtree(scan_temp_dir, ignore_errors=True)

	summary = {
		"scanned": len(drive_documents),
		"to_process": len(to_process),
		"skipped": len(skipped),
		"parsed": parsed_count,
		"modified": modified_count,
		"matched": matched_count,
		"unmatched": unmatched_count,
		"sent": sent_count,
		"moved": moved_count,
		"corrupted": corrupted_count,
		"errors": len(error_items),
	}
	tracker.finish_run(run_id, "completed" if not error_items else "completed_with_errors", summary)
	return {
		"ok": True,
		"workspace_id": workspace_id,
		"workspace_name": workspace_config.name,
		"execution_mode": "single_source",
		"tracking_warning": tracking_warning,
		"processed_items": processed_items,
		"skipped_items": skipped,
		"error_items": error_items,
		**summary,
	}


def orchestrate_workspace(
	workspace_id: str,
	workspace_config: WorkspaceConfig,
	rules: list[RuleObject],
	model: str,
	include_subfolders: bool = True,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	enabled_rules = [rule for rule in rules if rule.is_enabled]
	if workspace_config.execution_mode == "single_source":
		return orchestrate_single_source(
			workspace_id=workspace_id,
			workspace_config=workspace_config,
			rules=enabled_rules,
			model=model,
			send_to_sheet=send_to_sheet,
		)

	if not enabled_rules:
		return {
			"ok": True,
			"workspace_id": workspace_id,
			"workspace_name": workspace_config.name,
			"execution_mode": "source_by_rule",
			"warning": "No enabled rules",
			"rules_processed": 0,
			"rules_results": [],
			"parsed": 0,
			"modified": 0,
			"sent": 0,
			"moved": 0,
			"corrupted": 0,
			"errors": 0,
		}

	tracker = build_firebase_tracker(workspace_id=workspace_id)
	run_id = tracker.start_run("source_by_rule")
	rules_results = [
		orchestrate_single_rule(
			workspace_id=workspace_id,
			workspace_config=workspace_config,
			rule=rule,
			model=model,
			include_subfolders=include_subfolders,
			send_to_sheet=send_to_sheet,
		)
		for rule in enabled_rules
	]
	summary = {
		"rules_processed": len(rules_results),
		"parsed": sum(result.get("parsed", 0) for result in rules_results if result.get("ok")),
		"modified": sum(result.get("modified", 0) for result in rules_results if result.get("ok")),
		"sent": sum(result.get("sent", 0) for result in rules_results if result.get("ok")),
		"moved": sum(result.get("moved", 0) for result in rules_results if result.get("ok")),
		"corrupted": sum(result.get("corrupted", 0) for result in rules_results if result.get("ok")),
		"errors": sum(len(result.get("errors", [])) for result in rules_results),
	}
	status = "completed" if all(result.get("ok") for result in rules_results) and not summary["errors"] else "completed_with_errors"
	tracker.finish_run(run_id, status, summary)
	return {
		"ok": True,
		"workspace_id": workspace_id,
		"workspace_name": workspace_config.name,
		"execution_mode": "source_by_rule",
		"rules_results": rules_results,
		**summary,
	}


def orchestrate_all_active_workspaces(
	model: str,
	include_subfolders: bool = True,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	"""Orchestrate all active workspaces and their enabled rules.
	
	This is the main workspace entry point that:
	1. Loads all active workspaces from Firebase
	2. Processes enabled rules for each workspace
	3. Aggregates results across all workspaces
	
	Args:
		model: OpenAI model to use for parsing
		include_subfolders: Whether to include subfolders when scanning Drive
		send_to_sheet: Whether to append results to Google Sheets
	
	Returns:
		Summary dict with aggregated processing results
	"""
	logger.info(
		"Starting multi-workspace orchestration model=%s include_subfolders=%s send_to_sheet=%s",
		model,
		include_subfolders,
		send_to_sheet,
	)
	
	# Load all active workspaces from Firebase
	config_manager = FirebaseWorkspaceConfigManager()
	
	try:
		active_workspaces = config_manager.list_active_workspaces()
	except Exception as exc:
		logger.error("Failed to load active workspaces: %s", exc)
		return {
			"ok": False,
			"error": f"Failed to load workspaces: {exc}",
			"workspaces_processed": 0,
		}
	
	logger.info("Loaded %s active workspaces", len(active_workspaces))
	
	# Firestore is the authoritative source for workspace configuration.
	if not active_workspaces:
		return {
			"ok": False,
			"error": "No active workspaces found in Firebase",
			"workspaces_processed": 0,
			"workspace_results": [],
		}
	
	# Process each workspace and its rules
	workspace_results = []
	total_parsed = 0
	total_modified = 0
	total_sent = 0
	total_moved = 0
	total_corrupted = 0
	total_errors = 0
	
	for workspace in active_workspaces:
		workspace_id = workspace.workspace_id
		logger.info("Processing workspace=%s name=%s", workspace_id, workspace.name)
		
		# Get enabled rules from the workspace rules subcollection
		enabled_rules = config_manager.get_enabled_rules(workspace_id)
		logger.info("Workspace=%s has %s enabled rules", workspace_id, len(enabled_rules))
		
		workspace_result = orchestrate_workspace(
			workspace_id=workspace_id,
			workspace_config=workspace,
			rules=enabled_rules,
			model=model,
			include_subfolders=include_subfolders,
			send_to_sheet=send_to_sheet,
		)
		workspace_parsed = workspace_result.get("parsed", 0)
		workspace_modified = workspace_result.get("modified", 0)
		workspace_sent = workspace_result.get("sent", 0)
		workspace_moved = workspace_result.get("moved", 0)
		workspace_corrupted = workspace_result.get("corrupted", 0)
		workspace_errors = workspace_result.get("errors", 0)
		
		total_parsed += workspace_parsed
		total_modified += workspace_modified
		total_sent += workspace_sent
		total_moved += workspace_moved
		total_corrupted += workspace_corrupted
		total_errors += workspace_errors
		
		workspace_results.append(workspace_result)
	
	logger.info(
		"Multi-workspace orchestration completed workspaces=%s parsed=%s modified=%s sent=%s moved=%s corrupted=%s errors=%s",
		len(workspace_results),
		total_parsed,
		total_modified,
		total_sent,
		total_moved,
		total_corrupted,
		total_errors,
	)
	
	return {
		"ok": True,
		"workspaces_processed": len(workspace_results),
		"total_parsed": total_parsed,
		"total_modified": total_modified,
		"total_sent": total_sent,
		"total_moved": total_moved,
		"total_corrupted": total_corrupted,
		"total_errors": total_errors,
		"workspace_results": workspace_results,
	}


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Orchestrate Drive documents using workspace Firebase configuration."
	)
	parser.add_argument(
		"--model",
		default=os.getenv("OPENAI_MODEL", "gpt-4o"),
		help="OpenAI model name."
	)
	parser.add_argument(
		"--no-subfolders",
		action="store_true",
		help="Only scan direct files in configured Drive folders.",
	)
	parser.add_argument(
		"--send",
		action="store_true",
		help="After parsing, append each row to Google Sheets and mark status as Sent.",
	)
	parser.add_argument(
		"--output",
		default="",
		help="Optional output JSON path for the orchestration summary.",
	)
	return parser.parse_args()


def main() -> int:
	args = parse_args()
	logger.info(
		"Running document orchestration CLI in multi-workspace mode output=%s",
		args.output or "stdout",
	)
	
	logger.info("Loading all active workspaces from Firebase")
	summary = orchestrate_all_active_workspaces(
		model=args.model,
		include_subfolders=not args.no_subfolders,
		send_to_sheet=args.send,
	)

	rendered = json.dumps(summary, indent=2, ensure_ascii=False)
	if args.output:
		output_path = Path(args.output)
		output_path.parent.mkdir(parents=True, exist_ok=True)
		output_path.write_text(rendered, encoding="utf-8")
		logger.info("Wrote orchestration summary to %s", output_path)
	else:
		logger.info("Orchestration summary:\n%s", rendered)

	return 0 if summary.get("ok") else 1


if __name__ == "__main__":
	raise SystemExit(main())
