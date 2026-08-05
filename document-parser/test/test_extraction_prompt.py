from __future__ import annotations

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import Any


sys.path.insert(0, str(Path(__file__).parent.parent))

from document_orchestrator import _parse_document
from receipt_ai import EXTRACTION_INSTRUCTIONS


class FakeResponses:
    def __init__(self) -> None:
        self.request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.request = kwargs
        return SimpleNamespace(output_text=json.dumps({}), output=[])


class FakeClient:
    def __init__(self) -> None:
        self.responses = FakeResponses()


def test_parse_document_uses_rule_prompt() -> None:
    client = FakeClient()

    with TemporaryDirectory() as temp_dir:
        document = Path(temp_dir) / "receipt.txt"
        document.write_text("sample receipt", encoding="utf-8")
        _parse_document(client, "test-model", str(document), document.name, "  Custom rule prompt  ")

    assert client.responses.request is not None
    assert client.responses.request["instructions"] == "Custom rule prompt"


def test_parse_document_uses_default_for_blank_rule_prompt() -> None:
    client = FakeClient()

    with TemporaryDirectory() as temp_dir:
        document = Path(temp_dir) / "receipt.txt"
        document.write_text("sample receipt", encoding="utf-8")
        _parse_document(client, "test-model", str(document), document.name, "   ")

    assert client.responses.request is not None
    assert client.responses.request["instructions"] == EXTRACTION_INSTRUCTIONS