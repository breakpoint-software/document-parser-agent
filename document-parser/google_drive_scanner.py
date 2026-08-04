from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from firebase_processed_files import FirebaseProcessedFilesTracker, check_files_already_processed
from google_drive_service import (
    DriveDocument,
    GoogleDriveConfigError,
    load_drive_folder_ids_from_env,
    scan_drive_supported_documents,
)


load_dotenv()


@dataclass
class DriveScanResult:
    files_to_process: list[str]
    skipped_files: list[tuple[str, str]]
    discovered_count: int
    temp_dir: str
    warning: str | None = None


def scan_google_drive_unprocessed_files(
    tracker: FirebaseProcessedFilesTracker | None,
    include_subfolders: bool = True,
) -> DriveScanResult:
    folder_ids = load_drive_folder_ids_from_env()
    scan_result = scan_drive_supported_documents(folder_ids=folder_ids, include_subfolders=include_subfolders)

    downloaded_paths = [document.local_path for document in scan_result.documents]

    files_to_process, skipped_files, warning = check_files_already_processed(tracker, downloaded_paths)

    skipped_set = set(path for path, _ in skipped_files)
    for downloaded in downloaded_paths:
        path = Path(downloaded)
        if path.name in skipped_set:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass

    return DriveScanResult(
        files_to_process=files_to_process,
        skipped_files=skipped_files,
        discovered_count=scan_result.discovered_count,
        temp_dir=scan_result.temp_dir,
        warning=warning,
    )


def scan_google_drive_supported_documents(include_subfolders: bool = True) -> tuple[list[DriveDocument], str]:
    """Scans configured Drive folders and downloads supported documents with metadata."""
    folder_ids = load_drive_folder_ids_from_env()
    scan_result = scan_drive_supported_documents(folder_ids=folder_ids, include_subfolders=include_subfolders)
    return scan_result.documents, scan_result.temp_dir


def cleanup_drive_scan_result(scan_result: DriveScanResult | None) -> None:
    if scan_result is None:
        return

    if scan_result.temp_dir:
        shutil.rmtree(scan_result.temp_dir, ignore_errors=True)