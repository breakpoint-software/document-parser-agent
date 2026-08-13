from __future__ import annotations

import json
import logging
from typing import Any

from firebase_workspace_config import RuleObject


logger = logging.getLogger(__name__)


RULE_SELECTION_FORMAT = {
    "name": "workspace_rule_selection",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "rule_id": {"type": ["string", "null"]},
        },
        "required": ["rule_id"],
    },
}


def _rule_payload(rule: RuleObject) -> dict[str, Any]:
    return {
        "rule_id": rule.rule_id,
        "rule_name": rule.rule_name,
        "priority": rule.priority,
        "condition_mode": rule.condition_mode,
        "conditions": rule.conditions or [],
    }


def select_rule_for_document(
    client: Any,
    model: str,
    parsed_document: dict[str, Any],
    rules: list[RuleObject],
) -> RuleObject | None:
    enabled_rules = [rule for rule in rules if rule.is_enabled and rule.rule_id]
    if not enabled_rules:
        return None

    enabled_rules.sort(key=lambda rule: rule.priority, reverse=True)
    response = client.responses.create(
        model=model,
        instructions=(
            "Select at most one enabled workspace rule for the parsed document. "
            "Evaluate each rule's conditions using its condition_mode: all requires every condition, "
            "any requires at least one. Prefer the highest priority when multiple rules match. "
            "Return null when no rule matches. Never return an identifier outside the supplied rules."
        ),
        input=json.dumps(
            {
                "parsed_document": parsed_document,
                "rules": [_rule_payload(rule) for rule in enabled_rules],
            },
            ensure_ascii=False,
            default=str,
        ),
        text={"format": {"type": "json_schema", **RULE_SELECTION_FORMAT}},
    )

    output_text = getattr(response, "output_text", None)
    if not output_text and getattr(response, "output", None):
        output_text = response.output[0].content[0].text
    if not output_text:
        raise RuntimeError("Rule selection returned no structured output.")

    selected_id = str((json.loads(output_text) or {}).get("rule_id") or "").strip()
    if not selected_id:
        return None

    selected_rule = next((rule for rule in enabled_rules if rule.rule_id == selected_id), None)
    if selected_rule is None:
        logger.warning("Rejected unknown rule selection rule_id=%s", selected_id)
        raise RuntimeError("Rule selection returned an invalid rule identifier.")
    return selected_rule