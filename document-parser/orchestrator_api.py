"""
REST API to expose the document orchestrator functionality.

Endpoints:
- POST /api/orchestrate - Run full multi-tenant orchestration
- POST /api/orchestrate/tenant/{tenant_id} - Run orchestration for specific tenant
- POST /api/orchestrate/tenant/{tenant_id}/rule/{rule_id} - Run orchestration for specific rule
- GET /api/status - Health check
- GET /api/tenants - List all active tenants
- GET /api/tenants/{tenant_id}/rules - List rules for a tenant
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

from document_orchestrator import orchestrate_all_active_tenants, orchestrate_single_rule
from firebase_tenant_config import FirebaseTenantConfigManager, TenantConfig, RuleObject


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


class TenantInfo(BaseModel):
	"""Tenant information."""
	tenant_id: str
	name: str
	active: bool
	created_at: str | None = None


class RuleInfo(BaseModel):
	"""Rule information."""
	rule_id: str
	rule_name: str
	source_folder_id: str
	target_folder_id: str
	target_sheet_id: str
	sheet_tab_name: str
	is_enabled: bool
	parsing_prompt: str | None = None


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
	description="REST API for multi-tenant document orchestration",
	version="1.0.0",
)

config_manager = FirebaseTenantConfigManager()


@app.get("/api/status", response_model=StatusResponse)
async def health_check() -> StatusResponse:
	"""Health check endpoint."""
	return StatusResponse()


# @app.get("/api/tenants", response_model=list[TenantInfo])
# async def list_tenants(authorization: str | None = None) -> list[TenantInfo]:
# 	"""List all active tenants."""
# 	_ = get_api_key(authorization)
	
# 	try:
# 		tenants = config_manager.list_active_tenants()
# 		return [
# 			TenantInfo(
# 				tenant_id=t.tenant_id,
# 				name=t.name,
# 				active=t.active,
# 				created_at=t.created_at,
# 			)
# 			for t in tenants
# 		]
# 	except Exception as exc:
# 		logger.error("Failed to list tenants: %s", exc)
# 		raise HTTPException(
# 			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
# 			detail=f"Failed to list tenants: {exc}"
# 		)


# @app.get("/api/tenants/{tenant_id}/rules", response_model=list[RuleInfo])
# async def list_tenant_rules(
# 	tenant_id: str,
# 	authorization: str | None = None,
# ) -> list[RuleInfo]:
# 	"""List all rules for a specific tenant."""
# 	_ = get_api_key(authorization)
	
# 	try:
# 		tenant = config_manager.get_tenant(tenant_id)
# 		if not tenant:
# 			raise HTTPException(
# 				status_code=status.HTTP_404_NOT_FOUND,
# 				detail=f"Tenant {tenant_id} not found"
# 			)
		
# 		rules = config_manager.get_all_rules(tenant_id)
# 		return [
# 			RuleInfo(
# 				rule_id=r.rule_id,
# 				rule_name=r.rule_name,
# 				source_folder_id=r.source_folder_id,
# 				target_folder_id=r.target_folder_id,
# 				target_sheet_id=r.target_sheet_id,
# 				sheet_tab_name=r.sheet_tab_name,
# 				is_enabled=r.is_enabled,
# 				parsing_prompt=r.parsing_prompt,
# 			)
# 			for r in rules
# 		]
# 	except HTTPException:
# 		raise
# 	except Exception as exc:
# 		logger.error("Failed to list rules for tenant %s: %s", tenant_id, exc)
# 		raise HTTPException(
# 			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
# 			detail=f"Failed to list rules: {exc}"
# 		)


@app.post("/api/orchestrate")
async def run_full_orchestration(
	request: OrchestrationRequest,
	authorization: str | None = Depends(get_api_key),
) -> dict[str, Any]:
	"""Run full multi-tenant orchestration.
	
	Processes all active tenants and their enabled rules.
	"""
	
	logger.info(
		"API: Starting full orchestration model=%s include_subfolders=%s send_to_sheet=%s",
		request.model,
		request.include_subfolders,
		request.send_to_sheet,
	)
	
	try:
		result = orchestrate_all_active_tenants(
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


@app.post("/api/orchestrate/tenant/{tenant_id}")
async def run_tenant_orchestration(
	tenant_id: str,
	request: OrchestrationRequest,
	authorization: str | None = Depends(get_api_key),
) -> dict[str, Any]:
	"""Run orchestration for a specific tenant.
	
	Processes all enabled rules for the given tenant.
	"""
	
	logger.info(
		"API: Starting tenant orchestration tenant_id=%s model=%s",
		tenant_id,
		request.model,
	)
	
	try:
		tenant = config_manager.get_tenant(tenant_id)
		if not tenant:
			raise HTTPException(
				status_code=status.HTTP_404_NOT_FOUND,
				detail=f"Tenant {tenant_id} not found"
			)
		
		enabled_rules = config_manager.get_enabled_rules(tenant_id)
		if not enabled_rules:
			return {
				"ok": True,
				"tenant_id": tenant_id,
				"tenant_name": tenant.name,
				"warning": "No enabled rules",
				"rules_processed": 0,
				"rules_results": [],
			}
		
		rules_results = []
		total_parsed = 0
		total_modified = 0
		total_sent = 0
		total_moved = 0
		total_corrupted = 0
		total_errors = 0
		
		for rule in enabled_rules:
			rule_result = orchestrate_single_rule(
				tenant_id=tenant_id,
				tenant_config=tenant,
				rule=rule,
				model=request.model,
				include_subfolders=request.include_subfolders,
				send_to_sheet=request.send_to_sheet,
			)
			rules_results.append(rule_result)
			
			if rule_result.get("ok"):
				total_parsed += rule_result.get("parsed", 0)
				total_modified += rule_result.get("modified", 0)
				total_sent += rule_result.get("sent", 0)
				total_moved += rule_result.get("moved", 0)
				total_corrupted += rule_result.get("corrupted", 0)
				total_errors += len(rule_result.get("errors", []))
		
		return {
			"ok": True,
			"tenant_id": tenant_id,
			"tenant_name": tenant.name,
			"rules_processed": len(rules_results),
			"parsed": total_parsed,
			"modified": total_modified,
			"sent": total_sent,
			"moved": total_moved,
			"corrupted": total_corrupted,
			"errors": total_errors,
			"rules_results": rules_results,
		}
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("API: Tenant orchestration failed: %s", exc)
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail=f"Orchestration failed: {exc}"
		)


# @app.post("/api/orchestrate/tenant/{tenant_id}/rule/{rule_id}")
# async def run_rule_orchestration(
# 	tenant_id: str,
# 	rule_id: str,
# 	request: OrchestrationRequest,
# 	authorization: str | None = None,
# ) -> dict[str, Any]:
# 	"""Run orchestration for a specific rule of a specific tenant."""
# 	_ = get_api_key(authorization)
	
# 	logger.info(
# 		"API: Starting rule orchestration tenant_id=%s rule_id=%s model=%s",
# 		tenant_id,
# 		rule_id,
# 		request.model,
# 	)
	
# 	try:
# 		tenant = config_manager.get_tenant(tenant_id)
# 		if not tenant:
# 			raise HTTPException(
# 				status_code=status.HTTP_404_NOT_FOUND,
# 				detail=f"Tenant {tenant_id} not found"
# 			)
		
# 		all_rules = config_manager.get_all_rules(tenant_id)
# 		rule = next((r for r in all_rules if r.rule_id == rule_id), None)
		
# 		if not rule:
# 			raise HTTPException(
# 				status_code=status.HTTP_404_NOT_FOUND,
# 				detail=f"Rule {rule_id} not found for tenant {tenant_id}"
# 			)
		
# 		if not rule.is_enabled:
# 			return {
# 				"ok": False,
# 				"error": f"Rule {rule_id} is disabled",
# 				"tenant_id": tenant_id,
# 				"rule_id": rule_id,
# 			}
		
# 		result = orchestrate_single_rule(
# 			tenant_id=tenant_id,
# 			tenant_config=tenant,
# 			rule=rule,
# 			model=request.model,
# 			include_subfolders=request.include_subfolders,
# 			send_to_sheet=request.send_to_sheet,
# 		)
# 		return result
# 	except HTTPException:
# 		raise
# 	except Exception as exc:
# 		logger.exception("API: Rule orchestration failed: %s", exc)
# 		raise HTTPException(
# 			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
# 			detail=f"Orchestration failed: {exc}"
# 		)


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
