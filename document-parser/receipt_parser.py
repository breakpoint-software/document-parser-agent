from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from document_processing import extract_text, is_image_document, load_documents, to_data_uri
from receipt_ai import extract_receipt_json, extract_receipt_json_from_image
from receipt_results import build_empty_result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract purchase receipt data from documents using GPT.")
    parser.add_argument("--input", default="documents", help="Folder containing documents to process.")
    parser.add_argument("--output", help="Optional output JSON file. Prints to stdout when omitted.")
    parser.add_argument("--model", default=os.getenv("OPENAI_MODEL", "gpt-4o"), help="OpenAI model name.")
    return parser.parse_args()


def main() -> int:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv()
    args = parse_args()
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    input_folder = Path(args.input)
    files = load_documents(input_folder)
    results: list[dict[str, Any]] = []

    for file_path in files:
        relative_name = file_path.relative_to(input_folder).as_posix()

        if is_image_document(file_path):
            image_data_uri = to_data_uri(file_path)
            result = extract_receipt_json_from_image(client, args.model, file_path, image_data_uri)
        else:
            text = extract_text(file_path)
            if not text.strip():
                results.append(build_empty_result(relative_name))
                continue

            result = extract_receipt_json(client, args.model, file_path, text)

        result["source_file"] = relative_name
        results.append(result)

    payload: dict[str, Any] = {"input_folder": str(input_folder), "results": results}

    rendered = json.dumps(payload, indent=2, ensure_ascii=False)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    else:
        print(rendered)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())