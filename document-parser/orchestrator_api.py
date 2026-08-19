"""
REST API to expose the document orchestrator functionality.

Endpoints:
- POST /api/orchestrate - Run full multi-workspace orchestration
- POST /api/orchestrate/workspace/{workspace_id} - Run orchestration for a workspace
- GET /api/status - Health check
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from document_orchestrator import orchestrate_all_active_workspaces, orchestrate_workspace, process_uploaded_inbox_file
from firebase_workspace_config import FirebaseWorkspaceConfigManager


load_dotenv()

logger = logging.getLogger(__name__)
if not logger.handlers:
	handler = logging.StreamHandler()
	handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
	logger.addHandler(handler)
logger.setLevel(logging.DEBUG)
logger.propagate = False


# Pydantic models
class OrchestrationRequest(BaseModel):
	"""Request body for orchestration endpoints."""
	model: str = Field(default="gpt-4o", description="OpenAI model to use")
	include_subfolders: bool = Field(default=True, description="Include subfolders in Drive scan")
	send_to_sheet: bool = Field(default=True, description="Send results to Google Sheets")


class InboxUploadProcessingRequest(BaseModel):
	"""A manually uploaded Drive file to process through inbox routing."""
	workspace_id: str = Field(min_length=1)
	file_id: str = Field(min_length=1)


class RuleInfo(BaseModel):
	"""Rule information."""
	rule_id: str
	rule_name: str
	source_folder_id: str
	target_folder_id: str
	target_sheet_id: str
	sheet_tab_name: str
	is_enabled: bool


class StatusResponse(BaseModel):
	"""Health check response."""
	status: str = "healthy"
	timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
	version: str = "1.0"


def get_api_key(orchestrator_api_key: str | None = Header(None)) -> str:
	"""Extract and validate API key from Orchestrator-API-Key header."""
	logger.debug(f"get_api_key called with Orchestrator-API-Key header: {bool(orchestrator_api_key)}")
	
	api_key = orchestrator_api_key.strip() if orchestrator_api_key else ""
	
	# Get expected key from env var
	expected_key = (os.getenv("ORCHESTRATOR_API_KEY") or "").strip()
	logger.debug(f"Expected key from env (length: {len(expected_key)})")
	
	if not expected_key:
		logger.error("ORCHESTRATOR_API_KEY environment variable not set!")
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="Server not properly configured"
		)
	
	if not api_key:
		logger.error("No API key provided in Orchestrator-API-Key header")
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid or missing API key"
		)
	
	if api_key != expected_key:
		logger.error(f"API key mismatch: provided={api_key[:10]}... expected={expected_key[:10]}...")
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid or missing API key"
		)
	
	logger.info("API key validation successful")
	return api_key


# Create FastAPI app
app = FastAPI(
	title="Document Orchestrator API",
	description="REST API for multi-workspace document orchestration",
	version="1.0.0",
)

config_manager = FirebaseWorkspaceConfigManager()


@app.get("/api/status", response_model=StatusResponse)
async def health_check() -> StatusResponse:
	"""Health check endpoint."""
	return StatusResponse()


@app.post("/api/orchestrate")
async def run_full_orchestration(
	request: OrchestrationRequest,
	authorization: str | None = Depends(get_api_key),
) -> dict[str, Any]:
	"""Run full multi-workspace orchestration.
	
	Processes all active workspaces and their enabled rules.
	"""
	
	logger.info(
		"API: Starting full orchestration model=%s include_subfolders=%s send_to_sheet=%s",
		request.model,
		request.include_subfolders,
		request.send_to_sheet,
	)
	
	try:
		result = orchestrate_all_active_workspaces(
			model=request.model,
			include_subfolders=request.include_subfolders,
			send_to_sheet=request.send_to_sheet,
		)
		return result
	except Exception as exc:
		logger.exception("API: Full orchestration failed: %s", exc)
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail=f"Orchestration failed: {exc}"
		)


@app.post("/api/orchestrate/workspace/{workspace_id}")
async def run_workspace_orchestration(
	workspace_id: str,
	request: OrchestrationRequest,
	authorization: str | None = Depends(get_api_key),
) -> dict[str, Any]:
	"""Run orchestration for a specific workspace.
	
	Processes all enabled rules for the given workspace.
	"""
	
	logger.info(
		"API: Starting workspace orchestration workspace_id=%s model=%s",
		workspace_id,
		request.model,
	)
	
	try:
		workspace = config_manager.get_workspace(workspace_id)
		if not workspace:
			raise HTTPException(
				status_code=status.HTTP_404_NOT_FOUND,
				detail=f"Workspace {workspace_id} not found"
			)
		
		enabled_rules = config_manager.get_enabled_rules(workspace_id)
		return orchestrate_workspace(
			workspace_id=workspace_id,
			workspace_config=workspace,
			rules=enabled_rules,
			model=request.model,
			include_subfolders=request.include_subfolders,
			send_to_sheet=request.send_to_sheet,
		)
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("API: Workspace orchestration failed: %s", exc)
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail=f"Orchestration failed: {exc}"
		)


@app.post("/api/process-inbox-upload")
async def process_inbox_upload(
	request: InboxUploadProcessingRequest,
	authorization: str | None = Depends(get_api_key),
) -> dict[str, Any]:
	"""Process one uploaded inbox file through content-based rule selection."""
	workspace_id = request.workspace_id.strip()
	file_id = request.file_id.strip()
	workspace = config_manager.get_workspace(workspace_id)
	if not workspace:
		raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

	try:
		result = process_uploaded_inbox_file(
			workspace_id=workspace_id,
			workspace_config=workspace,
			file_id=file_id,
			model=(os.getenv("OPENAI_MODEL") or "gpt-4o").strip(),
		)
		return {"success": True, "result": result}
	except ValueError as exc:
		raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
	except Exception as exc:
		logger.exception("Manual inbox upload processing failed workspace=%s", workspace_id)
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="Unable to process the uploaded file",
		) from exc

if __name__ == "__main__":
	import uvicorn
	
	port = int(os.getenv("ORCHESTRATOR_API_PORT", "8000"))
	host = os.getenv("ORCHESTRATOR_API_HOST", "0.0.0.0")
	
	logger.info("Starting Orchestrator API on %s:%s", host, port)
	uvicorn.run(
		"orchestrator_api:app",
		host=host,
		port=port,
		reload=os.getenv("ENV", "production") == "development",
	)
