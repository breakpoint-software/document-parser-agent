from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


load_dotenv()


class FirebaseConfigError(RuntimeError):
    """Raised when Firebase configuration is missing or invalid."""


class FirebaseProcessedFilesTracker:
    def __init__(
        self,
        tenant_id: str,
        rule_id: str,
    ):
        self.tenant_id = (tenant_id or "").strip()
        self.rule_id = (rule_id or "").strip()
        
        if not self.tenant_id:
            raise FirebaseConfigError("tenant_id is required")
        if not self.rule_id:
            raise FirebaseConfigError("rule_id is required")
        
        execution_path = f"{self.tenant_id}/{self.rule_id}"
        self.collection_name = f"{execution_path}/processed_files"
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
        if not doc.exists:
            return None
        return doc.to_dict() or {}

    def get_source_record(self, source_document_id: str) -> dict[str, Any] | None:
        collection = self._get_db().collection(self.collection_name)
        try:
            documents = list(collection.where("drive_file_id", "==", source_document_id).limit(1).stream())
        except Exception:
            documents = collection.stream()

        for doc in documents:
            payload = doc.to_dict() or {}
            if payload.get("drive_file_id") == source_document_id:
                return payload
        return None

    @staticmethod
    def _build_record(
        record_id: str,
        status: str,
        schema_id: str,
        source_file: str,
        drive_file_id: str,
        parsed_data: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "document_id": record_id,
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "schema_id": schema_id,
            "source_file_name": source_file,
            "drive_file_id": drive_file_id,
            "parsed_data": parsed_data,
        }

    def claim_document_identity(
        self,
        identity: dict[str, Any],
        source_document_id: str,
        source_file: str,
        schema_id: str,
        parsed_data: dict[str, Any],
    ) -> str | None:
        from google.api_core.exceptions import AlreadyExists

        identity_key = identity["identity_key"]
        collection = self._get_db().collection(self.collection_name)
        payload = self._build_record(
            identity_key,
            "Parsed",
            schema_id,
            source_file,
            source_document_id,
            parsed_data,
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
                    source_file,
                    source_document_id,
                    parsed_data,
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
        status: str,
        schema_id: str,
        parsed_data: dict[str, Any],
    ) -> None:
        payload = self._build_record(
            identity_key,
            status,
            schema_id,
            source_file,
            drive_file_id,
            parsed_data,
        )
        self._get_db().collection(self.collection_name).document(identity_key).set(payload)

    def mark_document_sent(self, identity_key: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "status": "Sent",
            "executed_at": now,
        }
        self._get_db().collection(self.collection_name).document(identity_key).set(payload, merge=True)

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
    tenant_id: str,
    rule_id: str,
) -> FirebaseProcessedFilesTracker:
    enabled = (os.getenv("FIREBASE_TRACK_PROCESSED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        raise FirebaseConfigError("Firebase tracking is disabled (FIREBASE_TRACK_PROCESSED=false)")

    return FirebaseProcessedFilesTracker(tenant_id=tenant_id, rule_id=rule_id)


def check_drive_documents_to_process(
    tracker: FirebaseProcessedFilesTracker | None,
    documents: list[dict[str, Any]],
    schema_id: str,
    schema_version: int,
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
            existing_status = str(existing.get("status") or "").strip()
            scheme_changed = existing_schema_id != schema_id
            retry_required = existing_status not in {"Sent", "Parsed", "Corrupted", "Duplicated"}
            if scheme_changed or retry_required:
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

