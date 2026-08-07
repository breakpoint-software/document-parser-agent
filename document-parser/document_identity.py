from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable


class DocumentIdentityError(ValueError):
    """Raised when identity configuration is invalid."""


def _normalize_uppercase(value: Any, component: dict[str, Any]) -> str:
    return str(value).strip().upper()


def _normalize_digits(value: Any, component: dict[str, Any]) -> str:
    normalized = re.sub(r"\D", "", str(value))
    width = component.get("width")
    if width is not None:
        normalized = normalized.zfill(int(width))
    return normalized


def _normalize_date(value: Any, component: dict[str, Any]) -> str:
    text = str(value).strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return ""


def _normalize_time(value: Any, component: dict[str, Any]) -> str:
    text = str(value).strip()
    match = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?", text)
    if not match:
        return ""
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _normalize_decimal(value: Any, component: dict[str, Any]) -> str:
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        return ""
    scale = int(component.get("scale", 2))
    return format(number.quantize(Decimal(1).scaleb(-scale)), "f")


def _normalize_text(value: Any, component: dict[str, Any]) -> str:
    text = re.sub(r"\s+", " ", str(value).strip().upper())
    return text.replace("|", "-").replace("/", "-")


NORMALIZERS: dict[str, Callable[[Any, dict[str, Any]], str]] = {
    "uppercase": _normalize_uppercase,
    "digits": _normalize_digits,
    "date": _normalize_date,
    "time": _normalize_time,
    "decimal": _normalize_decimal,
    "text": _normalize_text,
}


def validate_identity_config(identity_config: dict[str, Any], schema: dict[str, Any]) -> None:
    strategies = identity_config.get("strategies")
    properties = schema.get("properties", {})
    if not isinstance(strategies, list) or not strategies:
        raise DocumentIdentityError("Identity configuration must define at least one strategy.")

    strategy_names: set[str] = set()
    for strategy in strategies:
        name = str(strategy.get("name") or "").strip()
        required = strategy.get("required")
        components = strategy.get("components")
        if not name or name in strategy_names:
            raise DocumentIdentityError("Identity strategy names must be present and unique.")
        strategy_names.add(name)
        if not isinstance(required, list) or not required:
            raise DocumentIdentityError(f"Identity strategy '{name}' must define required fields.")
        if not isinstance(components, list) or not components:
            raise DocumentIdentityError(f"Identity strategy '{name}' must define components.")

        component_fields = {str(component.get("field") or "") for component in components}
        for field in required:
            if field not in properties:
                raise DocumentIdentityError(f"Identity field '{field}' is missing from the extraction schema.")
            if field not in component_fields:
                raise DocumentIdentityError(f"Required identity field '{field}' is not a component of '{name}'.")
        for component in components:
            field = str(component.get("field") or "")
            normalizer = str(component.get("normalizer") or "")
            if field not in properties:
                raise DocumentIdentityError(f"Identity field '{field}' is missing from the extraction schema.")
            if normalizer not in NORMALIZERS:
                raise DocumentIdentityError(f"Unknown identity normalizer '{normalizer}'.")


def build_document_identity(
    parsed: dict[str, Any],
    identity_config: dict[str, Any],
) -> dict[str, Any] | None:
    separator = str(identity_config.get("separator") or "|")
    version = int(identity_config.get("version", 1))

    for strategy in identity_config["strategies"]:
        required = strategy["required"]
        if any(parsed.get(field) is None or str(parsed.get(field)).strip() == "" for field in required):
            continue

        components: dict[str, str] = {}
        key_parts: list[str] = []
        valid = True
        for component in strategy["components"]:
            field = component["field"]
            normalized = NORMALIZERS[component["normalizer"]](parsed.get(field), component)
            if not normalized:
                valid = False
                break
            components[field] = normalized
            key_parts.append(normalized)

        if valid:
            identity_key = separator.join(key_parts)
            if "/" in identity_key or len(identity_key.encode("utf-8")) > 1500:
                raise DocumentIdentityError("Generated identity key is not a valid Firestore document ID.")
            return {
                "identity_key": identity_key,
                "identity_strategy": strategy["name"],
                "identity_strength": strategy.get("strength", "weak"),
                "identity_version": version,
                "identity_components": components,
            }

    return None