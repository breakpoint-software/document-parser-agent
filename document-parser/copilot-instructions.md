# Document Parser Project Guidelines

## Architecture

This service processes invoices and receipts for independent workspaces. Workspace configuration is stored at `workspaces/{workspace_id}`, with processing rules in the `rules` subcollection.

The primary configuration types are `WorkspaceConfig`, `WorkspaceRouting`, and `RuleObject` in `firebase_workspace_config.py`. Keep `workspace_id` explicit in orchestration, persistence, logs, errors, and API responses.

The processing flow is:

1. Load active workspaces from Firestore.
2. Scan the configured Google Drive source.
3. Deduplicate and parse supported documents.
4. Persist processing and identity records.
5. Move processed files and append results to Google Sheets.

Use `orchestrate_all_active_workspaces()` for all active workspaces and `orchestrate_workspace()` for one workspace. The FastAPI endpoint for one workspace is `POST /api/orchestrate/workspace/{workspace_id}`.

## Engineering Rules

- Preserve workspace ownership and rule boundaries.
- Keep the current document status and identity lifecycle intact.
- Use type hints for function signatures and dataclasses for internal configuration.
- Use Pydantic models for API contracts.
- Raise contextual domain errors and use module logging.
- Never log or hardcode credentials, tokens, or API keys.
- Keep Firebase, Drive, Sheets, AI extraction, and orchestration responsibilities separated.
- Preserve extraction contracts: missing values use `None`, amounts remain numeric, and dates use ISO 8601.

## Validation

Run from this directory:

```powershell
.\.venv\Scripts\python.exe -m compileall -q .
.\.venv\Scripts\python.exe -m unittest discover -s test -p "test_*.py"
```
