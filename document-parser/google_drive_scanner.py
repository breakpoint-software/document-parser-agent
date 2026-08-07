from __future__ import annotations

from dotenv import load_dotenv
from google_drive_service import (
    DriveDocument,
    load_drive_folder_ids_from_env,
    scan_drive_supported_documents,
)


load_dotenv()


def scan_google_drive_supported_documents(include_subfolders: bool = True) -> tuple[list[DriveDocument], str]:
    """Scans configured Drive folders and downloads supported documents with metadata."""
    folder_ids = load_drive_folder_ids_from_env()
    scan_result = scan_drive_supported_documents(folder_ids=folder_ids, include_subfolders=include_subfolders)
    return scan_result.documents, scan_result.temp_dir