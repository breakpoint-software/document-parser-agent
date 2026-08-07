from __future__ import annotations

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import Any


sys.path.insert(0, str(Path(__file__).parent.parent))

from document_orchestrator import _parse_document
TEST_RESPONSE_FORMAT = {
    "name": "test_extraction",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"test_field": {"type": ["string", "null"]}},
        "required": ["test_field"],
    },
    "strict": True,
}

TEST_SCHEME = {
    **TEST_RESPONSE_FORMAT,
    "version": 1,
    "parsing_prompt": "Scheme parsing prompt",
    "identity": {},
}


class FakeResponses:
    def __init__(self) -> None:
        self.request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.request = kwargs
        return SimpleNamespace(output_text=json.dumps({}), output=[])


class FakeClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


def test_parse_document_uses_scheme_prompt(monkeypatch: Any) -> None:
    client = FakeClient()
    monkeypatch.setattr("receipt_ai.load_extraction_scheme", lambda schema_id: TEST_SCHEME)

    with TemporaryDirectory() as temp_dir:
        document = Path(temp_dir) / "receipt.txt"
        document.write_text("sample receipt", encoding="utf-8")
        _parse_document(client, "test-model", str(document), document.name)

    assert client.responses.request is not None
    assert client.responses.request["instructions"] == "Scheme parsing prompt"


def test_parse_document_uses_rule_schema_reference(monkeypatch: Any) -> None:
    client = FakeClient()
    selected_schema_ids: list[str] = []

    def load_schema(schema_id: str) -> dict[str, Any]:
        selected_schema_ids.append(schema_id)
        return TEST_SCHEME

    monkeypatch.setattr("receipt_ai.load_extraction_scheme", load_schema)

    with TemporaryDirectory() as temp_dir:
        document = Path(temp_dir) / "receipt.txt"
        document.write_text("sample receipt", encoding="utf-8")
        _parse_document(client, "test-model", str(document), document.name, schema_id="custom-invoice-v2")

    assert selected_schema_ids == ["custom-invoice-v2"]
    assert client.responses.request is not None
    assert client.responses.request["text"]["format"] == {"type": "json_schema", **TEST_RESPONSE_FORMAT}
    assert "Extract only: test_field." in client.responses.request["input"]