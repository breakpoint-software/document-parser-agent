#!/usr/bin/env python3
"""
Field validation tests for document parsing.
Tests each extracted field for correctness and completeness.
"""

import os
import sys
from pathlib import Path

# Set UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Add parent directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from openai import OpenAI

from document_processing import extract_text, to_data_uri
from receipt_ai import extract_receipt_json, extract_receipt_json_from_image


def test_field_presence(result: dict) -> tuple[bool, list[str]]:
    """Test that all required fields are present."""
    required_fields = [
        "source_file",
        "document_type",
        "fecha",
        "fecha_vencimiento",
        "cuit_proveedor",
        "description_proveedor",
        "moneda",
        "subtotal",
        "taxes",
        "total",
        "confidence",
    ]
    
    missing = [f for f in required_fields if f not in result]
    
    if missing:
        return False, [f"Missing fields: {', '.join(missing)}"]
    return True, []


def test_field_types(result: dict) -> tuple[bool, list[str]]:
    """Test that fields have correct types."""
    errors = []
    
    # String fields
    string_fields = ["source_file", "document_type", "fecha", "fecha_vencimiento", 
                    "cuit_proveedor", "description_proveedor", "moneda"]
    for field in string_fields:
        value = result.get(field)
        if value is not None and not isinstance(value, str):
            errors.append(f"{field}: expected string, got {type(value).__name__}")
    
    # Numeric fields
    numeric_fields = ["subtotal", "taxes", "total", "confidence"]
    for field in numeric_fields:
        value = result.get(field)
        if value is not None and not isinstance(value, (int, float)):
            errors.append(f"{field}: expected number, got {type(value).__name__}")
    
    return len(errors) == 0, errors


def test_value_validity(result: dict) -> tuple[bool, list[str]]:
    """Test that field values are valid."""
    errors = []
    
    # Check document type
    doc_type = result.get("document_type")
    if doc_type and doc_type not in ["purchase_receipt", "unknown"]:
        errors.append(f"document_type: invalid value '{doc_type}'")
    
    # Check confidence is between 0-1
    confidence = result.get("confidence")
    if confidence is not None and (confidence < 0 or confidence > 1):
        errors.append(f"confidence: must be between 0-1, got {confidence}")
    
    # Check amounts are not negative
    for field in ["subtotal", "taxes", "total"]:
        value = result.get(field)
        if value is not None and value < 0:
            errors.append(f"{field}: negative amount '{value}'")
    
    # Check currency if present
    currency = result.get("moneda")
    if currency and len(currency) > 3:  # Currency codes are usually 3 chars
        errors.append(f"moneda: suspicious currency '{currency}'")
    
    return len(errors) == 0, errors


def test_document(doc_path: Path):
    """Test a single document."""
    if not doc_path.exists():
        print(f"  ✗ File not found: {doc_path.name}")
        return False
    
    try:
        load_dotenv()
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        print(f"\n  Testing: {doc_path.name}")
        
        # Extract
        if doc_path.suffix.lower() in ['.png', '.jpg', '.jpeg']:
            image_data_uri = to_data_uri(doc_path)
            result = extract_receipt_json_from_image(client, model, doc_path, image_data_uri)
        else:
            text = extract_text(doc_path)
            result = extract_receipt_json(client, model, doc_path, text)
        
        # Test field presence
        is_valid, errors = test_field_presence(result)
        if not is_valid:
            for error in errors:
                print(f"    ✗ {error}")
            return False
        print(f"    ✓ All required fields present")
        
        # Test field types
        is_valid, errors = test_field_types(result)
        if not is_valid:
            for error in errors:
                print(f"    ✗ {error}")
            return False
        print(f"    ✓ All field types correct")
        
        # Test value validity
        is_valid, errors = test_value_validity(result)
        if not is_valid:
            for error in errors:
                print(f"    ✗ {error}")
            return False
        print(f"    ✓ All values valid")
        
        # Show extracted data
        print(f"\n    Extracted data:")
        print(f"      Type: {result.get('document_type')}")
        print(f"      Vendor: {result.get('description_proveedor')}")
        print(f"      Total: {result.get('total')} {result.get('moneda')}")
        print(f"      Date: {result.get('fecha')}")
        print(f"      Confidence: {result.get('confidence')}")
        
        return True
        
    except Exception as e:
        print(f"    ✗ Error: {str(e)[:100]}")
        return False


def main():
    """Run field validation tests on all documents."""
    print("\n" + "=" * 60)
    print("Field Validation Tests")
    print("=" * 60)
    
    # Check API key
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        print("\n✗ OPENAI_API_KEY not found")
        return 1
    
    # Test documents
    docs_dir = Path("documents")
    if not docs_dir.exists():
        print(f"\n✗ Documents folder not found: {docs_dir}")
        return 1
    
    test_files = list(docs_dir.glob("*.pdf")) + list(docs_dir.glob("*.jpg")) + \
                 list(docs_dir.glob("*.jpeg")) + list(docs_dir.glob("*.png")) + \
                 list(docs_dir.glob("*.txt"))
    
    if not test_files:
        print(f"\n✗ No test files found in {docs_dir}")
        return 1
    
    print(f"\nFound {len(test_files)} documents")
    
    results = {}
    for doc_path in sorted(test_files):
        results[doc_path.name] = test_document(doc_path)
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    for filename, passed in results.items():
        status = "✓" if passed else "✗"
        print(f"{status} {filename}")
    
    total_passed = sum(1 for p in results.values() if p)
    total = len(results)
    
    print(f"\nTotal: {total_passed}/{total} passed")
    
    return 0 if total_passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
