"""What a flow's script asked for, and the runtime doing it afterwards.

`hooks` is the half that runs an author's JavaScript and takes back what it
*computed*. This is the half that takes back what it wants *done*. A script
calling `bot.send()` sends nothing — it appends one entry to a list, and this
module walks that list once the script has returned without throwing.

The rule is worth stating as a rule, because everything else here follows from
it. A command is data until the script has finished, so:

  - the sandbox needs no network, no database and no Telegram token inside it.
    All six boundaries in `script.sandbox` survive a feature that sends
    messages, because the thing that sends them is out here;
  - a script that dies halfway leaves no half-done work. Three `bot.send()`
    calls followed by a `throw` send nothing, rather than three quarters of a
    conversation nobody can finish;
  - the list is journalled where the author already reads the trace;
  - and a test asserts on the list, which needs no mock of anything.

**`http` and `store` are the exception, and they are handled by stopping.** An
author writing `await store.incr("navbat")` needs the number while the script
is still running, and no amount of deferring produces it. So the script halts:
`script/runtime.mjs` registers what it wants, returns a promise that never
settles, and the run comes back marked `halted` with a list of requests. This
module performs them — out here, where a socket is allowed — and `hooks` runs
the script *again* with the answers in hand, where each one resolves from the
ledger instead of asking twice. Nothing crosses the sandbox wall in either
direction except JSON.

Replay is only safe because of the rule above. A script that has not finished
has done nothing, so re-running it repeats nothing; its command list is thrown
away with the round. The one call that must never happen twice is `store.incr`,
and it is keyed by its position in the run — the fourth request of the run is
answered from the ledger's fourth entry however many rounds the run takes.

**Nothing here raises.** A command that fails is one system step in the trace
and the conversation carries on, for the same reason a failed hook is
(`runner._fire`): the customer waiting on the next message is not the person
who can fix the script.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any

import requests
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from . import safe_http

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scopes — what a script declares it may do
# ---------------------------------------------------------------------------

#: The eight names a script can be granted. `studio` is the narrowest of them:
#: it manages the flows themselves, and it answers only on the management
#: surface — from the Script panel by hand, never from inside a customer's
#: conversation. See `_studio` and `engine.studio` for why that line is drawn
#: there and what happens on the other side of it.
SCOPES: tuple[str, ...] = ("flow", "bot", "user", "queue", "team", "http", "store", "studio")

#: Where the grant lives: a directive comment in the script itself.
#:
#:     // @ruxsat: flow, bot, user
#:
#: **In the file, and not in a column**, because the requirement is that it
#: survives export and import — and `Flow.script` already does, by decision and
#: with a docstring saying so: `export` writes it into the file, both importers
#: read it back, `duplicate` copies it. A column beside it would have to be
#: added to the migration, the two serializers, both importers, the exporter and
#: the marketplace's answer to "a template carries no script" — six places to
#: forget, against a flow whose grant travelled with it in one of them and not
#: the others. A flow that arrives with `bot.send()` in it and no grant does
#: nothing; a flow that arrives with both is a flow whose author wrote both
#: where a reader of the script can see them.
#:
#: The other half of that is why deny is the default. A shared flow — a template,
#: something a model wrote, a file somebody was sent — must not quietly message
#: your team or spend your HTTP quota because nobody thought to switch it off.
#: The refusal names the scope and says where to grant it, which is the only
#: sentence an author can act on.
#:
#: Both spellings are read. `@ruxsat` is the product's own language and the one
#: the panel writes; `@scopes` is what somebody arriving from the design
#: document types, and refusing it would be a puzzle rather than a rule.
SCOPE_DIRECTIVE = re.compile(r"^[^\S\n]*(?://+|/\*+|\*+)?[^\S\n]*@(?:ruxsat|scopes)[^\S\n]*:?(.*)$", re.MULTILINE)

#: What separates one name from the next inside that line.
_SCOPE_SEPARATORS = re.compile(r"[,\s]+")


def declared_scopes(script: str) -> tuple[str, ...]:
    """Which scopes this file grants itself, in `SCOPES` order.

    A regex over the text, the way `hooks.declared_hooks` is, and for the same
    reason: this is asked on every run of every flow that has a script, and the
    answer decides only what the sandbox will refuse. A name this does not see
    is a scope the script does not hold, which is the safe direction to be
    wrong in and the one the author is told about at the first call.
    """
    granted: set[str] = set()
    for line in SCOPE_DIRECTIVE.findall(str(script or "")):
        # `*/` closes the comment the directive was written in, so a line from
        # a block comment arrives with it still attached. Dropped rather than
        # matched around, because the alternative is a regex nobody can read.
        for word in _SCOPE_SEPARATORS.split(line.replace("*/", " ").strip()):
            if word in SCOPES:
                granted.add(word)
    return tuple(scope for scope in SCOPES if scope in granted)


# ---------------------------------------------------------------------------
# The ceilings
# ---------------------------------------------------------------------------

#: What a script may spend, and every number of it configurable.
#:
#: Read from settings on each call rather than captured at import, so a
#: deployment that lowers one does not need a restart and a test can lower one
#: with `override_settings`. They are capacities and not boundaries — the
#: distinction `script.concurrency` draws against `script.sandbox`'s flags —
#: so a config file is the right place for them.
#:
#: `messages` is five because Telegram's own limit is about one message per
#: second to one chat: a script that sends six has already been rate-limited by
#: the time the sixth goes out, and the customer reads a burst either way.
_DEFAULTS = {
    "SCRIPT_MAX_COMMANDS": 40,
    "SCRIPT_MAX_MESSAGES": 5,
    "SCRIPT_MAX_REQUESTS": 3,
    "SCRIPT_MAX_REMINDERS": 5,
    "SCRIPT_MAX_STORE_OPS": 20,
    "SCRIPT_MAX_TRANSITIONS": 20,
    "SCRIPT_MAX_ROUNDS": 8,
}


def ceiling(name: str) -> int:
    return int(getattr(settings, name, _DEFAULTS[name]))


def limits() -> dict[str, int]:
    """The four the sandbox itself enforces, in the shape `runtime.mjs` reads."""
    return {
        "commands": ceiling("SCRIPT_MAX_COMMANDS"),
        "messages": ceiling("SCRIPT_MAX_MESSAGES"),
        "requests": ceiling("SCRIPT_MAX_REQUESTS"),
        "reminders": ceiling("SCRIPT_MAX_REMINDERS"),
        "store": ceiling("SCRIPT_MAX_STORE_OPS"),
    }


# ---------------------------------------------------------------------------
# What comes back from one round
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Envelope:
    """One round of a script, as `runtime.mjs` wrote it down."""

    #: The hook's own return value — what becomes variables. `None` when the
    #: round halted, because the hook never reached its `return`.
    value: Any = None
    commands: tuple[dict, ...] = ()
    #: Requests the host has to answer before the script can go on.
    pending: tuple[dict, ...] = ()
    halted: bool = False


def read(value: Any) -> Envelope:
    """The envelope inside a script's answer, or the answer itself.

    A value that is not an envelope is a hook that ran without the runtime
    installed — every test in `test_hooks` that stands in for the sandbox, and
    any caller written before this existed. Read as "no commands, no requests,
    this is the return value", which is exactly what it was.
    """
    if not isinstance(value, dict) or value.get("__oqim") != 1:
        return Envelope(value=value)
    return Envelope(
        value=value.get("value"),
        commands=tuple(item for item in (value.get("commands") or []) if isinstance(item, dict)),
        pending=tuple(item for item in (value.get("pending") or []) if isinstance(item, dict)),
        halted=bool(value.get("halted")),
    )


# ---------------------------------------------------------------------------
# http and store — the two the host answers while the script waits
# ---------------------------------------------------------------------------

#: Where `store` keeps a bot's keys. Prefixed like `script.concurrency`'s slots
#: so a deployment can see what it holds and drop the lot after an incident.
STORE_PREFIX = "oqim:script:store:"

#: What a key may be called. Narrow on purpose: the key is part of a cache key
#: shared with every other tenant on the deployment, and a name carrying a
#: colon or a space is a name that can be made to collide with somebody else's.
STORE_KEY = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")

#: How much JSON one value may be. A store is for a counter and a flag, not for
#: the API response an author forgot to narrow.
STORE_VALUE_BYTES = 4096

#: Headers a script may set, and how many. `Host` and `Cookie` are dropped
#: rather than refused: one of them re-points the request past the address
#: check, and the other is the shape of a credential nobody meant to send.
MAX_HEADERS = 10
FORBIDDEN_HEADERS = {"host", "cookie", "content-length"}


def _store_key(bot_id: str, key: str) -> str:
    return f"{STORE_PREFIX}{bot_id}:{key}"


def perform(effects, *, bot_id: str, studio: Any = None) -> dict[str, dict]:
    """Answers one round's requests, keyed by the position that asked.

    Each answer is `{"ok": True, "value": …}` or `{"ok": False, "error": …}`,
    and the second is not a failure of the run: it becomes a rejected promise
    at the `await` the author wrote, so `try`/`catch` around an HTTP call means
    what it means everywhere else.
    """
    answers: dict[str, dict] = {}
    for effect in effects:
        identifier = str(effect.get("id", ""))
        try:
            if effect.get("kind") == "http":
                answers[identifier] = _http(effect)
            elif effect.get("kind") == "store":
                answers[identifier] = _store(effect, bot_id=bot_id)
            elif effect.get("kind") == "studio":
                answers[identifier] = _studio(effect, studio)
            else:
                answers[identifier] = {"ok": False, "error": "Noma'lum so'rov turi."}
        except Exception:  # noqa: BLE001 - a broken answer is still an answer
            logger.warning("script effect %s failed", effect.get("kind"), exc_info=True)
            answers[identifier] = {"ok": False, "error": "So'rovni bajarib bo'lmadi."}
    return answers


def _studio(effect: dict, studio: Any) -> dict:
    """One `studio.*` call, or the reason it is closed.

    `studio` is the session — who is calling and on which surface — and it is
    handed in rather than built here because only the caller knows: the runtime
    walking a customer's conversation and the Script panel running a file by
    hand reach this same function, and the whole point of the surface is that
    those two are not the same thing.

    **No session means a conversation.** A bot that creates a flow on every
    customer message destroys itself within an hour — the quota fills, the
    graphs tangle, and nobody can say which version is running — so the default
    has to be the closed one, and a caller that forgot to pass a session gets
    the same refusal a live chat does rather than an accidental opening.

    The refusal is `studio.py`'s own sentence, reached through the same gate a
    real session goes through, so there is one place that decides and one form
    of words for it.
    """
    from .studio import Studio, StudioError

    name = str(effect.get("name") or "")
    session = studio if studio is not None else Studio(workspace=None)
    try:
        return {"ok": True, "value": session.call(name, effect.get("payload") or {})}
    except StudioError as refusal:
        # Carried through with its code: a script may branch on «limit to'ldi»
        # differently from «bunday oqim yo'q», and B-09 is what a refusal with
        # nothing to branch on looks like from the outside.
        return {"ok": False, "error": str(refusal.detail), "code": refusal.code}


def _http(effect: dict) -> dict:
    """One outbound request, under the rules `safe_http` already writes down.

    Two things are stricter here than in the «HTTP» block. `https://` only,
    because this URL was typed into code rather than into a field somebody
    reviews, and a plaintext call carrying a bearer token an author pasted is
    the one mistake this can prevent outright. And the timeout is the author's,
    clamped: a script is on a Telegram webhook's clock, and ten seconds is
    already the whole of it.
    """
    url = str(effect.get("url") or "").strip()
    method = str(effect.get("method") or "GET").upper()
    if not url.lower().startswith("https://"):
        return {"ok": False, "error": "Faqat https:// manzillarga so'rov yuborish mumkin."}
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        return {"ok": False, "error": f"«{method}» usuli qo'llab-quvvatlanmaydi."}

    headers = {}
    for name, value in list((effect.get("headers") or {}).items())[:MAX_HEADERS]:
        if not isinstance(name, str) or name.lower() in FORBIDDEN_HEADERS:
            continue
        headers[name[:64]] = str(value)[:512]

    body = effect.get("body")
    timeout = max(500, min(int(effect.get("timeout") or 10000), 10000)) / 1000

    current = url
    # Redirects are followed by hand and only for a GET, each hop re-checked —
    # the same rule and the same reason as `safe_http.safe_get`: `requests`
    # would happily follow a `302` onto the metadata endpoint. A redirected
    # POST is handed back as the 3xx it is, because re-sending a body to an
    # address the author did not name is a request they did not make.
    for _ in range(safe_http.MAX_REDIRECTS + 1):
        try:
            safe_http._check_url(current)
        except safe_http.UnsafeUrlError as exc:
            return {"ok": False, "error": f"HTTP rad etildi: {exc}"}
        try:
            response = requests.request(
                method,
                current,
                headers=headers or None,
                json=body if body is not None and method != "GET" else None,
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException as exc:
            return {"ok": False, "error": f"HTTP xato: {exc}"}
        if method == "GET" and response.is_redirect and response.next is not None:
            current = response.next.url
            response.close()
            continue
        return {"ok": True, "value": _response_value(response)}
    return {"ok": False, "error": "Juda ko'p yo'naltirish"}


def _response_value(response: requests.Response) -> dict:
    """What `await http.get(…)` resolves to.

    `status` and `ok` before `body`, because branching on the answer is what a
    script does with it and reaching for `.body` first is how a 500 becomes an
    empty string the flow then renders at a customer.
    """
    raw = safe_http.read_capped(response)
    try:
        body: Any = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        body = raw.decode("utf-8", "replace")[:2000]
    return {
        "status": response.status_code,
        "ok": 200 <= response.status_code < 300,
        "body": body,
        "headers": {str(name).lower(): str(value)[:512] for name, value in list(response.headers.items())[:30]},
    }


def _store(effect: dict, *, bot_id: str) -> dict:
    """One read of the bot's key/value store.

    **Where this lives, and what that costs.** The Django cache — Redis in
    production, shared by Daphne and every worker — which is what makes
    `incr` genuinely atomic: it is one `INCRBY` and not a read, an addition and
    a write that two workers can interleave. That is the whole reason the
    design names `incr` separately, because a queue number built out of
    `get` and `set` hands two customers the same number the first time two
    messages arrive together.

    What it costs is durability: a cache is evictable, so a counter can go back
    to zero when Redis is restarted without persistence. The honest home for
    this is a table, and it is named in this module's report rather than added
    here — `engine.models` belongs to somebody else this week. The cache is the
    half of the promise that cannot be faked (atomicity); the half it does not
    keep is the one a migration fixes without changing a line of this file.
    """
    key = str(effect.get("key") or "")
    if not STORE_KEY.match(key):
        return {"ok": False, "error": f"«{key}» kalit sifatida yaramaydi — harf, raqam, `_`, `.` va `-`."}
    full = _store_key(bot_id, key)

    if effect.get("op") == "incr":
        by = int(effect.get("by") or 1)
        # `add` first, then `incr`: `cache.incr` raises on a key that is not
        # there, and `add` is the atomic "only if absent" that keeps two
        # workers starting the same counter from each starting it.
        cache.add(full, 0, None)
        try:
            return {"ok": True, "value": cache.incr(full, by)}
        except ValueError:
            # The key expired between the `add` and the `incr`. One retry, and
            # then the number is honestly unavailable rather than invented.
            cache.add(full, 0, None)
            return {"ok": True, "value": cache.incr(full, by)}

    fallback = effect.get("fallback")
    held = cache.get(full)
    return {"ok": True, "value": fallback if held is None else held}


def store_write(*, bot_id: str, key: str, value: Any, ttl: int = 0) -> None:
    """`store.set`, applied after the script finished. Raises on a bad key."""
    if not STORE_KEY.match(str(key or "")):
        raise ValueError(f"«{key}» kalit sifatida yaramaydi.")
    if len(json.dumps(value, default=str)) > STORE_VALUE_BYTES:
        raise ValueError(f"Qiymat juda katta — eng ko'pi {STORE_VALUE_BYTES} bayt.")
    cache.set(_store_key(bot_id, key), value, ttl if ttl and ttl > 0 else None)


def store_remove(*, bot_id: str, key: str) -> None:
    cache.delete(_store_key(bot_id, str(key or "")))


# ---------------------------------------------------------------------------
# Applying a list
# ---------------------------------------------------------------------------

GOTO = "goto"
CALL = "call"
RESTART = "restart"
END = "end"
STOP = "stop"
HANDOFF = "handoff"


@dataclass(frozen=True)
class Directive:
    """Where the conversation goes now that the script has spoken.

    Returned to `runner._fire`'s caller rather than acted on here, which is the
    point: `walk` is a loop over a graph and a hook fires outside it, so the
    caller that is about to choose the next block is the one that reads this.
    Nothing has to reach into the loop and none of the loop has to know a script
    exists.
    """

    op: str = ""
    node_id: str = ""
    flow_id: str = ""


@dataclass
class _Tally:
    """What one list did, for the single step it leaves in the trace."""

    ops: list[str] = field(default_factory=list)
    failures: int = 0


#: Where a run remembers what its scripts have arranged. Reserved names in the
#: shape `runner.SCREEN_MESSAGE_ID` already uses: the context doubles as the
#: `{{...}}` namespace an author writes into, so anything the runtime keeps
#: there has to be un-typeable by accident.
#:
#: **One underscore and not two.** `FlowRun.save` strips every `__` key on its
#: way to the database — that prefix is the scratch `expressions` keeps for the
#: block currently being delivered, and it is meant to die with the block. Both
#: of these have to outlive a run parked for two days: a reminder is delivered
#: from a Celery task hours later, and the jump count is what stops a loop that
#: spans several updates.
JUMPS = "_oqim_jumps"
QUEUE = "_oqim_queue"

#: How a scheduled reminder addresses itself back to this module. It travels as
#: the `node_id` argument of `tasks.send_followup`, which is the one scheduler
#: the runtime has — so a reminder needs no task of its own and no column.
QUEUE_NODE_PREFIX = "__oqim:"


def apply(run, commands, *, hook: str, node: dict | None = None) -> Directive:
    """Does everything the script asked for, and says where the run goes next.

    Order matters in one place and it is the one the caller has already
    arranged: `runner._fire` merges what the hook *returned* into the run's
    variables before it calls this, so `bot.send("{{savat}} ta")` renders what
    the same script just computed. A list applied first would send the
    placeholder.

    Nothing raises out of here. Each command is attempted on its own and a
    failure is one line in the trace — the discipline `runner._fire` already
    holds for a hook that throws, extended to the actions it asks for, because
    the failure modes are the same shape: only the author can fix it and the
    customer is still waiting.
    """
    from . import runner

    anchor = node or {}
    tally = _Tally()
    directive = Directive()
    handoff = False

    for command in commands:
        op = str(command.get("op") or "")
        tally.ops.append(op)
        try:
            if op.startswith("flow."):
                directive = _route(run, command, hook=hook, node=anchor) or directive
            elif op == "team.handoff":
                _handoff(run, command, node=anchor)
                handoff = True
            else:
                _do(run, command, node=anchor)
        except Exception as exc:  # noqa: BLE001 - one bad command must not end the conversation
            tally.failures += 1
            reason = getattr(exc, "message", None) or str(exc)
            logger.warning("flow %s script command %s failed: %s", run.flow_id, op, reason)
            runner._step(
                run,
                anchor,
                "system",
                f"Skript amali bajarilmadi ({op}): {reason}",
                {"error": reason, "kind": "command", "op": op, "hook": hook},
            )
            if getattr(exc, "is_blocked", False):
                # The customer blocked the bot. Nothing further in this list can
                # reach them, and `walk` marks the contact on its own path — so
                # the remaining commands are dropped rather than each earning
                # its own identical refusal.
                break

    if tally.ops:
        runner._step(
            run,
            anchor,
            "system",
            f"Skript: {len(tally.ops)} amal" + (f", {tally.failures} tasi bajarilmadi" if tally.failures else ""),
            {"kind": "commands", "hook": hook, "ops": tally.ops, "failed": tally.failures},
        )

    # A handover outranks a jump. Both can be in one list, and once a person is
    # on their way into the conversation, walking it somewhere else is the one
    # outcome nobody asked for.
    if handoff:
        return Directive(op=HANDOFF)
    return directive


def _route(run, command: dict, *, hook: str, node: dict) -> Directive | None:
    """A `flow.*` command, turned into the one directive a run may carry.

    `runtime.mjs` already refuses a second one inside the script, which is where
    the author reads about it. This is the other end of the same rule and it
    exists for the endings: `onFlowEnd` fires on a run that is already written
    down, so a `flow.goto` there is asking to walk a conversation that is over.
    """
    from . import runner

    if hook == "onFlowEnd":
        runner._step(
            run,
            node,
            "system",
            "Oqim tugagach yo'nalishni o'zgartirib bo'lmaydi",
            {"kind": "command", "op": command.get("op"), "hook": hook},
        )
        return None

    op = str(command.get("op") or "")
    if op in {"flow.goto", "flow.call", "flow.restart"}:
        # One run may only be moved so many times, however many hooks ask. The
        # count is on the run and not on the script, because two hooks each
        # jumping ten times is the same loop as one hook jumping twenty.
        jumps = int(run.context.get(JUMPS) or 0) + 1
        run.context[JUMPS] = jumps
        run.save(update_fields=["context"])
        if jumps > ceiling("SCRIPT_MAX_TRANSITIONS"):
            raise ValueError(
                f"Oqim bo'ylab juda ko'p o'tish — eng ko'pi {ceiling('SCRIPT_MAX_TRANSITIONS')} ta."
            )

    if op == "flow.goto":
        return Directive(op=GOTO, node_id=str(command.get("blockId") or ""))
    if op == "flow.call":
        return Directive(op=CALL, flow_id=str(command.get("flowId") or ""), node_id=str(command.get("blockId") or ""))
    if op == "flow.restart":
        return Directive(op=RESTART)
    if op == "flow.end":
        return Directive(op=END)
    if op == "flow.stop":
        return Directive(op=STOP)
    raise ValueError(f"Noma'lum amal: {op}")


def _handoff(run, command: dict, *, node: dict) -> None:
    """`team.handoff` — the same act «Operatorga» is, minus the parking.

    Parking is the caller's, through `Directive(HANDOFF)`: a hook fires outside
    `walk`, and a run parked from in here would be walked over by the loop that
    started a moment later.
    """
    from apps.analytics.services import record_event
    from apps.notifications.services import notify

    from . import runner

    reason = str(command.get("reason") or "")
    runner._step(run, node, "system", f"Operatorga uzatildi — {reason}" if reason else "Operatorga uzatildi")
    if run.is_test:
        return
    record_event(flow=run.flow, contact=run.contact, metric="handoffs")
    notify(
        workspace=run.workspace,
        kind="handoff",
        title="Operator kerak",
        text=f"{run.contact.display_name if run.contact_id else 'Mijoz'} · {run.flow.name}"
        + (f" · {reason}" if reason else ""),
        href=f"/flows/{run.flow_id}",
        icon="headset",
    )


def _do(run, command: dict, *, node: dict) -> None:
    """Everything that is not a direction and not a handover."""
    op = str(command.get("op") or "")
    handler = _COMMANDS.get(op)
    if handler is None:
        raise ValueError(f"Noma'lum amal: {op}")
    handler(run, command, node)


# ---------------------------------------------------------------------------
# bot.*
# ---------------------------------------------------------------------------


def _node_for(command: dict, node: dict, *, kind: str = "text") -> dict:
    """A block the sender can build a call out of, for a message nobody drew.

    The whole delivery path — the keyboard builder, `{{...}}`, the field
    limits, the business-account rights, the screen the next block may
    replace — is written against a block, and a script's message has to go
    through all of it or it is a second sender with its own bugs. So the
    command becomes a block that was never on a canvas, carrying the id of the
    block the conversation is actually on so the trace still points somewhere.
    """
    buttons = [
        {"id": str(button.get("id") or ""), "label": str(button.get("label") or ""),
         "kind": str(button.get("kind") or "callback"), "url": str(button.get("url") or "")}
        for button in (command.get("buttons") or [])
        if isinstance(button, dict) and str(button.get("label") or "")
    ]
    built = {
        "id": node.get("id", ""),
        "type": "message",
        "contentKind": kind,
        "text": str(command.get("text") or command.get("caption") or ""),
        "buttons": buttons,
    }
    if command.get("buttonMode"):
        built["buttonMode"] = str(command["buttonMode"])
    if command.get("url"):
        built["mediaSource"] = {"value": str(command["url"])}
    return built


def _send(run, command: dict, node: dict) -> None:
    from . import runner
    from .sender import render_text

    kind = str(command.get("kind") or "text") if command.get("op") == "bot.media" else "text"
    built = _node_for(command, node, kind=kind)
    sent = runner._deliver(run, built)
    runner._step(run, built, "bot", render_text(built["text"], run.context), sent)
    if not run.is_test:
        runner._count_message(run)


def _edit(run, command: dict, node: dict) -> None:
    from . import runner
    from .sender import build_call

    message_id = int(command.get("messageId") or 0)
    if message_id <= 0:
        raise ValueError("Tahrirlash uchun xabar raqami kerak.")
    chat_id = runner._chat_id(run)
    if chat_id is None:
        return
    built = _node_for(command, node)
    method, payload = build_call(
        built, chat_id, run.context, run.context.get("business_connection_id", "") or "", "", edit_message_id=message_id
    )
    if run.is_test:
        return
    runner._client(run).call(method, payload)


def _remove(run, command: dict, node: dict) -> None:
    from . import runner
    from .sender import build_delete_call

    message_id = int(command.get("messageId") or 0)
    chat_id = runner._chat_id(run)
    if message_id <= 0 or chat_id is None or run.is_test:
        return
    method, payload = build_delete_call(chat_id, message_id)
    runner._client(run).call(method, payload)


def _typing(run, command: dict, node: dict) -> None:
    """The typing indicator, sent once and not waited on.

    Telegram shows it for five seconds or until the next message arrives, so
    the call is the whole of what can be honoured now. The author's `seconds`
    is clamped and journalled rather than slept through: a webhook is being
    held open behind this, and ten seconds of `sleep` in a worker is ten
    seconds of a conversation nobody else can have.
    """
    from . import runner

    chat_id = runner._chat_id(run)
    if chat_id is None or run.is_test:
        return
    payload = {"chat_id": chat_id, "action": "typing"}
    business = run.context.get("business_connection_id", "") or ""
    if business:
        payload["business_connection_id"] = business
    runner._client(run).call("sendChatAction", payload)


# ---------------------------------------------------------------------------
# user.*
# ---------------------------------------------------------------------------

#: The same rule `hooks.WRITABLE_KEY` applies to what a hook returns: a name
#: `{{...}}` cannot read back is a variable carried on every step of the run
#: for the rest of the conversation and never read by anything.
WRITABLE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


def _set(run, command: dict, node: dict) -> None:
    name = str(command.get("name") or "")
    if not WRITABLE_KEY.match(name):
        raise ValueError(f"«{name}» o'zgaruvchi nomi sifatida yaramaydi.")
    value = command.get("value")
    run.context[name] = value
    run.save(update_fields=["context"])
    if run.contact_id:
        run.contact.set_variable(name, value)


def _tag(run, command: dict, node: dict) -> None:
    from apps.contacts.models import ContactTag

    name = str(command.get("name") or "")
    if not name:
        raise ValueError("Teg nomi ko'rsatilmagan.")
    # A tag is a fact about a person, so it needs one. A test run has nobody
    # attached and says so in the trace rather than failing.
    if run.contact_id:
        ContactTag.objects.get_or_create(contact=run.contact, name=name, defaults={"added_by_flow_id": run.flow_id})


def _untag(run, command: dict, node: dict) -> None:
    from apps.contacts.models import ContactTag

    name = str(command.get("name") or "")
    if run.contact_id and name:
        ContactTag.objects.filter(contact=run.contact, name=name).delete()


def _lang(run, command: dict, node: dict) -> None:
    """The chosen language, written where the rest of the product reads it.

    `mijoz_tili` is an ordinary contact variable (`apps.common.i18n`), and
    `language` is what this run answers in from the next block onwards —
    exactly the pair `runner._store_language` writes, because a script picking
    a language and a «Til tanlash» block picking one have to be the same act.
    """
    from apps.common.i18n import LANGUAGE_VARIABLE, normalise_language

    code = normalise_language(command.get("code"), fallback="")
    if not code:
        raise ValueError(f"Noma'lum til: {command.get('code')}")
    run.context[LANGUAGE_VARIABLE] = code
    run.context["language"] = code
    run.save(update_fields=["context"])
    if run.contact_id:
        run.contact.set_language(code)


# ---------------------------------------------------------------------------
# queue.*
# ---------------------------------------------------------------------------


def _remind(run, command: dict, node: dict) -> None:
    """Arms a reminder that outlives this conversation.

    It rides `tasks.send_followup` — the one scheduler the runtime has — with
    the key encoded into the `node_id` argument, so there is no second task and
    no second table. The text lives on the run, because a script's reminder has
    no block on the canvas to read it off.

    **The same key overwrites the pending one**, and the serial is how. A task
    already in flight cannot be recalled from Celery, so the new reminder bumps
    a serial and the old task, when it fires, finds a serial that is not its own
    and does nothing. Cancelling is the same mechanism with the entry removed.
    """
    from .tasks import send_followup

    key = str(command.get("key") or "") or f"auto{len(run.context.get(QUEUE) or {})}"
    text = str(command.get("text") or "")
    if not text.strip():
        raise ValueError("Eslatma matni bo'sh.")

    when, seconds = _due(command)

    queued = dict(run.context.get(QUEUE) or {})
    serial = int((queued.get(key) or {}).get("serial") or 0) + 1
    queued[key] = {
        "serial": serial,
        "text": text,
        "buttons": command.get("buttons") or [],
        "at": when.isoformat(),
    }
    run.context[QUEUE] = queued
    run.save(update_fields=["context"])

    if run.is_test:
        # Nobody to remind, and showing that it was armed is the whole of what
        # the editor can honestly show — the same answer `_handle_followup`
        # gives.
        return
    try:
        send_followup.apply_async(args=[run.id, f"{QUEUE_NODE_PREFIX}{key}#{serial}", ""], countdown=seconds)
    except Exception as exc:  # noqa: BLE001 - a broker hiccup must not fail the conversation
        raise RuntimeError("Eslatmani rejalashtirib bo'lmadi.") from exc


def _due(command: dict) -> tuple[datetime, int]:
    """When the reminder goes out, and how long from now — from either shape.

    Both, because the two are wanted by two different readers and only one of
    them can be derived without losing something. The countdown is what Celery
    is given, and for `remind` it is the author's own arithmetic exactly:
    `minutes * 60`, the way «Kechiktirilgan eslatma» does it. Subtracting two
    clock readings would have made 30 minutes 1799 seconds, which is right and
    reads in a test like a bug.
    """
    if command.get("op") == "queue.remind":
        minutes = max(0, int(command.get("minutes") or 0))
        return timezone.now() + timedelta(minutes=minutes), minutes * 60
    raw = command.get("at")
    if isinstance(raw, (int, float)):
        # Milliseconds, because that is what `Date.getTime()` hands back and
        # the runtime normalises a Date to it before it leaves the sandbox.
        when = datetime.fromtimestamp(raw / 1000, tz=dt_timezone.utc)
    else:
        parsed = datetime.fromisoformat(str(raw)) if raw else None
        if parsed is None:
            raise ValueError("Eslatma vaqti noto'g'ri.")
        when = parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
    # A time already past is a reminder the author meant to have sent, so it
    # goes now rather than being refused — the same answer `queue.remind(0, …)`
    # gives.
    return when, max(0, int((when - timezone.now()).total_seconds()))


def _cancel(run, command: dict, node: dict) -> None:
    key = str(command.get("key") or "")
    queued = dict(run.context.get(QUEUE) or {})
    if queued.pop(key, None) is not None:
        run.context[QUEUE] = queued
        run.save(update_fields=["context"])


def pending_reminder(run, node_id: str) -> dict | None:
    """The reminder `tasks.send_followup` is asking about, or None.

    None covers both ways a reminder legitimately does not happen: it was
    cancelled, or a newer one with the same key replaced it. Neither is a
    failure and neither is worth a line in the trace.
    """
    if not node_id.startswith(QUEUE_NODE_PREFIX):
        return None
    key, _, serial = node_id[len(QUEUE_NODE_PREFIX) :].partition("#")
    entry = (run.context.get(QUEUE) or {}).get(key)
    if not isinstance(entry, dict) or str(entry.get("serial")) != serial:
        return None
    return entry


# ---------------------------------------------------------------------------
# team.notify and store writes
# ---------------------------------------------------------------------------

#: What a level means to the bell. `urgent` is the one a workspace cannot mute,
#: and it is the reason the parameter exists at all: a script that has found a
#: real problem — a payment that will not clear, a stock count that has gone
#: negative — is not a system notice somebody switched off last month.
_LEVEL_KINDS = {"info": "system", "warning": "system", "urgent": "handoff"}


def _notify(run, command: dict, node: dict) -> None:
    from apps.notifications.services import notify

    text = str(command.get("text") or "")
    if not text.strip():
        raise ValueError("Xabar matni bo'sh.")
    if run.is_test:
        return
    level = str(command.get("level") or "info")
    notify(
        workspace=run.workspace,
        kind=_LEVEL_KINDS.get(level, "system"),
        title=f"{run.flow.name} — skript",
        text=text[:500],
        href=f"/flows/{run.flow_id}",
        icon="terminal",
        force=level == "urgent",
    )


def _store_set(run, command: dict, node: dict) -> None:
    store_write(bot_id=run.bot_id, key=command.get("key"), value=command.get("value"), ttl=int(command.get("ttl") or 0))


def _store_remove(run, command: dict, node: dict) -> None:
    store_remove(bot_id=run.bot_id, key=command.get("key"))


_COMMANDS = {
    "bot.send": _send,
    "bot.media": _send,
    "bot.edit": _edit,
    "bot.remove": _remove,
    "bot.typing": _typing,
    "user.set": _set,
    "user.tag": _tag,
    "user.untag": _untag,
    "user.lang": _lang,
    "queue.remind": _remind,
    "queue.at": _remind,
    "queue.cancel": _cancel,
    "team.notify": _notify,
    "store.set": _store_set,
    "store.remove": _store_remove,
}
