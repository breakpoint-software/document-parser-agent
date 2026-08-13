from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from dotenv import load_dotenv


load_dotenv()


class FirebaseConfigError(RuntimeError):
    """Raised when Firebase configuration is missing or invalid."""


@dataclass
class CredentialsObject:
    """OAuth and API keys for a workspace."""
    openai_api_key: str
    google_refresh_token: str


ExecutionMode = Literal["single_source", "source_by_rule"]


def normalize_execution_mode(data: dict[str, Any], workspace_id: str) -> ExecutionMode:
    execution_mode = str(data.get("execution_mode") or "").strip()
    if execution_mode in {"single_source", "source_by_rule"}:
        return execution_mode  # type: ignore[return-value]
    raise FirebaseConfigError(
        f"Workspace '{workspace_id}' must define execution_mode as 'single_source' or 'source_by_rule'."
    )


@dataclass
class WorkspaceRouting:
    inbox_folder_id: str
    inbox_folder_name: str
    schema_id: str
    include_subfolders: bool
    selection_strategy: str
    multiple_match_policy: str

    @staticmethod
    def from_dict(data: Any, workspace_id: str) -> WorkspaceRouting:
        if not isinstance(data, dict):
            raise FirebaseConfigError(f"Workspace '{workspace_id}' must define routing.")
        required_fields = (
            "inbox_folder_id",
            "inbox_folder_name",
            "schema_id",
            "include_subfolders",
            "selection_strategy",
            "multiple_match_policy",
        )
        missing = [field for field in required_fields if field not in data]
        if missing:
            raise FirebaseConfigError(
                f"Workspace '{workspace_id}' routing is missing required fields: {', '.join(missing)}."
            )
        inbox_folder_id = str(data["inbox_folder_id"] or "").strip()
        schema_id = str(data["schema_id"] or "").strip()
        if not inbox_folder_id or not schema_id:
            raise FirebaseConfigError(
                f"Workspace '{workspace_id}' routing requires non-empty inbox_folder_id and schema_id."
            )
        return WorkspaceRouting(
            inbox_folder_id=inbox_folder_id,
            inbox_folder_name=str(data["inbox_folder_name"] or "").strip(),
            schema_id=schema_id,
            include_subfolders=bool(data["include_subfolders"]),
            selection_strategy=str(data["selection_strategy"] or "").strip(),
            multiple_match_policy=str(data["multiple_match_policy"] or "").strip(),
        )


@dataclass
class RuleObject:
    """Processing rule for a workspace."""
    rule_id: str
    rule_name: str
    source_folder_id: str
    target_folder_id: str
    target_sheet_id: str
    sheet_tab_name: str
    schema_id: str
    is_enabled: bool
    priority: int
    condition_mode: str
    conditions: list[dict[str, Any]]
    actions: dict[str, bool]

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "rule_name": self.rule_name,
            "source_folder_id": self.source_folder_id,
            "target_folder_id": self.target_folder_id,
            "target_sheet_id": self.target_sheet_id,
            "sheet_tab_name": self.sheet_tab_name,
            "schema_id": self.schema_id,
            "is_enabled": self.is_enabled,
            "priority": self.priority,
            "condition_mode": self.condition_mode,
            "conditions": self.conditions,
            "actions": self.actions,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> RuleObject:
        rule_id = str(data.get("rule_id") or "").strip()
        required_fields = (
            "rule_name",
            "source_folder_id",
            "target_folder_id",
            "target_sheet_id",
            "sheet_tab_name",
            "schema_id",
            "is_enabled",
            "priority",
            "condition_mode",
            "conditions",
            "actions",
        )
        missing = [field for field in required_fields if field not in data]
        if not rule_id or missing:
            details = "rule_id" if not rule_id else ""
            details = ", ".join(filter(None, [details, *missing]))
            raise FirebaseConfigError(f"Rule '{rule_id or '<unknown>'}' is missing required fields: {details}.")
        if not isinstance(data["conditions"], list) or not isinstance(data["actions"], dict):
            raise FirebaseConfigError(f"Rule '{rule_id}' must define conditions as a list and actions as a map.")
        schema_id = str(data["schema_id"] or "").strip()
        if not schema_id:
            raise FirebaseConfigError(f"Rule '{rule_id}' must define a non-empty schema_id.")
        return RuleObject(
            rule_id=rule_id,
            rule_name=str(data["rule_name"] or "").strip(),
            source_folder_id=str(data["source_folder_id"] or "").strip(),
            target_folder_id=str(data["target_folder_id"] or "").strip(),
            target_sheet_id=str(data["target_sheet_id"] or "").strip(),
            sheet_tab_name=str(data["sheet_tab_name"] or "").strip(),
            schema_id=schema_id,
            is_enabled=bool(data["is_enabled"]),
            priority=int(data["priority"]),
            condition_mode=str(data["condition_mode"] or "").strip(),
            conditions=data["conditions"],
            actions=data["actions"],
        )


@dataclass
class WorkspaceConfig:
    """Complete workspace configuration."""
    workspace_id: str
    name: str
    active: bool
    credentials: CredentialsObject
    execution_mode: ExecutionMode
    rules: list[RuleObject] | None = None
    created_at: str | None = None
    routing: WorkspaceRouting | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "name": self.name,
            "active": self.active,
            "credentials": {
                "openai_api_key": self.credentials.openai_api_key,
            },
            "refresh_token": self.credentials.google_refresh_token,
            "created_at": self.created_at,
            "execution_mode": self.execution_mode,
            "routing": {
                "inbox_folder_id": self.routing.inbox_folder_id,
                "inbox_folder_name": self.routing.inbox_folder_name,
                "schema_id": self.routing.schema_id,
                "include_subfolders": self.routing.include_subfolders,
                "selection_strategy": self.routing.selection_strategy,
                "multiple_match_policy": self.routing.multiple_match_policy,
            } if self.routing else None,
        }

    @staticmethod
    def from_dict(data: dict[str, Any], workspace_id: str) -> WorkspaceConfig:
        if "active" not in data:
            raise FirebaseConfigError(f"Workspace '{workspace_id}' must define active.")
        execution_mode = normalize_execution_mode(data, workspace_id)
        creds_data = data.get("credentials")
        if not isinstance(creds_data, dict):
            raise FirebaseConfigError(f"Workspace '{workspace_id}' must define credentials.")
        credentials = CredentialsObject(
            openai_api_key=str(creds_data.get("openai_api_key") or "").strip(),
            google_refresh_token=str(data.get("refresh_token") or creds_data.get("google_refresh_token") or "").strip(),
        )
        return WorkspaceConfig(
            workspace_id=workspace_id,
            name=str(data.get("name") or "").strip(),
            active=bool(data["active"]),
            credentials=credentials,
            rules=None,
            created_at=data.get("created_at"),
            execution_mode=execution_mode,
            routing=WorkspaceRouting.from_dict(data.get("routing"), workspace_id) if execution_mode == "single_source" else None,
        )


class FirebaseWorkspaceConfigManager:
    """Manage workspace configurations in Firebase Firestore."""

    def __init__(self, collection_name: str | None = None):
        self.collection_name = (collection_name or os.getenv("FIREBASE_WORKSPACES_COLLECTION") or "workspaces").strip()
        self._db = None

    def _build_credentials(self):
        from firebase_admin import credentials

        service_account_json = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
        service_account_file = (os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE") or "").strip()

        if service_account_json:
            try:
                info = json.loads(service_account_json)
            except json.JSONDecodeError as exc:
                raise FirebaseConfigError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.") from exc
            return credentials.Certificate(info)

        if service_account_file:
            return credentials.Certificate(service_account_file)

        raise FirebaseConfigError(
            "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_FILE."
        )

    def _get_db(self):
        if self._db is not None:
            return self._db

        import firebase_admin
        from firebase_admin import firestore

        if not firebase_admin._apps:
            cred = self._build_credentials()
            firebase_admin.initialize_app(cred)

        self._db = firestore.client()
        return self._db

    def get_workspace(self, workspace_id: str) -> WorkspaceConfig | None:
        """Retrieve a workspace configuration by ID."""
        doc = self._get_db().collection(self.collection_name).document(workspace_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        return WorkspaceConfig.from_dict(data, workspace_id)

    def get_extraction_scheme(
        self,
        schema_id: str,
        collection_name: str = "extraction_schemes",
    ) -> dict[str, Any]:
        """Retrieve and validate a global extraction scheme."""
        doc = self._get_db().collection(collection_name).document(schema_id).get()
        if not doc.exists:
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' was not found.")

        data = doc.to_dict() or {}
        if data.get("is_enabled") is not True:
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' is disabled.")

        schema = data.get("schema")
        if not isinstance(schema, dict):
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' has no valid schema map.")
        if schema.get("type") != "object" or not isinstance(schema.get("properties"), dict):
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' must define an object schema.")

        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' has no valid name.")

        parsing_prompt = data.get("parsing_prompt")
        if not isinstance(parsing_prompt, str) or not parsing_prompt.strip():
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' has no parsing prompt.")

        identity = data.get("identity")
        if not isinstance(identity, dict):
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' has no identity configuration.")
        try:
            from document_identity import validate_identity_config

            validate_identity_config(identity, schema)
        except ValueError as exc:
            raise FirebaseConfigError(f"Extraction schema '{collection_name}/{schema_id}' has invalid identity configuration: {exc}") from exc

        if "version" not in data or "strict" not in data:
            raise FirebaseConfigError(
                f"Extraction schema '{collection_name}/{schema_id}' must define version and strict."
            )

        return {
            "name": name.strip(),
            "version": int(data["version"]),
            "parsing_prompt": parsing_prompt.strip(),
            "schema": schema,
            "strict": bool(data["strict"]),
            "identity": identity,
        }

    def get_extraction_schema(
        self,
        schema_id: str,
        collection_name: str = "extraction_schemes",
    ) -> dict[str, Any]:
        """Retrieve the OpenAI response format from a global extraction scheme."""
        scheme = self.get_extraction_scheme(schema_id, collection_name)
        return {key: scheme[key] for key in ("name", "schema", "strict")}

    def save_workspace(self, workspace: WorkspaceConfig) -> None:
        """Save a workspace configuration."""
        payload = workspace.to_dict()
        if not payload.get("created_at"):
            payload["created_at"] = datetime.now(timezone.utc).isoformat()
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._get_db().collection(self.collection_name).document(workspace.workspace_id).set(payload)

    def list_active_workspaces(self) -> list[WorkspaceConfig]:
        """Retrieve all active workspaces."""
        docs = (
            self._get_db()
            .collection(self.collection_name)
            .where("active", "==", True)
            .stream()
        )
        workspaces = []
        for doc in docs:
            try:
                workspace = WorkspaceConfig.from_dict(doc.to_dict() or {}, doc.id)
                workspaces.append(workspace)
            except Exception as exc:
                raise FirebaseConfigError(f"Invalid workspace configuration '{doc.id}': {exc}") from exc
        return workspaces

    def get_all_rules(self, workspace_id: str) -> list[RuleObject]:
        """Get all processing rules for a workspace."""
        workspace_doc = self._get_db().collection(self.collection_name).document(workspace_id)
        rules_subcoll = workspace_doc.collection("rules")
        rules = []
        for doc in rules_subcoll.stream():
            rule_data = doc.to_dict() or {}
            rule_data["rule_id"] = doc.id
            rules.append(RuleObject.from_dict(rule_data))
        return rules

    def get_enabled_rules(self, workspace_id: str) -> list[RuleObject]:
        """Get all enabled processing rules for a workspace."""
        all_rules = self.get_all_rules(workspace_id)
        return [rule for rule in all_rules if rule.is_enabled]

    def add_rule(self, workspace_id: str, rule: RuleObject) -> None:
        """Add a rule to a workspace's rules subcollection."""
        workspace_doc = self._get_db().collection(self.collection_name).document(workspace_id)
        rules_subcoll = workspace_doc.collection("rules")
        rules_subcoll.document(rule.rule_id).set(rule.to_dict())

    def remove_rule(self, workspace_id: str, rule_id: str) -> None:
        """Remove a rule from a workspace's rules subcollection."""
        workspace_doc = self._get_db().collection(self.collection_name).document(workspace_id)
        rules_subcoll = workspace_doc.collection("rules")
        rules_subcoll.document(rule_id).delete()


# Module-level convenience functions
_manager = FirebaseWorkspaceConfigManager()


def load_all_workspaces() -> list[WorkspaceConfig]:
    """Load all active workspaces from Firebase."""
    return _manager.list_active_workspaces()


def load_workspace_rules(workspace_id: str) -> list[RuleObject]:
    """Load all rules for a specific workspace."""
    return _manager.get_all_rules(workspace_id)
