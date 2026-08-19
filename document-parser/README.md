# Document Parser

A multi-workspace invoice and receipt processor that scans Google Drive, extracts structured data with OpenAI, records processing state in Firebase Firestore, moves processed files, and writes results to Google Sheets. It can be run through a FastAPI service or directly from the command line.

## Processing flow

1. Load active workspaces and their enabled rules from Firestore.
2. Dispatch by `execution_mode`; missing values default to `source_by_rule`.
3. In `source_by_rule`, scan and execute each rule's Google Drive source folder as before.
4. In `single_source`, scan the workspace inbox once, parse each document once, and use OpenAI to select one enabled rule.
5. Keep unmatched single-source documents in the inbox without running rule actions.
6. Move matched files and write invoice fields to the selected rule's Google Sheet.
7. Store unified file state and run summaries under `workspace_executions`.

Supported files: `.txt`, `.pdf`, `.docx`, `.jpg`, `.jpeg`, and `.png`.

## Database model

Firestore is schemaless, but the application writes the following logical model. `RULES` belongs to `WORKSPACES`; both execution modes share workspace-level file tracking.

```mermaid
erDiagram
	WORKSPACES ||--o{ RULES : configures
	WORKSPACES ||--|| WORKSPACE_EXECUTIONS : records
	EXTRACTION_SCHEMES ||--o{ RULES : selected_by
	WORKSPACE_EXECUTIONS ||--o{ PROCESSED_FILES : tracks
	WORKSPACE_EXECUTIONS ||--o{ RUNS : contains

	WORKSPACES {
		string workspace_id PK
		string name
		string email
		boolean active
		string execution_mode
		map routing
		string refresh_token
		string displayName
		string photoURL
		timestamp created_at
		timestamp updated_at
		timestamp last_sign_in
	}

	RULES {
		string rule_id PK
		string workspace_id FK
		string rule_name
		string source_folder_id
		string source_folder_name
		string target_folder_id
		string target_folder_name
		string target_sheet_id
		string target_sheet_name
		string sheet_tab_name
		string schema_id FK
		boolean is_enabled
		number priority
		string condition_mode
		array conditions
		map actions
		timestamp created_at
		timestamp updated_at
	}

	EXTRACTION_SCHEMES {
		string schema_id PK
		string name
		number version
		boolean is_enabled
		boolean strict
		string parsing_prompt
		map schema
		map identity
	}

	WORKSPACE_EXECUTIONS {
		string workspace_id PK
		string last_execution_mode
		string last_status
		timestamp last_started_at
		timestamp last_completed_at
	}

	PROCESSED_FILES {
		string document_id PK
		string workspace_id FK
		string selected_rule_id FK
		string drive_file_id
		string source_file_name
		string execution_mode
		string schema_id FK
		number schema_version
		string status
		timestamp executed_at
		map parsed_data
	}

	RUNS {
		string execution_id PK
		string execution_mode
		string status
		timestamp started_at
		timestamp completed_at
	}
```

Collection paths:

- `workspaces/{workspace_id}`
- `workspaces/{workspace_id}/rules/{rule_id}`
- `user-accounts/{account_id}`
- `extraction_schemes/{schema_id}`
- `workspace_executions/{workspace_id}/processed_files/{document_id}`
- `workspace_executions/{workspace_id}/runs/{execution_id}`

## Prerequisites

Choose either:

- Python 3.11 or later, or
- Docker with Docker Compose.

The application also requires:

- An OpenAI API key with access to the selected model.
- A Firebase project with Firestore enabled.
- A Firebase service account that can read and write Firestore.
- A Google Cloud OAuth 2.0 client ID and client secret.
- A Google refresh token authorized for Google Drive and Google Sheets.
- Google Drive and Google Sheets APIs enabled in the Google Cloud project.
- Source and target Drive folders and a target Google spreadsheet accessible to the Google account that issued the refresh token.

## Google OAuth setup

1. In Google Cloud Console, enable **Google Drive API** and **Google Sheets API**.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 client and retain its client ID and client secret.
4. Authorize the Google account that owns or can access the Drive folders and spreadsheet.
5. Obtain an offline refresh token using these scopes:
	 - `https://www.googleapis.com/auth/drive`
	 - `https://www.googleapis.com/auth/spreadsheets`
6. Store the client ID and secret as deployment environment variables. Store each workspace refresh token in its Firestore workspace document.

The refresh token must have been issued to the same OAuth client configured by `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Workspace environments, an administrator may also need to allow the OAuth application.

## Environment configuration

Create a `.env` file in the project root. Do not commit it.

```dotenv
# API
ORCHESTRATOR_API_KEY=replace-with-a-long-random-value
ORCHESTRATOR_API_HOST=0.0.0.0
ORCHESTRATOR_API_PORT=8000

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Firebase: use one of these options
FIREBASE_SERVICE_ACCOUNT_FILE=C:/secure/firebase-service-account.json
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FIREBASE_WORKSPACES_COLLECTION=workspaces
FIREBASE_TRACK_PROCESSED=true
FIREBASE_EXTRACTION_SCHEMES_COLLECTION=extraction_schemes

# Google OAuth client used for every workspace
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Optional local integration defaults
GOOGLE_REFRESH_TOKEN=your-google-refresh-token
GOOGLE_DRIVE_FOLDER_IDS=source-drive-folder-id
GOOGLE_SHEETS_SPREADSHEET_ID=target-spreadsheet-id
GOOGLE_SHEETS_WORKSHEET=Salidas

# Optional destination folder prefix; defaults to Facturas
GOOGLE_DRIVE_INVOICES_BASE_PATH=Facturas
```

`FIREBASE_SERVICE_ACCOUNT_FILE` is convenient for local development. For containers and hosted environments, `FIREBASE_SERVICE_ACCOUNT_JSON` is usually easier because it does not require a separate credential-file mount.

Workspace refresh tokens and routing are stored in Firestore workspace documents.

## Firestore configuration

Each active workspace is stored at `workspaces/{workspace_id}`:

```json
{
	"name": "Example workspace",
	"active": true,
	"execution_mode": "source_by_rule",
	"refresh_token": "Google OAuth refresh token"
}
```

For `single_source`, add workspace routing:

```json
{
	"execution_mode": "single_source",
	"routing": {
		"inbox_folder_id": "google-drive-inbox-folder-id",
		"schema_id": "arg-invoices",
		"include_subfolders": true,
		"selection_strategy": "llm",
		"multiple_match_policy": "highest_priority"
	}
}
```

Each processing rule is stored at `workspaces/{workspace_id}/rules/{rule_id}`:

```json
{
	"rule_id": "invoices",
	"rule_name": "Incoming invoices",
	"source_folder_id": "google-drive-source-folder-id",
	"target_folder_id": "google-drive-target-folder-id",
	"target_sheet_id": "google-spreadsheet-id",
	"sheet_tab_name": "Salidas",
	"schema_id": "arg-invoices",
	"is_enabled": true
}
```

Extraction schemes are shared globally and stored at `extraction_schemes/{schema_id}`. Each scheme owns its `parsing_prompt`, response `schema`, and document `identity` configuration. The `schema_id` on each rule selects the complete scheme used for that rule. Existing rules without this field use `arg-invoices`.

Each extraction scheme also defines ordered identity strategies. The first strategy with all required extracted fields produces the canonical document ID. Processing records for both modes are workspace-scoped at `workspace_executions/{workspace_id}/processed_files/{document_id}`. Canonical records use the generated identity key as `document_id`; duplicate records use a `duplicated-` prefix. Existing rule-scoped records are read as a fallback and copied lazily into unified tracking without deleting the legacy data.

After changing an extraction scheme, increment its `version` and upload it to Firestore. The version change causes unchanged Drive sources to be re-extracted.

The service account identified by `FIREBASE_SERVICE_ACCOUNT_FILE` or `FIREBASE_SERVICE_ACCOUNT_JSON` must be authorized to read and write these documents and the processing records created by the application.

## Run locally

From PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn orchestrator_api:app --host 0.0.0.0 --port 8000
```

Verify the API in another terminal:

```powershell
Invoke-RestMethod http://localhost:8000/api/status
```

Open `http://localhost:8000/docs` for the interactive OpenAPI interface.

## Run with Docker Compose

Docker Compose reads the project-root `.env` file. For this path, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON value.

```powershell
docker compose up --build -d
docker compose logs -f orchestrator-api
```

The API is available at `http://localhost:8000` by default. Set `API_PORT` in `.env` to publish a different host port.

```powershell
docker compose down
```

## Start orchestration

All active workspaces:

```powershell
$headers = @{ "Orchestrator-API-Key" = $env:ORCHESTRATOR_API_KEY }
$body = @{
		model = "gpt-4o"
		include_subfolders = $true
		send_to_sheet = $true
} | ConvertTo-Json

Invoke-RestMethod `
		-Method Post `
		-Uri http://localhost:8000/api/orchestrate `
		-Headers $headers `
		-ContentType "application/json" `
		-Body $body
```

One workspace can be processed through `POST /api/orchestrate/workspace/{workspace_id}` with the same headers and request body.

To run without the API:

```powershell
python document_orchestrator.py --model gpt-4o --send
```

Useful CLI options:

- `--no-subfolders`: scan only files directly inside each source folder.
- `--output <path>`: write the orchestration summary to a JSON file.
- `--send`: write parsed rows to Google Sheets and mark them as sent.

## Statuses and output

- `Parsed`: the document was processed for the first time.
- `Modified`: the Drive modification time changed and the document was reprocessed.
- `Sent`: parsed data was written to Google Sheets.
- Incomplete rows are written to the `Corrupted_data` worksheet and their files are moved to the `Corrupted` Drive folder.

The normal worksheet receives the columns `fecha`, `source_file`, `display_description`, and `total`. The source file is stored as a hyperlink to the Drive document.

## Troubleshooting

- **Missing Google OAuth configuration**: verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the workspace `refresh_token`.
- **Google `invalid_grant` error**: the refresh token may be revoked, expired, or issued to a different OAuth client.
- **Drive or Sheets permission error**: share the folder or spreadsheet with the Google account that authorized the refresh token.
- **Firebase credential error**: set exactly one valid Firebase service-account option and confirm that Firestore is enabled.
- **401 from an orchestration endpoint**: send the value of `ORCHESTRATOR_API_KEY` in the `Orchestrator-API-Key` header. The health endpoint does not require this header.
- **No workspaces found**: create an active Firestore workspace and its rule documents.
