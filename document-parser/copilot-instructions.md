# Document Parser Project Guidelines

## Project Overview

This is a **multi-tenant document processing system** designed for parsing purchase receipts and invoices using AI (GPT models). It combines:
- **FastAPI REST API** for programmatic orchestration
- **Firebase Firestore** for persistent data storage and tenant configuration
- **Google Drive** integration for document scanning and file movement
- **Google Sheets** integration for result export
- **Docker** containerization for deployment

The system supports **multi-tenant operations** where each tenant has multiple processing rules, credentials, and Drive/Sheets integrations.

---

## Architecture & Code Patterns

### 1. **Multi-Tenant Architecture**

**Core Principle**: All processing is tenant-aware. The system operates in two modes:

#### Legacy Mode (Single-Tenant from .env)
- Uses environment variables for configuration
- Single set of credentials per instance
- Backward compatible with original implementation
- Flag: `--legacy` in CLI

#### Multi-Tenant Mode (Recommended)
- Tenants loaded from Firebase: `tenants/{tenant_id}`
- Each tenant has subcollections:
  - `tenants/{tenant_id}/credentials` → OAuth & API keys
  - `tenants/{tenant_id}/rules/{rule_id}` → Processing rules
- Entry point: `orchestrate_all_active_tenants()` in `document_orchestrator.py`

**Key Data Structures** (in `firebase_tenant_config.py`):
```python
@dataclass
class TenantConfig:
    tenant_id: str
    name: str
    active: bool
    credentials: CredentialsObject  # OpenAI API key, Google OAuth refresh token
    rules: list[RuleObject] | None
    created_at: str | None

@dataclass
class RuleObject:
    rule_id: str
    rule_name: str
    source_folder_id: str  # Google Drive folder to scan
    target_folder_id: str  # Where to move processed files
    target_sheet_id: str   # Google Sheets to append results
    sheet_tab_name: str
    parsing_prompt: str | None  # Custom extraction instructions (optional)
    is_enabled: bool
```

### 2. **Document Processing Pipeline**

**Flow**: Scan Drive → Deduplicate → Parse → Persist → Move Files → Send to Sheets

**Key Entry Points**:
- `orchestrate_all_active_tenants()` - Process all active tenants and their rules
- `orchestrate_single_rule(tenant_id, tenant_config, rule, model)` - Process one rule for one tenant
- `receipt_parser.py` - CLI for parsing local documents

**Document Status Lifecycle**:
- `Parsed` - Document processed for the first time
- `Modified` - File exists in Firebase but Drive `modifiedTime` changed (reprocessed)
- `Sent` - Document was parsed and results sent to Google Sheets

**Deduplication**:
- Tracked in Firebase: `processed_files/{tenant_id}` (or `processed_files` in legacy mode)
- Each entry stores: file hash, file name, timestamp
- Builders: `build_firebase_tracker(tenant_id=None)` in `firebase_processed_files.py`

### 3. **Firebase Data Model**

**Collections Structure**:
```
tenants/{tenant_id}
  ├─ credentials (document)
  │  └─ openai_api_key
  ├─ refresh_token
  ├─ rules/{rule_id} (subcollection)
  │  └─ rule_id, rule_name, source_folder_id, target_folder_id, 
  │     target_sheet_id, sheet_tab_name, parsing_prompt, is_enabled
  └─ (metadata fields: name, active, created_at)

processed_files/{tenant_id}
  └─ {document_hash} (document)
     └─ file_hash, file_name, timestamp

processed_documents/{tenant_id}
  └─ {document_id} (document)
     └─ status (Parsed|Modified|Sent), parsed_data, timestamp, modificationDate
```

**Default Tenant**:
- Auto-created from `.env` variables if no tenants exist in Firebase
- Persisted **before** orchestration starts (ensures persistence before processing)
- Uses: `_create_default_tenant_from_env()` in `document_orchestrator.py`

### 4. **REST API Architecture** (FastAPI)

**File**: `orchestrator_api.py`  
**Port**: 8000 (or 9000 in Docker)  
**Security**: API key validation via `Orchestrator-API-Key` header

**Endpoints**:
```
POST /api/orchestrate
  └─ Run full multi-tenant orchestration

POST /api/orchestrate/tenant/{tenant_id}
  └─ Run orchestration for specific tenant (all its rules)

POST /api/orchestrate/tenant/{tenant_id}/rule/{rule_id}
  └─ Run orchestration for specific rule only

GET /api/status
  └─ Health check (returns status, timestamp, version)

GET /api/tenants
  └─ List all active tenants with metadata

GET /api/tenants/{tenant_id}/rules
  └─ List all rules for a tenant
```

**Request/Response Models** (Pydantic):
- `OrchestrationRequest` - model, include_subfolders, send_to_sheet
- `TenantInfo`, `RuleInfo` - Tenant and rule metadata
- `StatusResponse` - Health check with timestamp

## Code Style & Conventions

### 1. **Type Hints & Imports**

All files start with:
```python
from __future__ import annotations
```

This enables modern type hint syntax throughout (e.g., `list[str]` instead of `List[str]`, `str | None` instead of `Optional[str]`).

**Style**:
- Use type hints on all function signatures
- Use `Any` only when truly necessary
- Prefer `dataclass` + `BaseModel` for data structures

### 2. **Error Handling**

Custom exception classes for domain-specific errors:
```python
class FirebaseConfigError(RuntimeError):
    """Raised when Firebase configuration is missing or invalid."""

class GoogleSheetsConfigError(RuntimeError):
    """Raised when Google Sheets configuration is missing."""
```

Pattern: Raise early, include context in error messages.

### 3. **Logging**

Standardized setup (all modules):
```python
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger.addHandler(handler)
logger.setLevel(logging.DEBUG)
logger.propagate = False
```

### 4. **Environment Configuration**

- Load `.env` via `python-dotenv`:
  ```python
  from dotenv import load_dotenv
  load_dotenv()
  ```
- Read with defaults: `os.getenv("KEY", "default_value")`
- Validate on startup (raise `FirebaseConfigError` if missing)

### 5. **Data Validation & Serialization**

- Use `Pydantic BaseModel` for API models
- Use `@dataclass` for internal config objects with custom `.to_dict()` / `.from_dict()` methods
- JSON serialization respects types (null for None, arrays for lists, numbers for floats)

### 6. **Module Organization**

```
Core orchestration:
  ├─ document_orchestrator.py    # Main pipeline + tenant logic
  ├─ document_processing.py      # File loading, text extraction
  └─ receipt_ai.py               # AI extraction with structured output

Firebase:
  ├─ firebase_processed_files.py # Deduplication tracker
  └─ firebase_tenant_config.py   # Tenant + rule management

Integrations:
  ├─ google_drive_service.py     # Drive API wrapper
  ├─ google_drive_scanner.py     # Folder scanning logic
  └─ google_sheets_service.py    # Sheets API wrapper

APIs:
  └─ orchestrator_api.py         # FastAPI REST endpoints

Utilities:
  ├─ receipt_results.py          # Result data structures
  └─ receipt_parser.py           # CLI for local parsing
```

---

## Document Parsing & Extraction

### 1. **Supported File Types**

```python
SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx", ".jpg", ".jpeg", ".png"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
```

**Text Extraction**:
- `.txt` → Direct read (UTF-8)
- `.pdf` → PyPDF extraction per page
- `.docx` → python-docx paragraph extraction
- `.jpg`, `.png` → Base64 Data URI (sent to GPT with vision)

### 2. **AI Extraction Schema**

**Model**: GPT (configurable, default `gpt-4o`)  
**Method**: Structured output (JSON schema validation)

**Extracted Fields** (Argentina purchase receipts):
```json
{
  "document_type": "purchase_receipt|unknown",
  "fecha": "ISO 8601 date or null",
  "fecha_vencimiento": "ISO 8601 date or null",
  "cuit_proveedor": "string or null (CUIT: Código Único de Identificación Tributaria)",
  "description_proveedor": "vendor name or null",
  "moneda": "currency code (ARS, USD, etc.)",
  "subtotal": "number or null",
  "taxes": "number or null",
  "total": "number or null"
}
```

**Instructions** (in `receipt_ai.py`):
- Extract only purchase receipts; mark unknown documents as `unknown` if no purchase data found
- Use null for missing fields (not empty strings or 0)
- Copy amounts as numbers, not strings
- Use ISO 8601 for dates
- Custom prompts per rule allowed (stored in `RuleObject.parsing_prompt`)

### 3. **File Movement (Drive Organization)**

After successful parsing, files are moved:
- **Valid invoices** (parseable date) → `{GOOGLE_DRIVE_FACTURAS_BASE_PATH}/yyyyMM/`
  - Example: `Facturas/202501/invoice.pdf`
- **Corrupted/invalid** (missing required fields or unparseable date) → `{GOOGLE_DRIVE_FACTURAS_BASE_PATH}/Corrupted/`

**Configuration** (environment variables):
```
GOOGLE_DRIVE_FACTURAS_BASE_PATH        # Default: "Facturas"
GOOGLE_DRIVE_FACTURAS_ROOT_FOLDER_ID   # Optional: root folder in Drive
```

---

## Regional & Language Considerations

### 1. **Language: Spanish**

- UI labels in Spanish (e.g., "Procesador de Comprobantes de Compra")
- Documentation in English (README, API docs)
- No full i18n (translation strings); Spanish is primary target language

### 2. **Regional: Argentina**

- **Document Type**: Purchase receipts / invoices (Comprobantes de Compra)
- **Identifier**: CUIT (Código Único de Identificación Tributaria) for vendors
- **Date Format**: ISO 8601 (flexible parsing → normalize to ISO)
- **Currency**: ARS (Argentine Peso), but system supports any currency code
- **Tax Fields**: `subtotal`, `taxes`, `total` (common invoice structure)

### 3. **Multilingual Vendor Support**

- Extraction works with any language in document (GPT is multilingual)
- Results stored with language-neutral field names
- No language-specific post-processing

---

## Environment Variables

### **Required**

```bash
# OpenAI
OPENAI_API_KEY                         # Your API key

# Firebase
FIREBASE_PROJECT_ID                    # Your Firebase project
FIREBASE_PRIVATE_KEY_ID                # Service account key
FIREBASE_PRIVATE_KEY                   # Service account private key
FIREBASE_CLIENT_EMAIL                  # Service account email
FIREBASE_CLIENT_ID                     # Service account client ID
FIREBASE_AUTH_URI                      # Usually: https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI                     # Usually: https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL   # Usually: https://www.googleapis.com/oauth2/v1/certs

# Google OAuth (tenant token is stored in Firestore)
GOOGLE_CLIENT_ID                       # OAuth client ID
GOOGLE_CLIENT_SECRET                   # OAuth client secret
GOOGLE_REFRESH_TOKEN                   # Default tenant fallback only
GOOGLE_DRIVE_FOLDER_IDS                # Comma-separated Drive folder IDs
```

### **Optional**

```bash
OPENAI_MODEL                           # Default: "gpt-4o"
FIREBASE_TRACK_PROCESSED               # Default: "true"
FIREBASE_TRACKER_COLLECTION            # Default: "processed_files"
FIREBASE_DOCUMENTS_COLLECTION          # Default: "processed_documents"
GOOGLE_DRIVE_FACTURAS_BASE_PATH        # Default: "Facturas"
GOOGLE_DRIVE_FACTURAS_ROOT_FOLDER_ID   # Optional: root folder in Drive
GOOGLE_DRIVE_PROCESSED_FOLDER_NAME     # Optional: folder name for processed files
GOOGLE_DRIVE_PROCESSED_PARENT_FOLDER_ID # Optional: parent folder for processed files
ORCHESTRATOR_API_KEY                   # API key for REST endpoints
```

---

## Testing & Validation

### **Test Structure**
```
test/
  ├─ test_field_validation.py   # Field extraction validation
  ├─ test_invoice.py             # Invoice parsing tests
  ├─ validate_parsing.py          # Multi-file validation script
  └─ documents/
     └─ MOCK_DATA_INFO.json       # Sample test data metadata
     └─ sample_receipt.txt        # Example receipt for testing
```

### **Validation Patterns**

- Field presence checks (null vs. present)
- Date format validation (ISO 8601)
- Numeric type checks (amounts as floats, not strings)
- Document type classification

---

## Deployment

### **Docker**

**Files**:
- `Dockerfile` - FastAPI container image
- `docker-compose.yml` - Compose for local orchestration
- `.dockerignore` - Exclude venv, .git, etc.

**Deployment Guide**: See `DOCKER_DEPLOYMENT.md`

**Port**: FastAPI 8000

---

## Common Tasks & Patterns

### **1. Add a New Rule**

```python
# Script: add_rule_from_default.py
python add_rule_from_default.py <rule_id> "<rule_name>"
```

Or programmatically:
```python
from firebase_tenant_config import FirebaseTenantConfigManager

manager = FirebaseTenantConfigManager(tenant_id)
rule = RuleObject(...)
manager.add_rule(tenant_id, rule)
```

### **2. Process Documents for a Specific Tenant**

```python
from document_orchestrator import orchestrate_single_rule

orchestrate_single_rule(
    tenant_id="my_tenant",
    tenant_config=config,
    rule=rule,
    model="gpt-4o"
)
```

### **3. List Processed Files**

```python
from firebase_processed_files import build_firebase_tracker

tracker = build_firebase_tracker(tenant_id="my_tenant")
processed = tracker.get_all_processed()  # Returns dict of file hashes
```

### **4. Send Results to Google Sheets**

```python
from google_sheets_service import append_row_to_google_sheet

append_row_to_google_sheet(
    sheet_id="SHEET_ID",
    tab_name="Sheet1",
    row_data=[col1, col2, col3, ...]
)
```

---

## Error Handling Best Practices

1. **Validate early**: Check config/credentials on startup
2. **Fail gracefully**: Catch Firebase/Drive API errors, log, continue with next item
3. **Report context**: Include tenant ID, rule ID, file name in error messages
4. **Use custom exceptions**: `FirebaseConfigError`, `GoogleSheetsConfigError`

Example:
```python
try:
    result = extract_receipt_json(client, model, file_path, text)
except Exception as e:
    logger.error(f"Failed to parse {file_path.name} for tenant {tenant_id}: {e}")
    # Continue with next file or return error result
```

---

## Performance Considerations

1. **Batch Processing**: Orchestrator processes multiple files in one run
2. **Caching**: File deduplication via hash (avoids re-parsing)
3. **Lazy Loading**: Credentials loaded per tenant on demand
4. **Async Ready**: FastAPI structure supports async endpoints (currently sync)

---

## References

- **Multi-Tenant Guide**: See `MULTI_TENANT_GUIDE.md`
- **API Docs**: See `ORCHESTRATOR_API.md`
- **Docker Deployment**: See `DOCKER_DEPLOYMENT.md`
- **Original README**: See `README.md`
