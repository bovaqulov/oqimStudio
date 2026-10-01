"""The one place this product talks to a model.

Every rule the rest of the app relies on is enforced here, and nowhere else:

**Nothing raises.** A missing package, a missing key, a 429, a socket that
never answered — all of them come back as a `ProviderReply` with `ok=False` and
a `kind` naming which. The caller is a Telegram webhook running inside a Celery
task: an exception climbing out of here marks a customer's conversation FAILED
and, on the inline-dispatch path, hands Telegram a 500 it will retry forever.

**A missing key is a stated answer, not a crash.** Same shape as
`engine.script.is_available()`: the machine either can do this or it cannot,
the block says which in its trace, and the rest of the runtime is unaffected.
There is no import of `anthropic` at module scope for exactly this reason — the
package is optional, the test suite must not need it, and `pip install -r
requirements.txt` on a machine that will never run an agent must not fail.

**`AGENTS_OFFLINE=1` means no request leaves the machine**, the same promise
`TELEGRAM_OFFLINE` makes for the Bot API. It answers with a canned reply so the
whole path — block → tools → guard → send → trace — can be walked on a laptop
with no key and no account. It deliberately never asks for a tool: a canned
tool call would make the offline behaviour a fiction that has to be kept in
step with the real one. Tests that need a specific model behaviour patch
`complete` instead, which is why the seam is one function.

**The request shape comes from `catalogue`, not from memory.** `temperature`,
`output_config.effort` and `thinking` are each a 400 on some model in the
table; `_build_request` reads the row rather than guessing. `thinking` is never
sent at all — omitting it runs adaptive on Sonnet 5 and Opus 5 and runs nothing
on Haiku 4.5, which is the right default for each, and *disabling* it on Opus 5
has documented failure modes (a tool call written into visible text, tags
leaking into the reply) that a customer would read as a broken bot.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings

from .catalogue import get_model

logger = logging.getLogger(__name__)

#: How long one model call may take. Bounded, and low, because this runs inside
#: an update being processed: Telegram has already been answered 200 by the
#: webhook, but the customer is sitting in front of a chat window and a worker
#: is held for the duration.
REQUEST_TIMEOUT_SECONDS = 45.0

#: Retries the SDK does on 429 and 5xx before giving up. Two, not the default,
#: because the whole turn has a budget and three backoffs would spend it on
#: waiting rather than on answering.
MAX_RETRIES = 2

#: Why the call did not produce an answer. The caller maps these onto
#: `AgentRun.Reason`; they are separate vocabularies because a provider knows
#: about sockets and an agent knows about budgets.
UNAVAILABLE = "unavailable"
REFUSAL = "refusal"
ERROR = "error"


@dataclass(frozen=True)
class ToolCall:
    """One tool the model asked for, exactly as it asked for it.

    `input` is raw and unvalidated at this point — `tools.validate_arguments`
    is what turns it into something that may be acted on. Keeping the two apart
    is the whole of the "typed arguments" defence: nothing between here and
    there is allowed to use this dict.
    """

    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ProviderReply:
    """One model call's result, in plain data.

    Plain data and not the SDK's own objects on purpose: `services` must be
    drivable by a test that has never imported `anthropic`, and a fake that had
    to reproduce pydantic models would be a fake nobody trusts.
    """

    ok: bool
    #: `end_turn`, `tool_use`, `max_tokens`, `refusal`, …
    stop_reason: str = ""
    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    #: The assistant turn as content blocks, to be echoed back on the next
    #: request. Thinking blocks included — Opus 5 thinks by default and a turn
    #: replayed without them is not the turn the model produced.
    content: tuple[dict[str, Any], ...] = ()
    input_tokens: int = 0
    output_tokens: int = 0
    #: UNAVAILABLE / REFUSAL / ERROR when `ok` is false.
    kind: str = ""
    error: str = ""
    #: Extra detail for the trace, never for the customer.
    detail: dict[str, Any] = field(default_factory=dict)


def api_key() -> str:
    """The credential, or empty when the deployment has not been given one."""
    return getattr(settings, "ANTHROPIC_API_KEY", "") or ""


def is_offline() -> bool:
    return bool(getattr(settings, "AGENTS_OFFLINE", False))


def unavailable_reason() -> str:
    """Why this machine cannot run an agent, or "" when it can.

    Written for the person reading the block's trace in the panel, so it names
    the thing they have to do rather than the exception they would have seen.
    """
    if is_offline():
        return ""
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return "Anthropic SDK o'rnatilmagan (pip install anthropic)"
    if not api_key():
        return "ANTHROPIC_API_KEY sozlanmagan"
    return ""


def is_available() -> bool:
    """Whether this machine can call a model at all.

    The same question `engine.script.is_available()` answers about Node, and it
    has the same consequence: false is a block that reports «sozlanmagan» and
    takes an exit, not a runtime that stops working.
    """
    return not unavailable_reason()


def _dump_block(block: Any) -> dict[str, Any]:
    """One SDK content block as a plain dict fit to send straight back.

    `exclude_none` matters: a text block carries `citations: None` when nothing
    asked for citations, and echoing that back is a field the API did not send
    us reappearing in a request.
    """
    dump = getattr(block, "model_dump", None)
    if callable(dump):
        return dump(exclude_none=True)
    if isinstance(block, dict):
        return {key: value for key, value in block.items() if value is not None}
    return {}


def _build_request(
    *,
    model_id: str,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    max_tokens: int,
    effort: str,
) -> dict[str, Any]:
    """The request body, assembled from what this particular model accepts.

    The system instruction is sent as a cacheable block. It is the same bytes on
    every message a bot answers — the persona, the rules, the tool descriptions
    — so it is the one part of the prompt that pays for a cache breakpoint, and
    the conversation that follows it is the volatile part. Caching is a prefix
    match, which is also the second reason nothing from a conversation may be
    concatenated into `system`: it would invalidate the prefix on every single
    message as well as opening the injection this app spends its effort closing.
    """
    model = get_model(model_id)
    request: dict[str, Any] = {
        "model": model.id,
        "max_tokens": max_tokens,
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": messages,
    }
    if tools:
        request["tools"] = tools
    if model.supports_effort and effort:
        request["output_config"] = {"effort": effort}
    return request


def complete(
    *,
    model_id: str,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    max_tokens: int = 800,
    effort: str = "medium",
) -> ProviderReply:
    """One model call. The seam every test fakes and the only socket this app opens."""
    if is_offline():
        return _offline_reply(messages)

    reason = unavailable_reason()
    if reason:
        return ProviderReply(ok=False, kind=UNAVAILABLE, error=reason)

    import anthropic

    request = _build_request(
        model_id=model_id,
        system=system,
        messages=messages,
        tools=tools or [],
        max_tokens=max_tokens,
        effort=effort,
    )

    try:
        client = anthropic.Anthropic(
            api_key=api_key(), timeout=REQUEST_TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        response = client.messages.create(**request)
    except Exception as exc:  # noqa: BLE001 - see the module docstring: nothing leaves here as an exception
        # `exception` rather than `error`: the traceback is the only thing that
        # tells a 400 on a request shape apart from a network blip, and the
        # customer-facing half of this is one word on an exit.
        logger.exception("agent model call failed (%s)", model_id)
        return ProviderReply(ok=False, kind=ERROR, error=f"{type(exc).__name__}: {exc}"[:280])

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    stop_reason = getattr(response, "stop_reason", "") or ""

    # Checked before `content` is read at all. A refusal is an HTTP 200 with a
    # `stop_reason` — treating it as an ordinary answer would send whatever
    # partial text came with it to a customer.
    if stop_reason == REFUSAL:
        details = getattr(response, "stop_details", None)
        return ProviderReply(
            ok=False,
            kind=REFUSAL,
            stop_reason=stop_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            error="Model javob berishdan bosh tortdi",
            detail={"category": getattr(details, "category", "") or ""},
        )

    text_parts: list[str] = []
    calls: list[ToolCall] = []
    blocks: list[dict[str, Any]] = []
    for block in getattr(response, "content", []) or []:
        blocks.append(_dump_block(block))
        kind = getattr(block, "type", "")
        if kind == "text":
            text_parts.append(getattr(block, "text", "") or "")
        elif kind == "tool_use":
            calls.append(
                ToolCall(
                    id=getattr(block, "id", "") or "",
                    name=getattr(block, "name", "") or "",
                    input=dict(getattr(block, "input", {}) or {}),
                )
            )

    return ProviderReply(
        ok=True,
        stop_reason=stop_reason,
        text="\n".join(part for part in text_parts if part).strip(),
        tool_calls=tuple(calls),
        content=tuple(blocks),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


#: What an offline agent says. Named so a reader of a trace, a chat window or a
#: test failure can tell in one glance that no model was involved.
OFFLINE_PREFIX = "[oflayn]"

#: The `<mijoz_xabari>` / `<vosita_javobi>` markers `services` wraps untrusted
#: text in. Matched loosely on purpose — this is a display concern, and a
#: pattern coupled to the exact tag names would need editing every time one is
#: added, in a module that has no other reason to know them.
_ENVELOPE = re.compile(r"</?[a-z_]+>")


def _offline_reply(messages: list[dict[str, Any]]) -> ProviderReply:
    """A deterministic answer, with nothing sent anywhere.

    Deterministic and derived from the last customer message, so a test can
    assert on it and a person driving the stand can see that their words
    reached the block. It never asks for a tool — see the module docstring.

    The envelope tags the caller wraps a customer's words in are stripped back
    off. They are a convention between `services` and the *model*, and echoing
    them at somebody watching a Telegram chat would make the offline mode read
    as a bug in the tagging rather than as a stand-in for an answer.
    """
    last = ""
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            last = content
        elif isinstance(content, list):
            last = " ".join(
                str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text"
            )
        if last:
            break

    echoed = f"{OFFLINE_PREFIX} {_ENVELOPE.sub('', last).strip()}".strip()
    return ProviderReply(
        ok=True,
        stop_reason="end_turn",
        text=echoed,
        content=({"type": "text", "text": echoed},),
        input_tokens=0,
        output_tokens=0,
    )
