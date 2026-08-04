from __future__ import annotations


def build_empty_result(source_file: str) -> dict:
    return {
        "source_file": source_file,
        "document_type": "unknown",
        "fecha": None,
        "fecha_vencimiento": None,
        "cuit_proveedor": None,
        "description_proveedor": None,
        "moneda": None,
        "subtotal": None,
        "taxes": None,
        "total": None,
        "confidence": 0,
    }