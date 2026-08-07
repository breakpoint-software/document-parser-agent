from __future__ import annotations


def build_empty_result(source_file: str) -> dict:
    return {
        "source_file": source_file,
        "document_type": "unknown",
        "country": "AR",
        "invoice_date": None,
        "invoice_time": None,
        "due_date": None,
        "supplier_tax_id": None,
        "supplier_name": None,
        "currency": None,
        "subtotal": None,
        "taxes": None,
        "total": None,
        "invoice_number": None,
        "document_code": None,
        "point_of_sale": None,
        "terminal_id": None,
        "invoice_letter": None,
        "confidence": 0,
    }