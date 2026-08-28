from __future__ import annotations

import argparse
import importlib
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = REPOSITORY_ROOT / "document-parser"
sys.path.insert(0, str(SERVICE_ROOT))

print("Loading reset dependencies...", flush=True)

from dotenv import load_dotenv
from googleapiclient.http import MediaFileUpload

document_processing = importlib.import_module("document_processing")
firebase_workspace_config = importlib.import_module("firebase_workspace_config")
google_drive_service = importlib.import_module("google_drive_service")

SUPPORTED_EXTENSIONS = document_processing.SUPPORTED_EXTENSIONS
FirebaseWorkspaceConfigManager = firebase_workspace_config.FirebaseWorkspaceConfigManager
FOLDER_MIME_TYPE = google_drive_service.FOLDER_MIME_TYPE
build_drive_service = google_drive_service.build_drive_service


DEFAULT_WORKSPACE_ID = "0AnOU7ugOCg05aa4ZgSXco4vZOr1"
DEFAULT_DRIVE_FOLDER_ID = "1oH_-rVoYyo6FJ3I8hBFQFOOi1Jx1HcTZ"
DEFAULT_SOURCE_DIR = Path(r"C:\Users\segovia\Downloads\Test parser")
DEFAULT_API_URL = "http://127.0.0.1:8000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset a workspace test run, upload local documents, and run orchestration."
    )
    parser.add_argument("--workspace-id", default=DEFAULT_WORKSPACE_ID)
    parser.add_argument("--drive-folder-id", default=DEFAULT_DRIVE_FOLDER_ID)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-4o"))
    parser.add_argument("--no-send-to-sheet", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def get_source_files(source_dir: Path) -> list[Path]:
    if not source_dir.is_dir():
        raise RuntimeError(f"Source directory does not exist: {source_dir}")

    files = sorted(
        path
        for path in source_dir.iterdir()
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    if not files:
        raise RuntimeError(f"No supported documents found in: {source_dir}")
    return files


def validate_workspace_folder(
    manager: Any,
    workspace_id: str,
    drive_folder_id: str,
) -> Any:
    workspace = manager.get_workspace(workspace_id)
    if workspace is None:
        raise RuntimeError(f"Workspace not found: {workspace_id}")
    if not workspace.active:
        raise RuntimeError(f"Workspace is inactive: {workspace_id}")
    if not workspace.google_refresh_token:
        raise RuntimeError(f"Workspace has no Google refresh token: {workspace_id}")

    if workspace.execution_mode == "single_source":
        configured_folder_id = workspace.routing.inbox_folder_id if workspace.routing else ""
        if configured_folder_id != drive_folder_id:
            raise RuntimeError(
                f"Drive folder {drive_folder_id} does not match workspace inbox {configured_folder_id}."
            )
    else:
        source_folder_ids = {
            rule.source_folder_id
            for rule in manager.get_enabled_rules(workspace_id)
            if rule.source_folder_id
        }
        if drive_folder_id not in source_folder_ids:
            raise RuntimeError(
                f"Drive folder {drive_folder_id} is not used by an enabled workspace rule."
            )

    return workspace


def validate_drive_folder(service: Any, drive_folder_id: str) -> dict[str, Any]:
    folder = (
        service.files()
        .get(
            fileId=drive_folder_id,
            fields="id,name,mimeType,capabilities(canAddChildren)",
            supportsAllDrives=True,
        )
        .execute()
    )
    if folder.get("mimeType") != FOLDER_MIME_TYPE:
        raise RuntimeError(f"Drive target is not a folder: {drive_folder_id}")
    if not folder.get("capabilities", {}).get("canAddChildren"):
        raise RuntimeError(f"Workspace cannot upload to Drive folder: {drive_folder_id}")
    return folder


def reset_workspace_executions(manager: Any, workspace_id: str) -> None:
    workspace_execution = (
        manager._get_db().collection("workspace_executions").document(workspace_id)
    )
    manager._get_db().recursive_delete(workspace_execution)

    if workspace_execution.get().exists:
        raise RuntimeError("Workspace execution parent still exists after reset.")
    if list(workspace_execution.collection("processed_files").limit(1).stream()):
        raise RuntimeError("Processed file records still exist after reset.")
    if list(workspace_execution.collection("runs").limit(1).stream()):
        raise RuntimeError("Run records still exist after reset.")


def upload_files(service: Any, drive_folder_id: str, files: list[Path]) -> list[dict[str, str]]:
    uploaded: list[dict[str, str]] = []
    for path in files:
        media = MediaFileUpload(
            str(path),
            mimetype=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            resumable=True,
        )
        uploaded.append(
            service.files()
            .create(
                body={"name": path.name, "parents": [drive_folder_id]},
                media_body=media,
                fields="id,name",
                supportsAllDrives=True,
            )
            .execute()
        )
    return uploaded


def api_is_healthy(api_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{api_url.rstrip('/')}/api/status", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def ensure_api_running(api_url: str) -> bool:
    if api_is_healthy(api_url):
        return False

    popen_options: dict[str, Any] = {
        "cwd": SERVICE_ROOT,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        popen_options["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )
    else:
        popen_options["start_new_session"] = True

    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "orchestrator_api:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        **popen_options,
    )

    for _ in range(30):
        if api_is_healthy(api_url):
            return True
        time.sleep(0.5)
    raise RuntimeError(f"Orchestrator API did not become healthy at {api_url}.")


def run_orchestration(
    api_url: str,
    workspace_id: str,
    model: str,
    send_to_sheet: bool,
) -> dict[str, Any]:
    api_key = (os.getenv("ORCHESTRATOR_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ORCHESTRATOR_API_KEY is not configured.")

    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/orchestrate/workspace/{workspace_id}",
        data=json.dumps(
            {
                "model": model,
                "include_subfolders": True,
                "send_to_sheet": send_to_sheet,
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Orchestrator-API-Key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=3600) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Orchestration API returned HTTP {exc.code}: {details}") from exc


def main() -> None:
    load_dotenv(SERVICE_ROOT / ".env")
    args = parse_args()
    print("Validating source files and workspace configuration...", flush=True)
    files = get_source_files(args.source_dir.resolve())
    manager = FirebaseWorkspaceConfigManager()
    workspace = validate_workspace_folder(manager, args.workspace_id, args.drive_folder_id)
    print("Validating Google Drive destination...", flush=True)
    drive_service = build_drive_service(
        refresh_token=workspace.google_refresh_token
    )
    folder = validate_drive_folder(drive_service, args.drive_folder_id)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "workspace_id": args.workspace_id,
                    "execution_mode": workspace.execution_mode,
                    "drive_folder": {"id": folder["id"], "name": folder["name"]},
                    "source_files": [path.name for path in files],
                    "api_url": args.api_url,
                },
                indent=2,
            )
        )
        return

    print("Resetting workspace execution state...", flush=True)
    reset_workspace_executions(manager, args.workspace_id)
    print(f"Uploading {len(files)} source file(s)...", flush=True)
    uploaded = upload_files(drive_service, args.drive_folder_id, files)
    print("Ensuring orchestrator API is running...", flush=True)
    api_started = ensure_api_running(args.api_url)
    print("Running workspace orchestration; document processing may take several minutes...", flush=True)
    orchestration = run_orchestration(
        args.api_url,
        args.workspace_id,
        args.model,
        not args.no_send_to_sheet,
    )
    print(
        json.dumps(
            {
                "workspace_id": args.workspace_id,
                "execution_state_reset": True,
                "uploaded": uploaded,
                "api_started": api_started,
                "orchestration": orchestration,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Test environment reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc