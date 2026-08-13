from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

from google.api_core.exceptions import AlreadyExists

sys.path.insert(0, str(Path(__file__).parent.parent))

from document_identity import DocumentIdentityError, build_document_identity, validate_identity_config
from firebase_processed_files import FirebaseProcessedFilesTracker


IDENTITY_CONFIG = {
    "version": 1,
    "separator": "|",
    "strategies": [
        {
            "name": "arca_invoice",
            "strength": "strong",
            "required": ["country", "supplier_tax_id", "document_code", "point_of_sale", "invoice_number"],
            "components": [
                {"field": "country", "normalizer": "uppercase"},
                {"field": "supplier_tax_id", "normalizer": "digits"},
                {"field": "document_code", "normalizer": "digits", "width": 3},
                {"field": "point_of_sale", "normalizer": "digits", "width": 5},
                {"field": "invoice_number", "normalizer": "digits", "width": 8},
            ],
        },
        {
            "name": "fiscal_ticket",
            "strength": "strong",
            "required": ["country", "supplier_tax_id", "point_of_sale", "invoice_number"],
            "components": [
                {"field": "country", "normalizer": "uppercase"},
                {"field": "supplier_tax_id", "normalizer": "digits"},
                {"field": "point_of_sale", "normalizer": "digits", "width": 4},
                {"field": "invoice_number", "normalizer": "digits", "width": 8},
            ],
        },
        {
            "name": "tax_id_date_total",
            "strength": "weak",
            "required": ["country", "supplier_tax_id", "invoice_date", "total", "currency"],
            "components": [
                {"field": "country", "normalizer": "uppercase"},
                {"field": "supplier_tax_id", "normalizer": "digits"},
                {"field": "invoice_date", "normalizer": "date"},
                {"field": "total", "normalizer": "decimal", "scale": 2},
                {"field": "currency", "normalizer": "uppercase"},
            ],
        },
    ],
}

IDENTITY_SCHEMA = {
    "properties": {
        field: {}
        for field in {
            component["field"]
            for strategy in IDENTITY_CONFIG["strategies"]
            for component in strategy["components"]
        }
    }
}


class FakeSnapshot:
    def __init__(self, payload: dict[str, Any] | None):
        self._payload = payload
        self.exists = payload is not None

    def to_dict(self) -> dict[str, Any] | None:
        return self._payload


class FakeDocument:
    def __init__(self, records: dict[str, dict[str, Any]], document_id: str):
        self.records = records
        self.document_id = document_id

    def create(self, payload: dict[str, Any]) -> None:
        if self.document_id in self.records:
            raise AlreadyExists("already exists")
        self.records[self.document_id] = payload

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self.records.get(self.document_id))

    def set(self, payload: dict[str, Any], merge: bool = False) -> None:
        if merge:
            self.records[self.document_id] = {**self.records.get(self.document_id, {}), **payload}
        else:
            self.records[self.document_id] = payload

    def delete(self) -> None:
        self.records.pop(self.document_id, None)


class FakeQuery:
    def __init__(self, records: dict[str, dict[str, Any]], field: str, value: Any):
        self.records = records
        self.field = field
        self.value = value

    def limit(self, count: int) -> FakeQuery:
        return self

    def stream(self):
        for payload in self.records.values():
            if payload.get(self.field) == self.value:
                yield FakeSnapshot(payload)


class FakeCollection:
    def __init__(self, records: dict[str, dict[str, Any]]):
        self.records = records

    def document(self, document_id: str) -> FakeDocument:
        return FakeDocument(self.records, document_id)

    def where(self, field: str, operator: str, value: Any) -> FakeQuery:
        return FakeQuery(self.records, field, value)

    def stream(self):
        for payload in self.records.values():
            yield FakeSnapshot(payload)


class FakeDb:
    def __init__(self):
        self.collections: dict[str, dict[str, dict[str, Any]]] = {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self.collections.setdefault(name, {}))


class DocumentIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        validate_identity_config(IDENTITY_CONFIG, IDENTITY_SCHEMA)

    def test_arca_invoice_uses_highest_priority_strategy(self) -> None:
        identity = build_document_identity(
            {
                "country": "ar",
                "supplier_tax_id": "20-22007446-4",
                "document_code": "15",
                "point_of_sale": "2",
                "invoice_number": "390",
                "invoice_date": "2026-08-06",
                "total": 100,
                "currency": "ARS",
            },
            IDENTITY_CONFIG,
        )

        self.assertIsNotNone(identity)
        self.assertEqual(identity["identity_key"], "AR|20220074464|015|00002|00000390")
        self.assertEqual(identity["identity_strategy"], "arca_invoice")

    def test_fiscal_ticket_is_used_without_document_code(self) -> None:
        identity = build_document_identity(
            {
                "country": "AR",
                "supplier_tax_id": "30-71234567-8",
                "point_of_sale": "834",
                "invoice_number": "124567",
            },
            IDENTITY_CONFIG,
        )

        self.assertIsNotNone(identity)
        self.assertEqual(identity["identity_key"], "AR|30712345678|0834|00124567")
        self.assertEqual(identity["identity_strategy"], "fiscal_ticket")

    def test_weak_fallback_normalizes_date_amount_and_currency(self) -> None:
        identity = build_document_identity(
            {
                "country": "ar",
                "supplier_tax_id": "30-71234567-8",
                "invoice_date": "06/08/2026",
                "total": "1234.5",
                "currency": "ars",
            },
            IDENTITY_CONFIG,
        )

        self.assertIsNotNone(identity)
        self.assertEqual(identity["identity_key"], "AR|30712345678|2026-08-06|1234.50|ARS")
        self.assertEqual(identity["identity_strength"], "weak")

    def test_missing_identity_fields_returns_none(self) -> None:
        self.assertIsNone(build_document_identity({"country": "AR", "total": 100}, IDENTITY_CONFIG))

    def test_unknown_normalizer_is_rejected(self) -> None:
        invalid_identity = {
            "strategies": [{
                "name": "invalid",
                "required": ["country"],
                "components": [{"field": "country", "normalizer": "arbitrary_code"}],
            }]
        }
        with self.assertRaises(DocumentIdentityError):
            validate_identity_config(invalid_identity, IDENTITY_SCHEMA)

    def test_missing_identity_metadata_is_rejected(self) -> None:
        invalid_identity = {"strategies": IDENTITY_CONFIG["strategies"]}
        with self.assertRaisesRegex(DocumentIdentityError, "version and separator"):
            validate_identity_config(invalid_identity, IDENTITY_SCHEMA)

    def test_second_source_cannot_claim_existing_identity(self) -> None:
        tracker = FirebaseProcessedFilesTracker("workspace", "rule")
        tracker._db = FakeDb()
        self.assertEqual(tracker.collection_name, "workspace_executions/workspace/processed_files")
        self.assertEqual(tracker.legacy_collection_name, "workspace/rule/processed_files")
        identity = {
            "identity_key": "AR|20220074464|015|00002|00000390",
            "identity_strategy": "arca_invoice",
            "identity_strength": "strong",
            "identity_version": 1,
            "identity_components": {},
        }

        tracking = {"schema_id": "arg-invoices", "schema_version": 4, "execution_mode": "source_by_rule"}
        self.assertEqual(tracker.claim_document_identity(identity, "drive-1", "first.pdf", **tracking), "created")
        self.assertEqual(tracker.claim_document_identity(identity, "drive-1", "first.pdf", **tracking), "existing_source")
        self.assertIsNone(tracker.claim_document_identity(identity, "drive-2", "duplicate.pdf", **tracking))

    def test_source_and_parsed_data_share_processed_files_collection(self) -> None:
        tracker = FirebaseProcessedFilesTracker("workspace", "rule")
        tracker._db = FakeDb()
        identity_key = "AR|20220074464|015|00002|00000390"
        identity = {
            "identity_key": identity_key,
            "identity_strategy": "arca_invoice",
            "identity_strength": "strong",
            "identity_version": 1,
            "identity_components": {},
        }

        tracking = {"schema_id": "arg-invoices", "schema_version": 4, "execution_mode": "source_by_rule"}
        tracker.save_source_record("drive-1", "first.pdf", "2026-08-07", "Error", **tracking)
        self.assertEqual(tracker.get_source_record("drive-1")["status"], "Error")
        self.assertEqual(tracker.claim_document_identity(identity, "drive-1", "first.pdf", **tracking), "created")
        tracker.save_document_record(
            identity_key,
            "drive-1",
            "first.pdf",
            source_modified_at="2026-08-07",
            status="Parsed",
            parsed_data={"total": 123.45},
            **tracking,
        )
        tracker.save_source_record(
            "drive-1",
            "first.pdf",
            "2026-08-07",
            "Parsed",
            identity_key=identity_key,
            **tracking,
        )

        records = tracker._db.collections[tracker.collection_name]
        self.assertEqual(list(records), [identity_key])
        self.assertEqual(records[identity_key]["parsed_data"], {"total": 123.45})
        self.assertEqual(tracker.get_source_record("drive-1")["identity_key"], identity_key)


if __name__ == "__main__":
    unittest.main()
