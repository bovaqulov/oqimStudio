"""Evaluating a "Shart" block.

The editor stores a condition as a combinator plus a list of rules, each of
which reads one field of the update, compares it, and may be negated. The same
vocabulary is implemented here — a rule the author can build in the inspector
is a rule the runtime can answer, and no other.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone


def _field_value(field: str, rule: dict, run) -> Any:
    """What this rule is comparing against, read off the run's context."""
    context = run.context or {}
    contact = run.contact

    # The same names the placeholders use (see `runner._initial_context`), so a
    # rule and a message body cannot disagree about what "the chat type" is.
    if field == "message_text":
        return context.get("message.text", "")
    if field == "command":
        return context.get("buyruq", "")
    if field == "user_username":
        return context.get("user.username") or (contact.username if contact else "")
    if field == "user_first_name":
        return context.get("user.first_name") or (contact.first_name if contact else "")
    if field == "chat_type":
        return context.get("chat.type") or (contact.chat_type if contact else "")
    if field == "chat_title":
        return context.get("chat.title", "")
    if field == "media_type":
        return context.get("media_type", "")
    if field == "business_connection_id":
        return context.get("business.connection_id", "")
    if field == "variable":
        name = rule.get("variableName") or ""
        if name in context:
            return context[name]
        return (contact.variables or {}).get(name, "") if contact else ""
    if field == "datetime":
        return timezone.now()
    return ""


def _as_datetime(value: Any):
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def evaluate_rule(rule: dict, run) -> bool:
    field = rule.get("field", "message_text")
    operator = rule.get("operator", "equals")
    expected = rule.get("value", "")
    actual = _field_value(field, rule, run)

    if operator in {"is_empty", "is_not_empty"}:
        empty = actual in (None, "", [], {})
        result = empty if operator == "is_empty" else not empty
    elif operator in {"after", "before"}:
        left, right = _as_datetime(actual), _as_datetime(expected)
        # An unparseable date is not "before everything"; it is a rule that
        # cannot be answered, and an unanswerable rule is false.
        result = False if left is None or right is None else (left > right if operator == "after" else left < right)
    else:
        left = str(actual or "").strip().lower()
        right = str(expected or "").strip().lower()
        result = {
            "equals": left == right,
            "not_equals": left != right,
            "contains": right in left,
            "not_contains": right not in left,
            "starts_with": left.startswith(right),
            "ends_with": left.endswith(right),
        }.get(operator, False)

    return not result if rule.get("negate") else result


def evaluate_condition(config: dict, run) -> bool:
    """AND/OR over the block's rules. No rules at all reads as true — an
    unconfigured condition should not silently swallow every conversation."""
    rules = config.get("rules") or []
    if not rules:
        return True
    results = (evaluate_rule(rule, run) for rule in rules)
    return any(results) if (config.get("combinator") or "AND") == "OR" else all(results)
