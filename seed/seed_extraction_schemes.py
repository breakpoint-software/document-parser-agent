from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DOCUMENT_PARSER_ROOT = REPOSITORY_ROOT / "document-parser"
sys.path.insert(0, str(DOCUMENT_PARSER_ROOT))

from firebase_workspace_config import FirebaseWorkspaceConfigManager


DEFAULT_COLLECTION = "extraction_schemes"
DEFAULT_DOCUMENT_ID = "arg-invoices"
DEFAULT_SCHEMA_FILE = Path(__file__).parent / "extraction_schemes" / "arg-invoices.json"


def load_schema_document(schema_file: Path) -> dict[str, Any]:
    payload = json.loads(schema_file.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("schema"), dict):
        raise ValueError(f"Schema file '{schema_file}' must contain a schema object.")
    if not isinstance(payload.get("parsing_prompt"), str) or not payload["parsing_prompt"].strip():
        raise ValueError(f"Schema file '{schema_file}' must contain a parsing_prompt string.")
    return payload


def seed_default_schema(
    collection_name: str = DEFAULT_COLLECTION,
    document_id: str = DEFAULT_DOCUMENT_ID,
    schema_file: Path = DEFAULT_SCHEMA_FILE,
    overwrite: bool = False,
) -> None:
    manager = FirebaseWorkspaceConfigManager()
    document = manager._get_db().collection(collection_name).document(document_id)
    payload = load_schema_document(schema_file)

    if overwrite:
        document.set(payload)
    else:
        document.create(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed the default extraction schema into a global Firestore collection."
    )
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help="Global Firestore collection name.")
    parser.add_argument("--document-id", default=DEFAULT_DOCUMENT_ID, help="Schema document ID.")
    parser.add_argument("--schema-file", type=Path, default=DEFAULT_SCHEMA_FILE, help="Schema JSON file to upload.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing document. By default, existing schema versions are preserved.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    seed_default_schema(args.collection, args.document_id, args.schema_file, args.overwrite)
    action = "Updated" if args.overwrite else "Created"
    print(f"{action} {args.collection}/{args.document_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())