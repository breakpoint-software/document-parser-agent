from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv


load_dotenv()


class FirebaseConfigError(RuntimeError):
    """Raised when Firebase configuration is missing or invalid."""


@dataclass
class CredentialsObject:
    """OAuth & API Keys for a tenant."""
    openai_api_key: str
    google_refresh_token: str


@dataclass
class RuleObject:
    """Processing rule for a tenant."""
    rule_id: str
    rule_name: str
    source_folder_id: str
    target_folder_id: str
    target_sheet_id: str
    sheet_tab_name: str
    parsing_prompt: str | None = None
    is_enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "rule_name": self.rule_name,
            "source_folder_id": self.source_folder_id,
            "target_folder_id": self.target_folder_id,
            "target_sheet_id": self.target_sheet_id,
            "sheet_tab_name": self.sheet_tab_name,
            "parsing_prompt": self.parsing_prompt,
            "is_enabled": self.is_enabled,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> RuleObject:
        return RuleObject(
            rule_id=data.get("rule_id", ""),
            rule_name=data.get("rule_name", ""),
            source_folder_id=data.get("source_folder_id", ""),
            target_folder_id=data.get("target_folder_id", ""),
            target_sheet_id=data.get("target_sheet_id", ""),
            sheet_tab_name=data.get("sheet_tab_name", ""),
            parsing_prompt=data.get("parsing_prompt"),
            is_enabled=data.get("is_enabled", True),
        )


@dataclass
class TenantConfig:
    """Complete tenant configuration (rules stored inside tenant document)."""
    tenant_id: str
    name: str
    active: bool
    credentials: CredentialsObject
    rules: list[RuleObject] | None = None
    created_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "name": self.name,
            "active": self.active,
            "credentials": {
                "openai_api_key": self.credentials.openai_api_key,
            },
            "refresh_token": self.credentials.google_refresh_token,
            "created_at": self.created_at,
        }

    @staticmethod
    def from_dict(data: dict[str, Any], tenant_id: str) -> TenantConfig:
        creds_data = data.get("credentials", {})
        credentials = CredentialsObject(
            openai_api_key=creds_data.get("openai_api_key", ""),
            google_refresh_token=data.get("refresh_token", creds_data.get("google_refresh_token", "")),
        )
        return TenantConfig(
            tenant_id=tenant_id,
            name=data.get("name", ""),
            active=data.get("active", True),
            credentials=credentials,
            rules=None,
            created_at=data.get("created_at"),
        )


class FirebaseTenantConfigManager:
    """Manages tenant configurations in Firebase Firestore.
    
    This is the TENANT CONFIG DB - separate from document processing.
    Other environments import this and use get_tenant() to fetch configs.
    """

    def __init__(self, collection_name: str | None = None):
        self.collection_name = (collection_name or os.getenv("FIREBASE_TENANTS_COLLECTION") or "tenants").strip()
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

    def get_tenant(self, tenant_id: str) -> TenantConfig | None:
        """Retrieve a tenant configuration by ID."""
        doc = self._get_db().collection(self.collection_name).document(tenant_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        return TenantConfig.from_dict(data, tenant_id)

    def save_tenant(self, tenant: TenantConfig) -> None:
        """Save a tenant configuration."""
        payload = tenant.to_dict()
        if not payload.get("created_at"):
            payload["created_at"] = datetime.now(timezone.utc).isoformat()
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._get_db().collection(self.collection_name).document(tenant.tenant_id).set(payload)

    def list_active_tenants(self) -> list[TenantConfig]:
        """Retrieve all active tenants."""
        docs = (
            self._get_db()
            .collection(self.collection_name)
            .where("active", "==", True)
            .stream()
        )
        tenants = []
        for doc in docs:
            try:
                tenant = TenantConfig.from_dict(doc.to_dict() or {}, doc.id)
                tenants.append(tenant)
            except Exception:
                continue
        return tenants

    def get_all_rules(self, tenant_id: str) -> list[RuleObject]:
        """Get all processing rules for a tenant from the rules subcollection."""
        tenant_doc = self._get_db().collection(self.collection_name).document(tenant_id)
        rules_subcoll = tenant_doc.collection("rules")
        rules = []
        for doc in rules_subcoll.stream():
            rule_data = doc.to_dict() or {}
            rules.append(RuleObject.from_dict(rule_data))
        return rules

    def get_enabled_rules(self, tenant_id: str) -> list[RuleObject]:
        """Get all enabled processing rules for a tenant."""
        all_rules = self.get_all_rules(tenant_id)
        return [rule for rule in all_rules if rule.is_enabled]

    def add_rule(self, tenant_id: str, rule: RuleObject) -> None:
        """Add a rule to a tenant's rules subcollection."""
        tenant_doc = self._get_db().collection(self.collection_name).document(tenant_id)
        rules_subcoll = tenant_doc.collection("rules")
        rules_subcoll.document(rule.rule_id).set(rule.to_dict())

    def remove_rule(self, tenant_id: str, rule_id: str) -> None:
        """Remove a rule from a tenant's rules subcollection."""
        tenant_doc = self._get_db().collection(self.collection_name).document(tenant_id)
        rules_subcoll = tenant_doc.collection("rules")
        rules_subcoll.document(rule_id).delete()


# Module-level convenience functions for backward compatibility
_manager = FirebaseTenantConfigManager()


def load_all_tenants() -> list[TenantConfig]:
    """Load all active tenants from Firebase."""
    return _manager.list_active_tenants()


def load_tenant_rules(tenant_id: str) -> list[RuleObject]:
    """Load all rules for a specific tenant."""
    return _manager.get_all_rules(tenant_id)
