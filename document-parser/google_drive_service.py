from __future__ import annotations

import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.oauth2.credentials import Credentials

from document_processing import SUPPORTED_EXTENSIONS
from google_oauth_credentials import GoogleOAuthConfigError, build_google_oauth_credentials


load_dotenv()


logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

# Google Workspace files require export, while binary files can be downloaded directly.
SUPPORTED_EXPORT_MIME_MAP = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
}

SUPPORTED_BINARY_MIME_TO_SUFFIX = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}


@dataclass
class DriveDocument:
    document_id: str
    source_file: str
    mime_type: str
    modificationDate: str | None
    local_path: str


@dataclass
class DriveDownloadResult:
    documents: list[DriveDocument]
    discovered_count: int
    temp_dir: str


class GoogleDriveConfigError(RuntimeError):
    """Raised when required Google Drive environment configuration is missing or invalid."""


def load_drive_folder_ids_from_env(env_var: str = "GOOGLE_DRIVE_FOLDER_IDS") -> list[str]:
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        raise GoogleDriveConfigError(f"Missing {env_var}. Set one or more folder IDs separated by commas.")

    folder_ids = [item.strip() for item in raw.split(",") if item.strip()]
    if not folder_ids:
        raise GoogleDriveConfigError(f"{env_var} is empty after parsing.")

    logger.info("Loaded %s folder id(s) from env var %s", len(folder_ids), env_var)

    return folder_ids


def build_drive_credentials(scope: str = DRIVE_READONLY_SCOPE, refresh_token: str | None = None) -> Credentials:
    """Build Google Drive credentials.
    
    Args:
        scope: OAuth scope for the credentials
        refresh_token: Tenant OAuth refresh token. Falls back to GOOGLE_REFRESH_TOKEN.
    """
    try:
        return build_google_oauth_credentials(refresh_token, [scope])
    except GoogleOAuthConfigError as exc:
        raise GoogleDriveConfigError(str(exc)) from exc


def build_drive_service(
    scope: str = DRIVE_READONLY_SCOPE,
    refresh_token: str | None = None,
    credentials: Credentials | None = None,
):
    """Build Google Drive service.
    
    Args:
        scope: OAuth scope for the credentials
        refresh_token: Optional tenant OAuth refresh token.
        credentials: Optional prebuilt tenant OAuth credentials.
    """
    try:
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise GoogleDriveConfigError(
            "google-api-python-client is required for Drive scanning. Add it to requirements and install dependencies."
        ) from exc

    resolved_credentials = credentials or build_drive_credentials(scope=scope, refresh_token=refresh_token)
    logger.info("Building Drive service with scope=%s", scope)
    return build("drive", "v3", credentials=resolved_credentials, cache_discovery=False)


def _escape_drive_query_value(value: str) -> str:
    return value.replace("'", "\\'")


def _sanitize_file_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "_", name).strip().rstrip(".")
    return cleaned or "document"


def _ensure_unique_destination(path: Path) -> Path:
    if not path.exists():
        return path

    counter = 1
    while True:
        candidate = path.with_name(f"{path.stem}_{counter}{path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _list_files_from_folder(service, folder_id: str, include_subfolders: bool) -> list[dict[str, Any]]:
    logger.info("Listing Drive folder id=%s include_subfolders=%s", folder_id, include_subfolders)
    folders_to_scan = [folder_id]
    discovered: list[dict[str, Any]] = []

    while folders_to_scan:
        current_folder = folders_to_scan.pop(0)
        page_token = None

        while True:
            response = (
                service.files()
                .list(
                    q=f"'{current_folder}' in parents and trashed = false",
                    fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    pageSize=1000,
                    pageToken=page_token,
                )
                .execute()
            )

            for file_meta in response.get("files", []):
                mime_type = file_meta.get("mimeType")
                if mime_type == FOLDER_MIME_TYPE:
                    if include_subfolders:
                        child_folder_id = file_meta.get("id")
                        if child_folder_id:
                            folders_to_scan.append(child_folder_id)
                    continue

                discovered.append(file_meta)

            page_token = response.get("nextPageToken")
            if not page_token:
                break

    return discovered


def _is_supported_drive_file(file_meta: dict[str, Any]) -> bool:
    mime_type = (file_meta.get("mimeType") or "").strip().lower()
    if mime_type in SUPPORTED_BINARY_MIME_TO_SUFFIX:
        return True
    if mime_type in SUPPORTED_EXPORT_MIME_MAP:
        return True

    name = (file_meta.get("name") or "").strip()
    suffix = Path(name).suffix.lower()
    return suffix in SUPPORTED_EXTENSIONS


def _download_drive_file(service, file_meta: dict[str, Any], destination_dir: Path) -> str:
    try:
        from googleapiclient.http import MediaIoBaseDownload
    except ImportError as exc:
        raise GoogleDriveConfigError(
            "google-api-python-client is required for Drive scanning. Add it to requirements and install dependencies."
        ) from exc

    file_id = (file_meta.get("id") or "").strip()
    file_name = _sanitize_file_name((file_meta.get("name") or "document").strip())
    mime_type = (file_meta.get("mimeType") or "").strip().lower()

    suffix = Path(file_name).suffix.lower()
    request = None

    if mime_type in SUPPORTED_EXPORT_MIME_MAP:
        export_mime, export_suffix = SUPPORTED_EXPORT_MIME_MAP[mime_type]
        if suffix != export_suffix:
            file_name = f"{Path(file_name).stem}{export_suffix}"
            suffix = export_suffix
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
    else:
        if not suffix and mime_type in SUPPORTED_BINARY_MIME_TO_SUFFIX:
            file_name = f"{file_name}{SUPPORTED_BINARY_MIME_TO_SUFFIX[mime_type]}"
            suffix = Path(file_name).suffix.lower()
        request = service.files().get_media(fileId=file_id)

    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported downloaded file type: {suffix or '[no extension]'}")

    destination = _ensure_unique_destination(destination_dir / file_name)

    with destination.open("wb") as stream:
        downloader = MediaIoBaseDownload(stream, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

    return str(destination)


def scan_drive_supported_documents(
    folder_ids: list[str],
    include_subfolders: bool = True,
    service: Any | None = None,
) -> DriveDownloadResult:
    resolved_service = service or build_drive_service()
    logger.info("Starting Drive scan for %s folder(s)", len(folder_ids))

    discovered_files: list[dict[str, Any]] = []
    for folder_id in folder_ids:
        discovered_files.extend(_list_files_from_folder(resolved_service, folder_id, include_subfolders))

    supported_files = [file_meta for file_meta in discovered_files if _is_supported_drive_file(file_meta)]
    logger.info("Drive scan discovered=%s supported=%s", len(discovered_files), len(supported_files))
    temp_dir = tempfile.mkdtemp(prefix="drive_docs_")
    destination_dir = Path(temp_dir)

    documents: list[DriveDocument] = []
    for file_meta in supported_files:
        try:
            local_path = _download_drive_file(resolved_service, file_meta, destination_dir)
        except Exception:
            # Keep scan resilient if one file is malformed or inaccessible.
            logger.exception("Skipping file during Drive download due to error file_id=%s", file_meta.get("id"))
            continue

        documents.append(
            DriveDocument(
                document_id=str(file_meta.get("id") or "").strip(),
                source_file=str(file_meta.get("name") or "").strip(),
                mime_type=str(file_meta.get("mimeType") or "").strip(),
                modificationDate=str(file_meta.get("modifiedTime") or "").strip() or None,
                local_path=local_path,
            )
        )

    return DriveDownloadResult(
        documents=documents,
        discovered_count=len(supported_files),
        temp_dir=temp_dir,
    )


def _find_folder_in_parent(service, folder_name: str, parent_folder_id: str | None) -> str | None:
    query_parts = [
        "trashed = false",
        f"mimeType = '{FOLDER_MIME_TYPE}'",
        f"name = '{_escape_drive_query_value(folder_name)}'",
    ]
    if parent_folder_id:
        query_parts.append(f"'{parent_folder_id}' in parents")

    try:
        response = (
            service.files()
            .list(
                q=" and ".join(query_parts),
                fields="files(id,name)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageSize=10,
            )
            .execute()
        )
    except Exception as exc:
        raise GoogleDriveConfigError(f"Failed to query folder '{folder_name}': {exc}") from exc

    files = response.get("files", [])
    if not files:
        logger.info("Drive folder not found name=%s parent=%s", folder_name, parent_folder_id or "root")
        return None

    logger.info("Found Drive folder name=%s parent=%s", folder_name, parent_folder_id or "root")
    return str(files[0].get("id") or "").strip() or None


def _create_folder_in_parent(service, folder_name: str, parent_folder_id: str | None) -> str:
    body: dict[str, Any] = {"name": folder_name, "mimeType": FOLDER_MIME_TYPE}
    if parent_folder_id:
        body["parents"] = [parent_folder_id]

    try:
        created = (
            service.files()
            .create(body=body, fields="id", supportsAllDrives=True)
            .execute()
        )
    except Exception as exc:
        raise GoogleDriveConfigError(
            f"Failed to create folder '{folder_name}' under parent '{parent_folder_id or 'root'}': {exc}"
        ) from exc

    folder_id = str(created.get("id") or "").strip()
    if not folder_id:
        raise GoogleDriveConfigError(f"Folder '{folder_name}' was created but no id was returned.")

    logger.info("Created Drive folder name=%s parent=%s id=%s", folder_name, parent_folder_id or "root", folder_id)

    return folder_id


def ensure_drive_folder_path(service, folder_path: str, root_folder_id: str | None = None) -> str:
    normalized = (folder_path or "").strip().strip("/")
    if not normalized:
        raise GoogleDriveConfigError("folder_path is required to resolve a Drive destination.")

    current_parent = (root_folder_id or "").strip() or None
    for part in [segment.strip() for segment in normalized.split("/") if segment.strip()]:
        folder_id = _find_folder_in_parent(service, part, current_parent)
        if folder_id is None:
            folder_id = _create_folder_in_parent(service, part, current_parent)
        current_parent = folder_id

    if not current_parent:
        raise GoogleDriveConfigError(f"Could not resolve Drive path '{folder_path}'.")

    logger.info("Resolved Drive path=%s to folder_id=%s", folder_path, current_parent)

    return current_parent


def move_file_to_path(service, file_id: str, destination_path: str, root_folder_id: str | None = None) -> str:
    normalized_file_id = (file_id or "").strip()
    if not normalized_file_id:
        raise GoogleDriveConfigError("file_id is required to move a Drive file.")

    destination_folder_id = ensure_drive_folder_path(service, destination_path, root_folder_id=root_folder_id)
    logger.info("Moving Drive file_id=%s to destination_path=%s", normalized_file_id, destination_path)

    try:
        metadata = (
            service.files()
            .get(fileId=normalized_file_id, fields="parents", supportsAllDrives=True)
            .execute()
        )
    except Exception as exc:
        raise GoogleDriveConfigError(f"Failed to read current parents for file '{normalized_file_id}': {exc}") from exc

    current_parents = [str(parent).strip() for parent in metadata.get("parents", []) if str(parent).strip()]

    if destination_folder_id in current_parents and len(current_parents) == 1:
        logger.info("Drive file already in destination file_id=%s folder_id=%s", normalized_file_id, destination_folder_id)
        return destination_folder_id

    request_kwargs: dict[str, Any] = {
        "fileId": normalized_file_id,
        "addParents": destination_folder_id,
        "supportsAllDrives": True,
        "fields": "id,parents",
    }
    remove_parents = ",".join(parent for parent in current_parents if parent != destination_folder_id)
    if remove_parents:
        request_kwargs["removeParents"] = remove_parents

    try:
        service.files().update(**request_kwargs).execute()
    except Exception as exc:
        raise GoogleDriveConfigError(
            f"Failed to move file '{normalized_file_id}' to Drive path '{destination_path}': {exc}"
        ) from exc

    logger.info("Moved Drive file_id=%s to folder_id=%s", normalized_file_id, destination_folder_id)

    return destination_folder_id
