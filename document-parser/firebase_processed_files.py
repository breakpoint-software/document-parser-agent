from __future__ import annotations

import hashlib
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
        
        # Multi-tenant rule-based tracking: tenants/{tenant_id}/rules_executions/{rule_id}/processed_documents/{file_hash}
        self.collection_name = f"{self.tenant_id}/{self.rule_id}_executions/processed_documents"
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

    def compute_file_hash(self, file_path: Path) -> str:
        sha256 = hashlib.sha256()
        with file_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def is_processed(self, file_hash: str) -> bool:
        doc = self._get_db().collection(self.collection_name).document(file_hash).get()
        return bool(doc.exists)

    def mark_processed(self, file_hash: str, source_file: str) -> None:
        payload = {
            "file_hash": file_hash,
            "source_file": source_file,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }
        self._get_db().collection(self.collection_name).document(file_hash).set(payload)

    def get_document_record(self, document_id: str) -> dict[str, Any] | None:
        doc = self._get_db().collection(self.collection_name).document(document_id).get()
        if not doc.exists:
            return None
        return doc.to_dict() or {}

    def save_document_record(
        self,
        file_hash: str,
        document_id: str,
        source_file: str,
        modification_date: str | None,
        status: str,
        parsed_data: dict[str, Any] | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload: dict[str, Any] = {
            "file_hash": file_hash,
            "document_id": document_id,
            "source_file": source_file,
            "modificationDate": modification_date,
            "status": status,
            "updated_at": now,
        }

        if parsed_data is not None:
            payload["parsed_data"] = parsed_data

        existing = self.get_document_record(file_hash)
        if existing is None:
            payload["created_at"] = now

        # Use file_hash as the document ID in Firebase
        self._get_db().collection(self.collection_name).document(file_hash).set(payload, merge=True)
        
        # Also mark the file as processed in the documents collection
        self.mark_processed(file_hash, source_file)

    def mark_document_sent(self, document_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "status": "Sent",
            "sent_at": now,
            "updated_at": now,
        }
        self._get_db().collection(self.collection_name).document(document_id).set(payload, merge=True)

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


def check_files_already_processed(
    tracker: FirebaseProcessedFilesTracker | None, file_paths: list[str]
) -> tuple[list[str], list[tuple[str, str]], str | None]:
    if tracker is None:
        return file_paths, [], None

    new_files: list[str] = []
    skipped_files: list[tuple[str, str]] = []

    try:
        for file_path in file_paths:
            path = Path(file_path)
            file_hash = tracker.compute_file_hash(path)
            if tracker.is_processed(file_hash):
                skipped_files.append((path.name, file_hash))
            else:
                new_files.append(file_path)
    except Exception as exc:
        return file_paths, [], f"Firebase tracking unavailable. Processing all files. Details: {exc}"

    return new_files, skipped_files, None


def check_drive_documents_to_process(
    tracker: FirebaseProcessedFilesTracker | None,
    documents: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """
    Returns (documents_to_process, skipped_documents, warning).

    Process:
    1. Compute file hash from file content
    2. Use hash as unique document identifier
    3. Check if document (by hash) already exists
    4. Compare modification dates for changes

    - File already processed (by hash) -> skipped
    - New document (no hash record) -> status "Parsed"
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
            modified_time = str(document.get("modificationDate") or "").strip() or None
            local_path = str(document.get("local_path") or "").strip()

            if not document_id or not local_path:
                skipped.append({**document, "skip_reason": "missing_document_id_or_path"})
                continue

            # Compute file hash from file content - this becomes the unique identifier
            try:
                path = Path(local_path)
                if not path.exists():
                    skipped.append({**document, "skip_reason": "file_not_found"})
                    continue
                file_hash = tracker.compute_file_hash(path)
            except Exception as exc:
                skipped.append({**document, "skip_reason": f"hash_computation_failed: {exc}"})
                continue

            # Use hash as the document identifier
            existing = tracker.get_document_record(file_hash)
            if existing is None:
                # New file - process it
                to_process.append({
                    **document,
                    "file_hash": file_hash,
                    "target_status": "Parsed",
                    "hash_document_id": file_hash,
                })
                continue

            # Existing document - check if modified
            existing_modified = str(existing.get("modificationDate") or "").strip() or None
            if existing_modified != modified_time:
                to_process.append({
                    **document,
                    "file_hash": file_hash,
                    "target_status": "Modified",
                    "hash_document_id": file_hash,
                })
            else:
                skipped.append({
                    **document,
                    "skip_reason": "already_processed_same_content",
                    "file_hash": file_hash,
                })
    except Exception as exc:
        docs = [dict(doc, target_status="Parsed") for doc in documents]
        return docs, [], f"Firebase tracking unavailable. Processing all Drive files. Details: {exc}"

    return to_process, skipped, None

