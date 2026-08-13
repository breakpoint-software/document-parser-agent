from __future__ import annotations

import base64
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from firebase_workspace_config import FirebaseWorkspaceConfigManager


logger = logging.getLogger(__name__)


@lru_cache(maxsize=32)
def load_extraction_scheme(schema_id: str) -> dict[str, Any]:
    collection_name = os.getenv("FIREBASE_EXTRACTION_SCHEMES_COLLECTION", "extraction_schemes").strip()
    schema_id = schema_id.strip()
    if not collection_name or not schema_id:
        raise RuntimeError("Firebase extraction schema collection and document ID must not be blank.")

    manager = FirebaseWorkspaceConfigManager()
    return manager.get_extraction_scheme(schema_id, collection_name)


def get_response_format(extraction_scheme: dict[str, Any]) -> dict[str, Any]:
    return {key: extraction_scheme[key] for key in ("name", "schema", "strict")}


def build_user_prompt(
    file_name: str,
    source_type: str,
    response_format: dict[str, Any],
) -> str:

    return f"""
Document information

File name: {file_name}
Source type: {source_type}

Extraction instructions

1. Read the entire document before extracting any values.

2. Internally identify these sections:
   - Document header
   - Issuer (supplier)
   - Customer / recipient
   - Totals section

3. Extract supplier information ONLY from the issuer section.

4. Never use customer or recipient information as supplier information.

5. Preserve identifiers exactly as printed.
   Examples:
    - CUIT
   - VAT ID
   - Invoice Number
   - Point of Sale
   - CAE

6. Return monetary values as JSON numbers.
   Do not include:
   - currency symbols
   - thousand separators

7. Return dates using ISO format (YYYY-MM-DD) whenever possible.

8. Currency must be the ISO 4217 code.
   Examples:
   ARS
   USD
   EUR
   BRL

9. If multiple VAT amounts exist, return the sum.

10. If any field is missing or ambiguous, return null.

11. Do not infer, calculate or guess values unless explicitly instructed.

12. Follow the provided JSON schema exactly.
"""

def extract_receipt_json(
    client: Any,
    model: str,
    file_path: Path,
    text: str,
    schema_id: str,
) -> dict[str, Any]:
    logger.debug("extract_receipt_json called: file=%s, model=%s, text_length=%s", file_path.name, model, len(text))
    extraction_scheme = load_extraction_scheme(schema_id)
    response_format = get_response_format(extraction_scheme)
    
    try:
        logger.debug("Sending text extraction request to OpenAI for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=extraction_scheme["parsing_prompt"],
            input=f"{build_user_prompt(file_path.name, 'text', response_format)}\n\nDocument text:\n{text[:20000]}",
            text={"format": {"type": "json_schema", **response_format}},
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
    schema_id: str,
) -> dict[str, Any]:
    logger.debug("extract_receipt_json_from_image called: file=%s, model=%s, image_size=%s bytes", 
                file_path.name, model, len(image_data_uri))
    extraction_scheme = load_extraction_scheme(schema_id)
    response_format = get_response_format(extraction_scheme)
    
    try:
        logger.debug("Sending image extraction request to OpenAI for %s", file_path.name)
        response = client.responses.create(
            model=model,
            instructions=extraction_scheme["parsing_prompt"],
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": build_user_prompt(file_path.name, "image", response_format),
                        },
                        {
                            "type": "input_image",
                            "image_url": image_data_uri,
                            "detail": "high",
                        },
                    ],
                }
            ],
            text={"format": {"type": "json_schema", **response_format}},
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
    schema_id: str,
) -> dict[str, Any]:
    """Upload PDF to OpenAI Files API and extract structured data."""
    logger.debug("extract_receipt_json_from_pdf called: file=%s, model=%s", file_path.name, model)
    extraction_scheme = load_extraction_scheme(schema_id)
    response_format = get_response_format(extraction_scheme)
    
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
            instructions=extraction_scheme["parsing_prompt"],
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
                            "text": build_user_prompt(file_path.name, "pdf", response_format)
                        }
                    ]
                }
            ],
            text={"format": {"type": "json_schema", **response_format}},
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
    schema_id: str,
) -> dict[str, Any]:
    """Send document type to OpenAI by extracting text (DOCX, TXT, etc)."""
    logger.debug("extract_receipt_json_from_document called: file=%s, model=%s", file_path.name, model)
    extraction_scheme = load_extraction_scheme(schema_id)
    response_format = get_response_format(extraction_scheme)
    
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
            instructions=extraction_scheme["parsing_prompt"],
            input=f"{build_user_prompt(file_path.name, 'document', response_format)}\n\nDocument text:\n{text[:20000]}",
            text={"format": {"type": "json_schema", **response_format}},
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