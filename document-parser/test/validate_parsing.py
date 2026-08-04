#!/usr/bin/env python3
"""
Direct validation tests for document parsing with OpenAI.
Simple, focused tests to verify extraction accuracy.
"""

import json
import os
import sys
from pathlib import Path

# Set UTF-8 encoding for console output
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from openai import OpenAI

from document_processing import extract_text, is_image_document, to_data_uri
from receipt_ai import extract_receipt_json, extract_receipt_json_from_image


# Expected values for validation
EXPECTED_VALUES = {
    "sample_invoice.pdf": {
        "document_type": "purchase_receipt",
        "description_proveedor": "Acme Corp",
        "cuit_proveedor": "20-12345678-9",
        "total": 1210.0,
        "moneda": "ARS",
        "fecha": "2024-01-15",
    },
    "sample_invoice_scan.jpg": {
        "document_type": "purchase_receipt",
        "description_proveedor": "Local Store",
        "cuit_proveedor": "20-11111111-1",
        "total": 303.1,
        "moneda": "ARS",
        "fecha": "2024-01-25",
    },
    "sample_receipt.png": {
        "document_type": "purchase_receipt",
        "description_proveedor": "Tech Solutions Ltd",
        "cuit_proveedor": "20-87654321-0",
        "total": 550.0,
        "moneda": "USD",
        "fecha": "2024-01-20",
    },
    "sample_receipt.txt": {
        "document_type": "purchase_receipt",
        "description_proveedor": "Online Retailer",
        "cuit_proveedor": "20-99999999-9",
        "total": 260.76,
        "moneda": "ARS",
        "fecha": "2024-01-18",
    },
}


def validate_extraction(filename: str, result: dict, expected: dict) -> tuple[bool, list[str]]:
    """
    Validate extraction results against expected values.
    
    Returns: (is_valid, errors_list)
    """
    errors = []
    
    for field, expected_value in expected.items():
        actual_value = result.get(field)
        
        # Skip validation if field is None in both
        if actual_value is None and expected_value is None:
            continue
            
        # Handle numeric comparison with tolerance
        if isinstance(expected_value, (int, float)) and isinstance(actual_value, (int, float)):
            tolerance = 0.01
            if abs(actual_value - expected_value) > tolerance:
                errors.append(f"  {field}: expected {expected_value}, got {actual_value}")
        else:
            # String comparison (case-insensitive for some fields)
            if str(actual_value).lower() != str(expected_value).lower():
                errors.append(f"  {field}: expected '{expected_value}', got '{actual_value}'")
    
    return len(errors) == 0, errors


def test_pdf():
    """Test PDF document parsing."""
    print("\n[PDF] sample_invoice.pdf")
    doc_path = Path("documents/sample_invoice.pdf")
    
    if not doc_path.exists():
        print("  ❌ File not found")
        return False
    
    try:
        load_dotenv()
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        text = extract_text(doc_path)
        result = extract_receipt_json(client, model, doc_path, text)
        
        is_valid, errors = validate_extraction("sample_invoice.pdf", result, EXPECTED_VALUES["sample_invoice.pdf"])
        
        if is_valid:
            print(f"  ✓ Extracted correctly")
            print(f"    - Vendor: {result.get('description_proveedor')}")
            print(f"    - Total: {result.get('total')} {result.get('moneda')}")
            return True
        else:
            print(f"  ✗ Validation failed:")
            for error in errors:
                print(error)
            return False
    except Exception as e:
        print(f"  ✗ Error: {str(e)[:100]}")
        return False


def test_jpg_image():
    """Test JPG image parsing."""
    print("\n[JPG] sample_invoice_scan.jpg")
    doc_path = Path("documents/sample_invoice_scan.jpg")
    
    if not doc_path.exists():
        print("  ❌ File not found")
        return False
    
    try:
        load_dotenv()
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        image_data_uri = to_data_uri(doc_path)
        result = extract_receipt_json_from_image(client, model, doc_path, image_data_uri)
        
        is_valid, errors = validate_extraction("sample_invoice_scan.jpg", result, EXPECTED_VALUES["sample_invoice_scan.jpg"])
        
        if is_valid:
            print(f"  ✓ Extracted correctly")
            print(f"    - Vendor: {result.get('description_proveedor')}")
            print(f"    - Total: {result.get('total')} {result.get('moneda')}")
            return True
        else:
            print(f"  ✗ Validation failed:")
            for error in errors:
                print(error)
            return False
    except Exception as e:
        print(f"  ✗ Error: {str(e)[:100]}")
        return False


def test_png_image():
    """Test PNG image parsing."""
    print("\n[PNG] sample_receipt.png")
    doc_path = Path("documents/sample_receipt.png")
    
    if not doc_path.exists():
        print("  ❌ File not found")
        return False
    
    try:
        load_dotenv()
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        image_data_uri = to_data_uri(doc_path)
        result = extract_receipt_json_from_image(client, model, doc_path, image_data_uri)
        
        is_valid, errors = validate_extraction("sample_receipt.png", result, EXPECTED_VALUES["sample_receipt.png"])
        
        if is_valid:
            print(f"  ✓ Extracted correctly")
            print(f"    - Vendor: {result.get('description_proveedor')}")
            print(f"    - Total: {result.get('total')} {result.get('moneda')}")
            return True
        else:
            print(f"  ✗ Validation failed:")
            for error in errors:
                print(error)
            return False
    except Exception as e:
        print(f"  ✗ Error: {str(e)[:100]}")
        return False


def test_text_file():
    """Test text file parsing."""
    print("\n[TXT] sample_receipt.txt")
    doc_path = Path("documents/sample_receipt.txt")
    
    if not doc_path.exists():
        print("  ❌ File not found")
        return False
    
    try:
        load_dotenv()
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        text = extract_text(doc_path)
        result = extract_receipt_json(client, model, doc_path, text)
        
        is_valid, errors = validate_extraction("sample_receipt.txt", result, EXPECTED_VALUES["sample_receipt.txt"])
        
        if is_valid:
            print(f"  ✓ Extracted correctly")
            print(f"    - Vendor: {result.get('description_proveedor')}")
            print(f"    - Total: {result.get('total')} {result.get('moneda')}")
            return True
        else:
            print(f"  ✗ Validation failed:")
            for error in errors:
                print(error)
            return False
    except Exception as e:
        print(f"  ✗ Error: {str(e)[:100]}")
        return False


def main():
    """Run all validation tests."""
    print("\n" + "=" * 60)
    print("Document Parsing Validation Tests")
    print("=" * 60)
    
    # Check API key
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        print("\n❌ OPENAI_API_KEY not found in .env")
        return 1
    
    print("\nRunning validation tests...")
    
    results = []
    results.append(("PDF", test_pdf()))
    results.append(("JPG Image", test_jpg_image()))
    results.append(("PNG Image", test_png_image()))
    results.append(("Text File", test_text_file()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Results")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} passed")
    
    if passed == total:
        print("\n✓ All tests passed!")
        return 0
    else:
        print(f"\n✗ {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
