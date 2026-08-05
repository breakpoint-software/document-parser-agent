from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


EXTRACTION_INSTRUCTIONS = (
    "You extract purchase receipt information from a single document. "
    "Return one JSON object that matches the schema exactly. "
    "Use null for missing values, empty arrays for missing line items, and numbers for amounts. "
    "Prefer the receipt's own values over guesses. "
    "Extract only these fields: fecha, fecha_vencimiento, cuit_proveedor, description_proveedor, moneda, subtotal, taxes, total. "
    "If the document is not a purchase receipt, set document_type to unknown but still capture any purchase-related hints you can find. "
    "Do not add markdown, prose, or extra keys."
)


def resolve_extraction_instructions(extraction_instructions: str | None) -> str:
    if extraction_instructions and extraction_instructions.strip():
        return extraction_instructions.strip()
    return EXTRACTION_INSTRUCTIONS


def build_user_prompt(file_name: str, source_type: str) -> str:
    return (
        f"File name: {file_name}\n\n"
        f"Source type: {source_type}\n"
        "Important rules:\n"
        "- Read the full document before answering.\n"
        "- Copy amounts as numbers, not strings.\n"
        "- Use ISO 8601 for dates when possible.\n"
        "- Extract only: fecha, fecha_vencimiento, cuit_proveedor, description_proveedor, moneda, subtotal, taxes, total.\n"
        "- If a field cannot be found confidently, set it to null.\n"
        "- Keep output compact and do not include extra fields."
    )


def build_schema() -> dict[str, Any]:
    return {
        "name": "purchase_receipt_extraction",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "source_file": {"type": "string"},
                "document_type": {"type": "string", "enum": ["purchase_receipt", "unknown"]},
                "fecha": {"type": ["string", "null"], "description": "ISO 8601 date when possible."},
                "fecha_vencimiento": {"type": ["string", "null"], "description": "Tax ID of the company or individual issuing the invoice. Never the customer." },
                "cuit_proveedor": {"type": ["string", "null"]},
                "description_proveedor": {"type": ["string", "null"],     "description": "Legal name of the company or individual issuing the invoice. Never the customer." },
                "moneda": {"type": ["string", "null"]},
                "subtotal": {"type": ["number", "null"]},
                "taxes": {"type": ["number", "null"]},
                "total": {"type": ["number", "null"]},
                "invoice_number": { "type": ["string", "null"], "description": "Invoice or receipt number exactly as printed." },
                "invoice_letter": { "type": ["string", "null"], "enum": [ "A", "B", "C", "M", "E", None ], "description": "Argentine invoice letter." },
                "confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
            },
            "required": [
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
                "invoice_number",
                "invoice_letter",
                "confidence",
            ],
        },
        "strict": True,
    }


def extract_receipt_json(
    client: Any,
    model: str,
    file_path: Path,
    text: str,
    extraction_instructions: str | None = None,
) -> dict[str, Any]:
    logger.debug("extract_receipt_json called: file=%s, model=%s, text_length=%s", file_path.name, model, len(text))
    
    try:
        logger.debug("Sending text extraction request to OpenAI for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=resolve_extraction_instructions(extraction_instructions),
            input=f"{build_user_prompt(file_path.name, 'text')}\n\nDocument text:\n{text[:20000]}",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "purchase_receipt_extraction",
                    "schema": build_schema()["schema"],
                    "strict": True,
                }
            },
        )
        
        logger.debug("Received response from OpenAI for %s", file_path.name)

        output_text = getattr(response, "output_text", None)
        if output_text:
            logger.debug("Parsing output_text from response")
            result = json.loads(output_text)
            logger.debug("Successfully parsed JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        if response.output and response.output[0].content:
            logger.debug("Parsing response.output content")
            result = json.loads(response.output[0].content[0].text)
            logger.debug("Successfully parsed JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        logger.error("No JSON returned for %s - no output_text and no response.output", file_path.name)
        raise RuntimeError(f"No JSON returned for {file_path.name}")
    
    except json.JSONDecodeError as e:
        logger.error("JSON decode error for %s: %s", file_path.name, e)
        raise
    except Exception as e:
        logger.error("Error in extract_receipt_json for %s: %s", file_path.name, e)
        raise


def extract_receipt_json_from_image(
    client: Any,
    model: str,
    file_path: Path,
    image_data_uri: str,
    extraction_instructions: str | None = None,
) -> dict[str, Any]:
    logger.debug("extract_receipt_json_from_image called: file=%s, model=%s, image_size=%s bytes", 
                file_path.name, model, len(image_data_uri))
    
    try:
        logger.debug("Sending image extraction request to OpenAI for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=resolve_extraction_instructions(extraction_instructions),
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": build_user_prompt(file_path.name, "image"),
                        },
                        {
                            "type": "input_image",
                            "image_url": image_data_uri,
                            "detail": "high",
                        },
                    ],
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "purchase_receipt_extraction",
                    "schema": build_schema()["schema"],
                    "strict": True,
                }
            },
        )
        
        logger.debug("Received response from OpenAI for image %s", file_path.name)

        output_text = getattr(response, "output_text", None)
        if output_text:
            logger.debug("Parsing output_text from image response")
            result = json.loads(output_text)
            logger.debug("Successfully parsed image JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        if response.output and response.output[0].content:
            logger.debug("Parsing response.output content from image")
            result = json.loads(response.output[0].content[0].text)
            logger.debug("Successfully parsed image JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        logger.error("No JSON returned for image %s - no output_text and no response.output", file_path.name)
        raise RuntimeError(f"No JSON returned for {file_path.name}")
    
    except json.JSONDecodeError as e:
        logger.error("JSON decode error for image %s: %s", file_path.name, e)
        raise
    except Exception as e:
        logger.error("Error in extract_receipt_json_from_image for %s: %s", file_path.name, e)
        raise


def extract_receipt_json_from_pdf(
    client: Any,
    model: str,
    file_path: Path,
    extraction_instructions: str | None = None,
) -> dict[str, Any]:
    """Upload PDF to OpenAI Files API and extract structured data."""
    logger.debug("extract_receipt_json_from_pdf called: file=%s, model=%s", file_path.name, model)
    
    file_id = None
    try:
        # 1. Upload PDF to Files API
        logger.debug("Uploading PDF to OpenAI Files API: %s", file_path.name)
        with open(file_path, "rb") as pdf_file:
            uploaded_file = client.files.create(
                file=pdf_file,
                purpose="user_data"
            )
            file_id = uploaded_file.id
            logger.debug("PDF uploaded successfully, file_id: %s", file_id)
        
        # 2. Send file_id to model for processing
        logger.debug("Sending PDF to OpenAI via Files API for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=resolve_extraction_instructions(extraction_instructions),
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_file",
                            "file_id": file_id
                        },
                        {
                            "type": "input_text",
                            "text": build_user_prompt(file_path.name, "pdf")
                        }
                    ]
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "purchase_receipt_extraction",
                    "schema": build_schema()["schema"],
                    "strict": True,
                }
            },
        )
        
        logger.debug("Received response from OpenAI for PDF %s", file_path.name)

        output_text = getattr(response, "output_text", None)
        if output_text:
            logger.debug("Parsing output_text from PDF response")
            result = json.loads(output_text)
            logger.debug("Successfully parsed PDF JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        if response.output and response.output[0].content:
            logger.debug("Parsing response.output content from PDF")
            result = json.loads(response.output[0].content[0].text)
            logger.debug("Successfully parsed PDF JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        logger.error("No JSON returned for PDF %s - no output_text and no response.output", file_path.name)
        raise RuntimeError(f"No JSON returned for {file_path.name}")
    
    except json.JSONDecodeError as e:
        logger.error("JSON decode error for PDF %s: %s", file_path.name, e)
        raise
    except Exception as e:
        logger.error("Error in extract_receipt_json_from_pdf for %s: %s", file_path.name, e)
        raise
    finally:
        # Clean up uploaded file
        if file_id:
            try:
                logger.debug("Deleting uploaded file: %s", file_id)
                client.files.delete(file_id)
            except Exception as e:
                logger.warning("Failed to delete file %s: %s", file_id, e)


def extract_receipt_json_from_document(
    client: Any,
    model: str,
    file_path: Path,
    extraction_instructions: str | None = None,
) -> dict[str, Any]:
    """Send document type to OpenAI by extracting text (DOCX, TXT, etc)."""
    logger.debug("extract_receipt_json_from_document called: file=%s, model=%s", file_path.name, model)
    
    try:
        logger.debug("Extracting text from document: %s", file_path.name)
        
        # Extract text based on file type
        if file_path.suffix.lower() == ".txt":
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            logger.debug("Read TXT file: %s characters", len(text))
        
        elif file_path.suffix.lower() == ".docx":
            from docx import Document
            document = Document(str(file_path))
            paragraphs = [paragraph.text for paragraph in document.paragraphs]
            text = "\n".join(paragraphs)
            logger.debug("Extracted DOCX file: %s characters", len(text))
        
        else:
            logger.warning("Unsupported document format: %s, attempting generic text read", file_path.suffix)
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            logger.debug("Read document file: %s characters", len(text))
        
        # Send extracted text to OpenAI
        logger.debug("Sending extracted document text to OpenAI for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=resolve_extraction_instructions(extraction_instructions),
            input=f"{build_user_prompt(file_path.name, 'document')}\n\nDocument text:\n{text[:20000]}",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "purchase_receipt_extraction",
                    "schema": build_schema()["schema"],
                    "strict": True,
                }
            },
        )
        
        logger.debug("Received response from OpenAI for document %s", file_path.name)

        output_text = getattr(response, "output_text", None)
        if output_text:
            logger.debug("Parsing output_text from document response")
            result = json.loads(output_text)
            logger.debug("Successfully parsed document JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        if response.output and response.output[0].content:
            logger.debug("Parsing response.output content from document")
            result = json.loads(response.output[0].content[0].text)
            logger.debug("Successfully parsed document JSON: document_type=%s, total=%s, confidence=%s", 
                        result.get("document_type"), result.get("total"), result.get("confidence"))
            return result

        logger.error("No JSON returned for document %s - no output_text and no response.output", file_path.name)
        raise RuntimeError(f"No JSON returned for {file_path.name}")
    
    except json.JSONDecodeError as e:
        logger.error("JSON decode error for document %s: %s", file_path.name, e)
        raise
    except Exception as e:
        logger.error("Error in extract_receipt_json_from_document for %s: %s", file_path.name, e)
        raise