#!/usr/bin/env python3
"""Quick test to parse the invoice document"""
import os
import sys
import json
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from openai import OpenAI
from document_processing import extract_text

# Load environment
load_dotenv()

doc_path = Path("documents/factura-ejemplo.pdf")

if not doc_path.exists():
    print(f"File not found: {doc_path}")
    sys.exit(1)

print("\n" + "=" * 70)
print("Testing Invoice Document Parsing")
print("=" * 70)

print(f"\nDocument: {doc_path.name}")
print(f"Size: {doc_path.stat().st_size} bytes")

# Extract text
print("\n[Step 1] Extracting text from PDF...")
try:
    text = extract_text(doc_path)
    print(f"✓ Extracted {len(text)} characters")
    print("\nExtracted text preview:")
    print("-" * 70)
    print(text[:500] if len(text) > 500 else text)
    print("-" * 70)
except Exception as e:
    print(f"✗ Error: {e}")
    sys.exit(1)

# Parse with OpenAI
print("\n[Step 2] Parsing with OpenAI...")
try:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    model = os.getenv("OPENAI_MODEL", "gpt-4o")
    
    from receipt_ai import extract_receipt_json
    result = extract_receipt_json(client, model, doc_path, text)
    
    print("✓ Parsed successfully")
    print("\nExtracted data:")
    print("-" * 70)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("-" * 70)
    
    print("\nKey Fields:")
    print(f"  Document Type: {result.get('document_type')}")
    print(f"  Vendor: {result.get('description_proveedor')}")
    print(f"  Date: {result.get('fecha')}")
    print(f"  Due Date: {result.get('fecha_vencimiento')}")
    print(f"  Currency: {result.get('moneda')}")
    print(f"  Subtotal: {result.get('subtotal')}")
    print(f"  Taxes: {result.get('taxes')}")
    print(f"  Total: {result.get('total')}")
    print(f"  Confidence: {result.get('confidence')}")
    
    if result.get('total'):
        print(f"\n✓ Invoice successfully parsed with confidence: {result.get('confidence')}")
    else:
        print(f"\n⚠ Warning: Total amount not extracted")
        
except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
