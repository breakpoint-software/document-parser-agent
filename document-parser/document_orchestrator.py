from __future__ import annotations

import argparse
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
from firebase_processed_files import (
	build_firebase_tracker,
	check_drive_documents_to_process,
)
from firebase_tenant_config import (
	FirebaseTenantConfigManager,
	CredentialsObject,
	RuleObject,
	TenantConfig,
)
from google_drive_service import (
	DRIVE_FULL_SCOPE,
	GoogleDriveConfigError,
	build_drive_service,
	move_file_to_path,
	scan_drive_supported_documents,
)
from google_oauth_credentials import GoogleOAuthConfigError, build_google_oauth_credentials
from google_sheets_service import SCOPES as GOOGLE_SHEETS_SCOPES
from google_sheets_service import GoogleSheetsConfigError, append_row_to_google_sheet
from receipt_ai import extract_receipt_json, extract_receipt_json_from_image, extract_receipt_json_from_pdf, extract_receipt_json_from_document
from receipt_results import build_empty_result


load_dotenv()


logger = logging.getLogger(__name__)
if not logger.handlers:
	handler = logging.StreamHandler()
	handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
	logger.addHandler(handler)
logger.setLevel(logging.DEBUG)
logger.propagate = False


SHEET_COLUMNS = ["fecha", "source_file", "display_description", "total"]
CORRUPTED_SHEET_NAME = "corrupted data"


def _build_display_description(parsed: dict[str, Any]) -> str:
	provider_name = str(parsed.get("description_proveedor") or "").strip()
	provider_cuit = str(parsed.get("cuit_proveedor") or "").strip()
	city = str(parsed.get("ciudad") or parsed.get("city") or "").strip()
	parts = [part for part in [provider_name, provider_cuit, city] if part]
	return " - ".join(parts)


def _build_sheet_row(parsed: dict[str, Any]) -> dict[str, Any]:
	return {
		"fecha": parsed.get("fecha"),
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

	invoice_date = _parse_invoice_date(parsed.get("fecha"))
	if invoice_date is None:
		return f"Corrupted", True

	return f"{invoice_date.strftime('%Y%m')}", False


def _build_drive_file_url(file_id: str) -> str:
	return f"https://drive.google.com/file/d/{file_id}/view"


def _build_hyperlink_formula(url: str, label: str) -> str:
	safe_url = str(url).replace('"', '""')
	safe_label = str(label).replace('"', '""')
	return f'=HYPERLINK("{safe_url}","{safe_label}")'


def _parse_document(client: OpenAI, model: str, local_path: str, source_file: str) -> dict[str, Any]:
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
			parsed = extract_receipt_json_from_image(client, model, path, to_data_uri(path))
		
		elif file_type == ".pdf":
			# Send PDF in original format
			logger.debug("Sending PDF in original format to OpenAI")
			parsed = extract_receipt_json_from_pdf(client, model, path)
		
		else:
			# Send other document types (TXT, DOCX, etc) in original format
			logger.debug("Sending %s in original format to OpenAI", file_type)
			parsed = extract_receipt_json_from_document(client, model, path)
		
		parsed["source_file"] = source_file
		return parsed
	
	except Exception as exc:
		logger.exception("Error parsing document %s: %s", local_path, exc)
		parsed = build_empty_result(source_file)
		parsed["source_file"] = source_file
		return parsed


def _create_default_tenant_from_env() -> tuple[TenantConfig, RuleObject] | None:
	"""Create a default tenant from environment variables if possible.
	
	Maps legacy env vars to a default multi-tenant configuration:
	- OPENAI_API_KEY -> credentials.openai_api_key
	- GOOGLE_REFRESH_TOKEN -> credentials.google_refresh_token
	- GOOGLE_DRIVE_FOLDER_IDS -> rule.source_folder_id (first one)
	- GOOGLE_DRIVE_INVOICES_ROOT_FOLDER_ID -> rule.target_folder_id
	- GOOGLE_SHEETS_SPREADSHEET_ID -> rule.target_sheet_id
	
	Returns:
		TenantConfig if all required env vars are set, None otherwise
	"""
	openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
	google_refresh_token = (os.getenv("GOOGLE_REFRESH_TOKEN") or "").strip()
	drive_folder_ids = (os.getenv("GOOGLE_DRIVE_FOLDER_IDS") or "").strip()
	target_folder_id = (os.getenv("GOOGLE_DRIVE_INVOICES_ROOT_FOLDER_ID") or "").strip()
	target_sheet_id = (os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID") or "").strip()
	sheet_tab_name = (os.getenv("GOOGLE_SHEETS_WORKSHEET") or "Salidas").strip()
	
	# Check if all required vars are set
	if not all([openai_api_key, google_refresh_token, drive_folder_ids, target_folder_id, target_sheet_id]):
		logger.warning(
			"Cannot create default tenant: missing env vars. "
			"Please ensure OPENAI_API_KEY, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_IDS, "
			"GOOGLE_DRIVE_INVOICES_ROOT_FOLDER_ID, and GOOGLE_SHEETS_SPREADSHEET_ID are set."
		)
		return None
	
	# Get first folder ID from comma-separated list
	source_folder_id = drive_folder_ids.split(",")[0].strip()
	
	# Create credentials
	credentials = CredentialsObject(
		openai_api_key=openai_api_key,
		google_refresh_token=google_refresh_token,
	)
	
	# Create default rule
	default_rule = RuleObject(
		rule_id="default_rule",
		rule_name="Default Processing Rule",
		source_folder_id=source_folder_id,
		target_folder_id=target_folder_id,
		target_sheet_id=target_sheet_id,
		sheet_tab_name=sheet_tab_name,
		parsing_prompt=None,
		is_enabled=True,
	)
	
	# Create tenant (rules will be added as subcollection)
	tenant = TenantConfig(
		tenant_id="default_tenant",
		name="Default Tenant (from .env)",
		active=True,
		credentials=credentials,
		created_at=datetime.now(timezone.utc).isoformat(),
	)
	
	logger.info("Created default tenant from environment variables")
	return tenant, default_rule


def orchestrate_single_rule(
	tenant_id: str,
	tenant_config: TenantConfig,
	rule: RuleObject,
	model: str,
	include_subfolders: bool = True,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	"""Orchestrate document processing for a single rule of a single tenant.
	
	Args:
		tenant_id: Unique tenant identifier
		tenant_config: Tenant configuration (with credentials and rules)
		rule: The processing rule to orchestrate
		model: OpenAI model to use for parsing
		include_subfolders: Whether to include subfolders when scanning Drive
		send_to_sheet: Whether to append results to Google Sheets
	
	Returns:
		Summary dict with processing results
	"""
	logger.info(
		"Starting orchestration for tenant=%s rule=%s model=%s",
		tenant_id,
		rule.rule_id,
		model,
	)
	
	openai_api_key = _get_openai_api_key_from_env()
	if not openai_api_key:
		logger.error("Tenant=%s rule=%s missing OPENAI_API_KEY environment variable", tenant_id, rule.rule_id)
		return {
			"ok": False,
			"error": "Missing OPENAI_API_KEY environment variable",
			"tenant_id": tenant_id,
			"rule_id": rule.rule_id,
		}
	
	if not tenant_config.credentials.google_refresh_token:
		logger.error("Tenant=%s rule=%s missing refresh_token", tenant_id, rule.rule_id)
		return {
			"ok": False,
			"error": f"Tenant {tenant_id} missing Google OAuth refresh token",
			"tenant_id": tenant_id,
			"rule_id": rule.rule_id,
		}
	
	# Set up clients for this tenant
	try:
		client = _create_openai_client_from_key(openai_api_key)
		tracker = build_firebase_tracker(tenant_id=tenant_id, rule_id=rule.rule_id)
	except RuntimeError as exc:
		logger.error("Tenant=%s rule=%s failed to initialize clients: %s", tenant_id, rule.rule_id, exc)
		return {
			"ok": False,
			"error": str(exc),
			"tenant_id": tenant_id,
			"rule_id": rule.rule_id,
		}
	
	# Set up Google Drive service with tenant's credentials
	scan_temp_dir: str | None = None
	try:
		google_credentials = build_google_oauth_credentials(
			tenant_config.credentials.google_refresh_token,
			[DRIVE_FULL_SCOPE, *GOOGLE_SHEETS_SCOPES],
		)
		drive_service = build_drive_service(scope=DRIVE_FULL_SCOPE, credentials=google_credentials)
		
		# Scan the rule's source folder
		scan_result = scan_drive_supported_documents(
			folder_ids=[rule.source_folder_id],
			include_subfolders=include_subfolders,
			service=drive_service,
		)
		drive_documents = scan_result.documents
		scan_temp_dir = scan_result.temp_dir
	except (GoogleDriveConfigError, GoogleOAuthConfigError) as exc:
		logger.error("Tenant=%s rule=%s Google Drive config error: %s", tenant_id, rule.rule_id, exc)
		return {
			"ok": False,
			"error": f"Google Drive configuration error: {exc}",
			"tenant_id": tenant_id,
			"rule_id": rule.rule_id,
		}
	
	logger.info(
		"Tenant=%s rule=%s scan completed documents_found=%s",
		tenant_id,
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
	to_process, skipped, tracking_warning = check_drive_documents_to_process(tracker, docs_payload)
	logger.info(
		"Tenant=%s rule=%s to_process=%s skipped=%s",
		tenant_id,
		rule.rule_id,
		len(to_process),
		len(skipped),
	)
	if tracking_warning:
		logger.warning("Tenant=%s rule=%s tracking warning: %s", tenant_id, rule.rule_id, tracking_warning)
	
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
		file_hash = str(document.get("file_hash") or "").strip() or None
		
		logger.info(
			"Tenant=%s rule=%s processing document_id=%s source_file=%s",
			tenant_id,
			rule.rule_id,
			document_id,
			source_file,
		)
		
		if tracker.is_processed(file_hash):
			logger.info(
				"Tenant=%s rule=%s skipping document_id=%s already processed",
				tenant_id,
				rule.rule_id,
				document_id,
			)
			skipped.append({"document_id": document_id, "source_file": source_file, "reason": "Already processed"})
			continue
		
		try:
			parsed = _parse_document(client, model, local_path, source_file)
			logger.info(
				"Tenant=%s rule=%s parsed document_id=%s",
				tenant_id,
				rule.rule_id,
				document_id,
			)
			
			# Determine destination and whether corrupted
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
					"Tenant=%s rule=%s moved document_id=%s to %s",
					tenant_id,
					rule.rule_id,
					document_id,
					destination_path,
				)
			
			# Save document record
			if tracker is not None:
				tracker.save_document_record(
					file_hash=file_hash,
					document_id=document_id,
					source_file=source_file,
					modification_date=modification_date,
					status=status,
					parsed_data=parsed,
				)
			
			if status == "Modified":
				modified_count += 1
			else:
				parsed_count += 1
			
			# Send to Google Sheets if enabled
			worksheet_name: str | None = None
			if rule.target_sheet_id:
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
						"Tenant=%s rule=%s sent document_id=%s to sheet=%s",
						tenant_id,
						rule.rule_id,
						document_id,
						worksheet_name,
					)
					if tracker is not None and file_hash:
						tracker.mark_document_sent(file_hash)
					sent_count += 1
				except GoogleSheetsConfigError as exc:
					logger.error(
						"Tenant=%s rule=%s sheet error for document_id=%s: %s",
						tenant_id,
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
			
			processed_items.append({
				"document_id": document_id,
				"source_file": source_file,
				"modificationDate": modification_date,
				"status": "Corrupted" if is_corrupted else ("Sent" if send_to_sheet else status),
				"destination_path": destination_path,
			})
		
		except Exception as exc:
			logger.exception(
				"Tenant=%s rule=%s failed processing document_id=%s",
				tenant_id,
				rule.rule_id,
				document_id,
			)
			error_items.append({
				"document_id": document_id,
				"source_file": source_file,
				"error": str(exc),
			})
	
	# Cleanup
	if scan_temp_dir:
		shutil.rmtree(scan_temp_dir, ignore_errors=True)
		logger.info("Tenant=%s rule=%s cleaned up temp directory", tenant_id, rule.rule_id)
	
	logger.info(
		"Tenant=%s rule=%s orchestration finished parsed=%s modified=%s sent=%s moved=%s corrupted=%s errors=%s",
		tenant_id,
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
		"tenant_id": tenant_id,
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


def orchestrate_all_active_tenants(
	model: str,
	include_subfolders: bool = True,
	send_to_sheet: bool = True,
) -> dict[str, Any]:
	"""Orchestrate all active tenants and their enabled rules.
	
	This is the main multi-tenant entry point that:
	1. Loads all active tenants from Firebase
	2. For each tenant, processes all enabled rules
	3. Aggregates results across all tenants
	
	Args:
		model: OpenAI model to use for parsing
		include_subfolders: Whether to include subfolders when scanning Drive
		send_to_sheet: Whether to append results to Google Sheets
	
	Returns:
		Summary dict with aggregated processing results
	"""
	logger.info(
		"Starting multi-tenant orchestration model=%s include_subfolders=%s send_to_sheet=%s",
		model,
		include_subfolders,
		send_to_sheet,
	)
	
	# Load all active tenants from Firebase
	config_manager = FirebaseTenantConfigManager()
	default_tenant_created = False
	default_tenant_saved = False
	
	try:
		active_tenants = config_manager.list_active_tenants()
	except Exception as exc:
		logger.error("Failed to load active tenants: %s", exc)
		return {
			"ok": False,
			"error": f"Failed to load tenants: {exc}",
			"tenants_processed": 0,
		}
	
	logger.info("Loaded %s active tenants", len(active_tenants))
	
	# If no tenants found, create and save default tenant BEFORE orchestration
	if not active_tenants:
		logger.warning("No active tenants found. Creating default tenant from .env...")
		result = _create_default_tenant_from_env()
		
		if not result:
			return {
				"ok": False,
				"error": "No active tenants found in Firebase and could not create default tenant from .env",
				"tenants_processed": 0,
				"tenants_results": [],
			}
		
		default_tenant, default_rule = result
		
		# Save default tenant to Firebase BEFORE orchestration
		try:
			logger.info("Saving default tenant '%s' to Firebase...", default_tenant.tenant_id)
			config_manager.save_tenant(default_tenant)
			# Add the default rule to the tenant's rules subcollection
			config_manager.add_rule(default_tenant.tenant_id, default_rule)
			logger.info("✓ Successfully saved default tenant and rule to Firebase: %s", default_tenant.tenant_id)
			default_tenant_saved = True
		except Exception as exc:
			logger.error("✗ Failed to save default tenant to Firebase: %s", exc, exc_info=True)
			return {
				"ok": False,
				"error": f"Failed to save default tenant to Firebase: {exc}",
				"tenants_processed": 0,
				"tenants_results": [],
			}
		
		# Use the default tenant for orchestration
		active_tenants = [default_tenant]
		default_tenant_created = True
		logger.info("Using default tenant created and saved from environment variables")
	
	# Process each tenant and their rules
	tenants_results = []
	total_parsed = 0
	total_modified = 0
	total_sent = 0
	total_moved = 0
	total_corrupted = 0
	total_errors = 0
	
	for tenant in active_tenants:
		tenant_id = tenant.tenant_id
		logger.info("Processing tenant=%s name=%s", tenant_id, tenant.name)
		
		# Get enabled rules for this tenant from the rules subcollection
		enabled_rules = config_manager.get_enabled_rules(tenant_id)
		logger.info("Tenant=%s has %s enabled rules", tenant_id, len(enabled_rules))
		
		if not enabled_rules:
			logger.warning("Tenant=%s has no enabled rules", tenant_id)
			tenants_results.append({
				"tenant_id": tenant_id,
				"tenant_name": tenant.name,
				"ok": True,
				"warning": "No enabled rules",
				"rules_processed": 0,
				"rules_results": [],
			})
			continue
		
		# Process each rule
		rules_results = []
		tenant_parsed = 0
		tenant_modified = 0
		tenant_sent = 0
		tenant_moved = 0
		tenant_corrupted = 0
		tenant_errors = 0
		
		for rule in enabled_rules:
			rule_result = orchestrate_single_rule(
				tenant_id=tenant_id,
				tenant_config=tenant,
				rule=rule,
				model=model,
				include_subfolders=include_subfolders,
				send_to_sheet=send_to_sheet,
			)
			rules_results.append(rule_result)
			
			if rule_result.get("ok"):
				tenant_parsed += rule_result.get("parsed", 0)
				tenant_modified += rule_result.get("modified", 0)
				tenant_sent += rule_result.get("sent", 0)
				tenant_moved += rule_result.get("moved", 0)
				tenant_corrupted += rule_result.get("corrupted", 0)
				tenant_errors += len(rule_result.get("errors", []))
		
		total_parsed += tenant_parsed
		total_modified += tenant_modified
		total_sent += tenant_sent
		total_moved += tenant_moved
		total_corrupted += tenant_corrupted
		total_errors += tenant_errors
		
		tenants_results.append({
			"tenant_id": tenant_id,
			"tenant_name": tenant.name,
			"ok": True,
			"rules_processed": len(rules_results),
			"parsed": tenant_parsed,
			"modified": tenant_modified,
			"sent": tenant_sent,
			"moved": tenant_moved,
			"corrupted": tenant_corrupted,
			"errors": tenant_errors,
			"rules_results": rules_results,
		})
	
	logger.info(
		"Multi-tenant orchestration completed tenants=%s parsed=%s modified=%s sent=%s moved=%s corrupted=%s errors=%s",
		len(tenants_results),
		total_parsed,
		total_modified,
		total_sent,
		total_moved,
		total_corrupted,
		total_errors,
	)
	
	return {
		"ok": True,
		"tenants_processed": len(tenants_results),
		"default_tenant_created": default_tenant_created,
		"default_tenant_saved": default_tenant_saved,
		"total_parsed": total_parsed,
		"total_modified": total_modified,
		"total_sent": total_sent,
		"total_moved": total_moved,
		"total_corrupted": total_corrupted,
		"total_errors": total_errors,
		"tenants_results": tenants_results,
	}


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Orchestrate Drive documents: scan, parse, and persist status using multi-tenant Firebase configuration."
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
		"Running document orchestration CLI in multi-tenant mode output=%s",
		args.output or "stdout",
	)
	
	logger.info("Loading all active tenants from Firebase")
	summary = orchestrate_all_active_tenants(
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
