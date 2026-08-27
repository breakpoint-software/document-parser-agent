#!/usr/bin/env python3
"""Evaluate receipt_ai against the Argentine invoice image and PDF dataset."""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from document_processing import to_data_uri  # noqa: E402
from receipt_ai import (  # noqa: E402
    extract_receipt_json_from_image,
    extract_receipt_json_from_pdf,
    load_extraction_scheme,
)


DATASET_DIR = Path(__file__).resolve().parent / "arg-invoices"
DEFAULT_GROUND_TRUTH = DATASET_DIR / "ground_truth.jsonl"
DEFAULT_SOURCES = DATASET_DIR / "sources"
SCHEMA_ID = "arg-invoices"

@dataclass(frozen=True)
class FieldResult:
    expected_field: str
    actual_field: str
    expected: Any
    actual: Any
    passed: bool


def load_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                case = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on {path}:{line_number}: {exc}") from exc
            if not all(key in case for key in ("id", "file_name", "ground_truth")):
                raise ValueError(f"Missing id, file_name, or ground_truth on {path}:{line_number}")
            cases.append(case)
    if not cases:
        raise ValueError(f"No cases found in {path}")
    return cases


def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split()).casefold()
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(character)
    )


def values_match(expected: Any, actual: Any, normalization: dict[str, Any]) -> bool:
    normalizer = normalization.get("normalizer")
    if normalizer == "decimal":
        try:
            scale = int(normalization.get("scale", 2))
            return round(float(expected), scale) == round(float(actual), scale)
        except (TypeError, ValueError):
            return False
    if normalizer == "digits":
        digits = lambda value: "".join(character for character in str(value) if character.isdigit())
        return expected is not None and actual is not None and digits(expected) == digits(actual)
    if normalizer == "uppercase":
        return str(expected).upper() == str(actual).upper()
    return normalize_text(expected) == normalize_text(actual)


def result_field_for(expected_field: str, scheme: dict[str, Any]) -> str | None:
    if expected_field in scheme["schema"]["properties"]:
        return expected_field
    return scheme.get("mapping", {}).get("canonical_fields", {}).get(expected_field)


def compare_result(
    ground_truth: dict[str, Any], actual: dict[str, Any], scheme: dict[str, Any]
) -> list[FieldResult]:
    normalization = scheme.get("normalization", {})
    return [
        FieldResult(
            expected_field=expected_field,
            actual_field=actual_field,
            expected=expected,
            actual=actual.get(actual_field),
            passed=values_match(expected, actual.get(actual_field), normalization.get(actual_field, {})),
        )
        for expected_field, expected in ground_truth.items()
        if (actual_field := result_field_for(expected_field, scheme)) is not None
    ]


def unsupported_ground_truth_fields(
    cases: Iterable[dict[str, Any]], scheme: dict[str, Any]
) -> list[str]:
    present_fields = {
        field for case in cases for field in case["ground_truth"]
    }
    return sorted(
        field
        for field in present_fields
        if result_field_for(field, scheme) is None
    )


def extract_case_document(
    client: Any,
    model: str,
    source_path: Path,
    schema_id: str,
) -> dict[str, Any]:
    """Extract one validation source using its supported document format."""
    suffix = source_path.suffix.lower()
    if suffix == ".pdf":
        return extract_receipt_json_from_pdf(client, model, source_path, schema_id)
    if suffix in {".jpg", ".jpeg", ".png"}:
        return extract_receipt_json_from_image(
            client,
            model,
            source_path,
            to_data_uri(source_path),
            schema_id=schema_id,
        )
    raise ValueError(f"Unsupported validation source type: {source_path.suffix}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ground-truth", type=Path, default=DEFAULT_GROUND_TRUTH)
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--schema-id", default=SCHEMA_ID)
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-5-mini"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is required.", file=sys.stderr)
        return 2

    try:
        cases = load_cases(args.ground_truth)
        scheme = load_extraction_scheme(args.schema_id)
    except Exception as exc:
        print(f"Dataset/configuration error: {exc}", file=sys.stderr)
        return 2

    client = OpenAI()
    passed_fields = 0
    total_fields = 0
    failed_cases = 0

    unsupported = unsupported_ground_truth_fields(cases, scheme)
    if unsupported:
        print("Not evaluated (absent from the Firebase response schema): " + ", ".join(unsupported))

    for case in cases:
        source_path = args.sources / case["file_name"]
        if not source_path.is_file():
            print(f"FAIL {case['id']}: source not found: {source_path}")
            failed_cases += 1
            continue
        try:
            actual = extract_case_document(client, args.model, source_path, args.schema_id)
        except Exception as exc:
            print(f"FAIL {case['id']}: extraction error: {exc}")
            failed_cases += 1
            continue

        results = compare_result(case["ground_truth"], actual, scheme)
        failures = [result for result in results if not result.passed]
        total_fields += len(results)
        passed_fields += len(results) - len(failures)
        if failures:
            failed_cases += 1
            print(f"FAIL {case['id']} ({len(results) - len(failures)}/{len(results)} fields)")
            for failure in failures:
                print(
                    f"  {failure.actual_field}: expected {failure.expected!r}, "
                    f"got {failure.actual!r}"
                )
        else:
            print(f"PASS {case['id']} ({len(results)}/{len(results)} fields)")

    accuracy = passed_fields / total_fields if total_fields else 0.0
    print(
        f"Summary: {len(cases) - failed_cases}/{len(cases)} documents passed; "
        f"field accuracy {passed_fields}/{total_fields} ({accuracy:.1%})"
    )
    return 1 if failed_cases else 0


if __name__ == "__main__":
    raise SystemExit(main())
