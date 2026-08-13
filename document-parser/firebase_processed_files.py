from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv


load_dotenv()


class FirebaseConfigError(RuntimeError):
    """Raised when Firebase configuration is missing or invalid."""


class FirebaseProcessedFilesTracker:
    def __init__(
        self,
        workspace_id: str,
        rule_id: str | None = None,
        legacy_rule_ids: list[str] | None = None,
    ):
        self.workspace_id = (workspace_id or "").strip()
        self.rule_id = (rule_id or "").strip()
        
        if not self.workspace_id:
            raise FirebaseConfigError("workspace_id is required")
        
        self.collection_name = f"workspace_executions/{self.workspace_id}/processed_files"
        self.runs_collection_name = f"workspace_executions/{self.workspace_id}/runs"
        normalized_rule_ids = [value.strip() for value in (legacy_rule_ids or []) if value.strip()]
        if self.rule_id:
            normalized_rule_ids.insert(0, self.rule_id)
        self.legacy_collection_names = [
            f"{self.workspace_id}/{legacy_rule_id}/processed_files"
            for legacy_rule_id in dict.fromkeys(normalized_rule_ids)
        ]
        self.legacy_collection_name = self.legacy_collection_names[0] if self.legacy_collection_names else None
        self._db = None

    def _build_credentials(self):
        from firebase_admin import credentials

        service_account_json = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
        service_account_file = (os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE") or "").strip()

        if service_account_json:
            try:
                info = json.loads(service_account_json)
            except json.JSONDecodeError as exc:
                raise FirebaseConfigError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.") from exc
            return credentials.Certificate(info)

        if service_account_file:
            return credentials.Certificate(service_account_file)

        raise FirebaseConfigError(
            "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE."
        )

    def _get_db(self):
        if self._db is not None:
            return self._db

        import firebase_admin
        from firebase_admin import firestore

        if not firebase_admin._apps:
            cred = self._build_credentials()
            firebase_admin.initialize_app(cred)

        self._db = firestore.client()
        return self._db

    def get_document_record(self, identity_key: str) -> dict[str, Any] | None:
        doc = self._get_db().collection(self.collection_name).document(identity_key).get()
        if doc.exists:
            return doc.to_dict() or {}

        for legacy_collection_name in self.legacy_collection_names:
            legacy_doc = self._get_db().collection(legacy_collection_name).document(identity_key).get()
            if legacy_doc.exists:
                payload = legacy_doc.to_dict() or {}
                self._get_db().collection(self.collection_name).document(identity_key).set(payload)
                return payload
        return None

    def get_source_record(self, source_document_id: str) -> dict[str, Any] | None:
        collection_names = [self.collection_name]
        collection_names.extend(self.legacy_collection_names)

        for collection_name in collection_names:
            collection = self._get_db().collection(collection_name)
            try:
                documents = list(collection.where("drive_file_id", "==", source_document_id).limit(1).stream())
            except Exception:
                documents = list(collection.stream())

            for doc in documents:
                payload = doc.to_dict() or {}
                if payload.get("drive_file_id") != source_document_id:
                    continue
                if collection_name != self.collection_name:
                    record_id = str(payload.get("document_id") or payload.get("identity_key") or f"source-{source_document_id}")
                    self._get_db().collection(self.collection_name).document(record_id).set(payload)
                return payload
        return None

    @staticmethod
    def _build_record(
        record_id: str,
        status: str,
        schema_id: str,
        schema_version: int,
        execution_mode: str,
        source_file: str,
        drive_file_id: str,
        parsed_data: dict[str, Any],
        source_modified_at: Any = None,
        selected_rule_id: str | None = None,
        rule_set_version: str | None = None,
    ) -> dict[str, Any]:
        return {
            "document_id": record_id,
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "schema_id": schema_id,
            "source_file_name": source_file,
            "drive_file_id": drive_file_id,
            "parsed_data": parsed_data,
            "source_modified_at": source_modified_at,
            "schema_version": schema_version,
            "execution_mode": execution_mode,
            "selected_rule_id": selected_rule_id,
            "rule_set_version": rule_set_version,
        }

    def claim_document_identity(
        self,
        identity: dict[str, Any],
        source_document_id: str,
        source_file: str,
        schema_id: str,
        schema_version: int,
        execution_mode: str,
        parsed_data: dict[str, Any] | None = None,
        source_modified_at: Any = None,
        selected_rule_id: str | None = None,
        rule_set_version: str | None = None,
    ) -> str | None:
        from google.api_core.exceptions import AlreadyExists

        identity_key = identity["identity_key"]
        collection = self._get_db().collection(self.collection_name)
        payload = self._build_record(
            identity_key,
            "Parsed",
            schema_id,
            schema_version,
            execution_mode,
            source_file,
            source_document_id,
            parsed_data or {},
            source_modified_at,
            selected_rule_id,
            rule_set_version,
        )
        try:
            collection.document(identity_key).create(payload)
            return "created"
        except AlreadyExists:
            existing = self.get_document_record(identity_key) or {}
            if existing.get("drive_file_id") == source_document_id:
                return "existing_source"

            duplicate_id = f"duplicated-{identity_key}"
            collection.document(duplicate_id).set(
                self._build_record(
                    duplicate_id,
                    "Duplicated",
                    schema_id,
                    schema_version,
                    execution_mode,
                    source_file,
                    source_document_id,
                    parsed_data or {},
                    source_modified_at,
                    selected_rule_id,
                    rule_set_version,
                )
            )
            return None

    def release_document_identity(self, identity_key: str, source_document_id: str) -> None:
        document = self._get_db().collection(self.collection_name).document(identity_key)
        existing = document.get()
        if existing.exists and (existing.to_dict() or {}).get("drive_file_id") == source_document_id:
            document.delete()

    def save_document_record(
        self,
        identity_key: str,
        drive_file_id: str,
        source_file: str,
        schema_id: str,
        schema_version: int,
        execution_mode: str,
        source_modified_at: Any = None,
        status: str = "Parsed",
        parsed_data: dict[str, Any] | None = None,
        selected_rule_id: str | None = None,
        rule_set_version: str | None = None,
    ) -> None:
        payload = self._build_record(
            identity_key,
            status,
            schema_id,
            schema_version,
            execution_mode,
            source_file,
            drive_file_id,
            parsed_data or {},
            source_modified_at,
            selected_rule_id,
            rule_set_version,
        )
        self._get_db().collection(self.collection_name).document(identity_key).set(payload)

    def save_source_record(
        self,
        drive_file_id: str,
        source_file: str,
        source_modified_at: Any,
        status: str,
        schema_id: str,
        schema_version: int,
        execution_mode: str,
        identity_key: str | None = None,
        selected_rule_id: str | None = None,
        parsed_data: dict[str, Any] | None = None,
        rule_set_version: str | None = None,
    ) -> None:
        record_id = identity_key or f"source-{drive_file_id}"
        payload = self._build_record(
            record_id,
            status,
            schema_id,
            schema_version,
            execution_mode,
            source_file,
            drive_file_id,
            parsed_data or {},
            source_modified_at,
            selected_rule_id,
            rule_set_version,
        )
        payload["identity_key"] = identity_key
        if identity_key:
            payload.pop("parsed_data", None)
        collection = self._get_db().collection(self.collection_name)
        collection.document(record_id).set(payload, merge=True)
        placeholder_id = f"source-{drive_file_id}"
        if identity_key and placeholder_id != record_id:
            collection.document(placeholder_id).delete()

    def mark_document_sent(self, identity_key: str) -> None:
        self.mark_document_status(identity_key, "Sent")

    def mark_document_status(self, record_id: str, status: str, **fields: Any) -> None:
        payload = {
            "status": status,
            "executed_at": datetime.now(timezone.utc).isoformat(),
            **fields,
        }
        self._get_db().collection(self.collection_name).document(record_id).set(payload, merge=True)

    def start_run(self, execution_mode: str) -> str:
        run_id = uuid4().hex
        started_at = datetime.now(timezone.utc).isoformat()
        self._get_db().collection("workspace_executions").document(self.workspace_id).set({
            "workspace_id": self.workspace_id,
            "last_execution_mode": execution_mode,
            "last_started_at": started_at,
            "last_status": "running",
        }, merge=True)
        self._get_db().collection(self.runs_collection_name).document(run_id).set({
            "execution_mode": execution_mode,
            "status": "running",
            "started_at": started_at,
        })
        return run_id

    def finish_run(self, run_id: str, status: str, summary: dict[str, Any]) -> None:
        completed_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "status": status,
            "completed_at": completed_at,
            **summary,
        }
        self._get_db().collection(self.runs_collection_name).document(run_id).set(payload, merge=True)
        self._get_db().collection("workspace_executions").document(self.workspace_id).set({
            "last_completed_at": completed_at,
            "last_status": status,
        }, merge=True)

    def list_documents_by_statuses(self, statuses: list[str]) -> list[dict[str, Any]]:
        unique_statuses = [status for status in dict.fromkeys(statuses) if str(status).strip()]
        if not unique_statuses:
            return []

        collection = self._get_db().collection(self.collection_name)
        documents: list[dict[str, Any]] = []

        try:
            query = collection.where("status", "in", unique_statuses)
            for doc in query.stream():
                payload = doc.to_dict() or {}
                payload.setdefault("document_id", doc.id)
                documents.append(payload)
            return documents
        except Exception:
            # Fallback for environments where the 'in' operator is unavailable or restricted.
            for doc in collection.stream():
                payload = doc.to_dict() or {}
                status = str(payload.get("status") or "")
                if status in unique_statuses:
                    payload.setdefault("document_id", doc.id)
                    documents.append(payload)

        return documents


def build_firebase_tracker(
    workspace_id: str,
    rule_id: str | None = None,
    legacy_rule_ids: list[str] | None = None,
) -> FirebaseProcessedFilesTracker:
    enabled = (os.getenv("FIREBASE_TRACK_PROCESSED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        raise FirebaseConfigError("Firebase tracking is disabled (FIREBASE_TRACK_PROCESSED=false)")

    return FirebaseProcessedFilesTracker(
        workspace_id=workspace_id,
        rule_id=rule_id,
        legacy_rule_ids=legacy_rule_ids,
    )


def check_drive_documents_to_process(
    tracker: FirebaseProcessedFilesTracker | None,
    documents: list[dict[str, Any]],
    schema_id: str,
    schema_version: int,
    rule_set_version: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """
    Returns (documents_to_process, skipped_documents, warning).

    Records are looked up by Drive document ID to avoid re-extracting an
    unchanged source. Canonical business identity is checked after extraction.

    - New source document -> status "Parsed"
    - Existing document with modified date changed -> status "Modified"
    - Existing document with same modified date -> skipped
    """
    if tracker is None:
        docs = [dict(doc, target_status="Parsed") for doc in documents]
        return docs, [], None

    to_process: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    try:
        for document in documents:
            document_id = str(document.get("document_id") or "").strip()
            local_path = str(document.get("local_path") or "").strip()

            if not document_id or not local_path:
                skipped.append({**document, "skip_reason": "missing_document_id_or_path"})
                continue

            if not Path(local_path).exists():
                skipped.append({**document, "skip_reason": "file_not_found"})
                continue

            existing = tracker.get_source_record(document_id)
            if existing is None:
                to_process.append({
                    **document,
                    "target_status": "Parsed",
                })
                continue

            # Existing document - check if modified
            existing_schema_id = str(existing.get("schema_id") or "").strip()
            existing_schema_version = int(existing.get("schema_version") or 0)
            existing_modified_at = str(existing.get("source_modified_at") or "")
            source_modified_at = str(document.get("modificationDate") or "")
            existing_status = str(existing.get("status") or "").strip()
            scheme_changed = existing_schema_id != schema_id
            scheme_version_changed = existing_schema_version != schema_version
            source_changed = existing_modified_at != source_modified_at
            rules_changed = rule_set_version is not None and existing.get("rule_set_version") != rule_set_version
            retry_required = existing_status not in {
                "Sent", "Parsed", "Matched", "Unmatched", "Moved", "Corrupted", "Duplicated"
            }
            if scheme_changed or scheme_version_changed or source_changed or rules_changed or retry_required:
                to_process.append({
                    **document,
                    "target_status": "Modified",
                    "previous_identity_key": existing.get("document_id"),
                })
            else:
                skipped.append({
                    **document,
                    "skip_reason": "source_unchanged",
                })
    except Exception as exc:
        docs = [dict(doc, target_status="Parsed") for doc in documents]
        return docs, [], f"Firebase tracking unavailable. Processing all Drive files. Details: {exc}"

    return to_process, skipped, None

