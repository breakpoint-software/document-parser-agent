---
description: "Use when changing the Python document-processing service, FastAPI orchestration, Firebase persistence, Google Drive or Sheets integrations, receipt parsing, extraction, or Python tests in document-parser."
applyTo: "document-parser/**"
---

# Python Service Instructions

## Architecture and Types

- Follow the existing multi-workspace architecture. Keep workspace and rule identifiers explicit throughout orchestration, integrations, and persistence.
- Preserve workspace isolation across orchestration and persistence.
- Maintain the processing flow: scan Drive, deduplicate, parse, persist, move files, and send results to Sheets.
- Keep the existing ownership boundaries among orchestration, document processing, AI extraction, Firebase, Drive, Sheets, API, and CLI modules.
- Use `from __future__ import annotations` in modules following the existing convention.
- Add type hints to function signatures and prefer precise types over `Any`.
- Use dataclasses for internal configuration and Pydantic models for API contracts where established.
- Use structured parsers and serializers for JSON and API data.

## Errors, Logging, and Data

- Raise contextual domain errors early and use module logging rather than `print` in application code.
- Include relevant workspace ID, rule ID, and file name in processing errors without exposing credentials.
- Handle per-document integration failures so one failed item does not unnecessarily stop unrelated processing.
- Never hardcode API keys, OAuth credentials, Firebase credentials, tokens, or environment-specific endpoints.
- Preserve the current document status lifecycle and identity/deduplication behavior.
- Keep Firebase collection paths and workspace/rule ownership semantics consistent.
- Preserve extraction contracts: missing values use `None`, amounts remain numeric, and dates normalize to ISO 8601.
- Keep secrets and credentials out of logs, exceptions returned by the API, fixtures, and source control.
- Do not make application code or tests depend on files under `seed/`.

## Validation

Run from `document-parser/`:

```powershell
.\.venv\Scripts\python.exe -m compileall -q .
.\.venv\Scripts\python.exe -m unittest discover -s test -p "test_*.py"
```

If `.venv` is unavailable, use the selected project interpreter. Report unrelated existing failures separately and do not fix them unless they block the requested behavior.