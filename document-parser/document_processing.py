from __future__ import annotations

import base64
import io
from pathlib import Path


SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx", ".jpg", ".jpeg", ".png"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def extract_text(file_path: Path) -> str:
    suffix = file_path.suffix.lower()

    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8", errors="ignore")

    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(file_path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)

    if suffix == ".docx":
        from docx import Document

        document = Document(str(file_path))
        paragraphs = [paragraph.text for paragraph in document.paragraphs]
        return "\n".join(paragraphs)

    raise ValueError(f"Unsupported file type: {file_path.suffix}")


def load_documents(folder: Path) -> list[Path]:
    if not folder.exists():
        raise FileNotFoundError(f"Input folder does not exist: {folder}")

    files = [path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS]
    return sorted(files)


def is_image_document(file_path: Path) -> bool:
    return file_path.suffix.lower() in IMAGE_EXTENSIONS


def to_data_uri(file_path: Path) -> str:
    mime_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
    }.get(file_path.suffix.lower())

    if not mime_type:
        raise ValueError(f"Unsupported image file type: {file_path.suffix}")

    encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"