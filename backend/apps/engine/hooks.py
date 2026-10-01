"""Oqim skripti — the flow's own JavaScript, and the moments it runs at.

A bot's library (`Bot.script_library`) is a set of pure helpers shared by every
flow it owns; this is the other half. `Flow.script` belongs to one conversation
and holds *hooks* — functions with reserved names that the runtime calls at
named moments, hands a `ctx` describing where the conversation is, and whose
answer is written back into the run's variables exactly as a "Ma'lumotni
saqlash" block would write them.

**Only three hooks exist, and the reason is arithmetic.** A sandbox call is a
Node process launch: ~117 ms measured on this machine, ~90 ms of it before a
single line of the author's code runs. The three below fire at most once per
Telegram webhook, so a flow that uses all of them spends a third of a second in
the worst case. `onEnter` and `onLeave` — which the design also names — fire
once *per block*, so a five-block flow would pay that launch five times inside
the few seconds Telegram gives a webhook. They are absent rather than slow, and
they stay absent until a resident process pool makes a call cost microseconds.
`HOOKS` is what the Script panel lists, so the editor can only offer what the
runtime actually calls — which is the failure this repository keeps paying for
in other places.

Nothing here starts a process speculatively. `declared_hooks` is a regex over
the file — the same one `expressions.declared_functions` uses, so there is one
answer to "what does this file declare" and not two — and a flow whose script
is empty, or which declares none of these names, never reaches the sandbox at
all.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from django.utils import timezone

from . import commands, expressions
from .script import FLOW, LIBRARY, ScriptLimits, ScriptOrigin, compose, locate, run_script

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Hook:
    """One reserved name, and the sentence the panel prints under it."""

    name: str
    when: str


#: The vocabulary. Ordered as a conversation runs, because that is the order the
#: panel lists them in and the order an author reads them in.
HOOKS: tuple[Hook, ...] = (
    Hook("onFlowStart", "Oqim boshlanganda — birinchi blokdan oldin"),
    Hook("onUserMessage", "Mijoz javob yozganda — javob blokka yetkazilishidan oldin"),
    Hook("onFlowEnd", "Oqim tugaganda — oxirgi blokdan keyin"),
)

HOOK_NAMES: tuple[str, ...] = tuple(hook.name for hook in HOOKS)

#: How long one hook gets. The block budget, and for the same reason: somebody
#: is waiting in a chat and Telegram is holding a webhook open behind them.
LIMITS = ScriptLimits(timeout_ms=2000)

#: What a returned key has to look like to become a variable.
#:
#: The same shape `{{...}}` can read back. A hook returning `{"a-b": 1}` is not
#: refused loudly — it is one key of an object nobody typed carefully — but
#: writing it would put a name into the context that no placeholder can ever
#: name again.
WRITABLE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")

#: How many keys one hook may write. A hook that returns a whole API response
#: by accident should not quietly become five hundred variables carried on
#: every step of the run for the rest of the conversation.
MAX_WRITES = 40


@dataclass(frozen=True)
class HookOutcome:
    """What one hook answered, in the shape the runtime acts on."""

    ok: bool
    #: Keys to merge into the run's context. Empty when the hook returned
    #: nothing, which is the ordinary case for a hook that only logs.
    written: dict[str, Any] = field(default_factory=dict)
    #: What the script asked the runtime to *do*, in the order it asked. Only
    #: ever populated on a successful run — a script that threw asked for
    #: nothing, which is the whole of `engine.commands`' promise.
    commands: tuple[dict, ...] = ()
    logs: tuple[str, ...] = ()
    #: Already a sentence, in the author's language, ending with where it was.
    error: str = ""
    #: 1-based, counted in whichever file `where` names.
    line: int | None = None
    #: `script.LIBRARY` or `script.FLOW` — which editor to open.
    where: str = ""


def declared_hooks(script: str) -> list[str]:
    """Which of `HOOKS` this file declares, in the order `HOOKS` lists them.

    A regex, not the engine: this is asked on every run of every flow that has
    a script, and the answer only decides whether to start a process. Reading
    it wrong in the cautious direction costs one launch that returns nothing;
    reading it wrong the other way is impossible, because a name the regex
    cannot see is a hook that does not fire and the panel says so.
    """
    declared = expressions.declared_functions(script)
    return [name for name in HOOK_NAMES if name in declared]


def call(
    hook: str,
    *,
    script: str,
    library: str = "",
    ctx: dict[str, Any] | None = None,
    workspace_id: str | None = None,
    bot_id: str = "",
    studio: Any = None,
) -> HookOutcome | None:
    """Runs one hook. `None` — and no process — when the file does not declare it.

    The distinction between `None` and a failed `HookOutcome` is the whole
    contract: a flow with no `onFlowEnd` is not a flow whose `onFlowEnd`
    failed, and only the first of those is silent.

    **A hook can now run more than once for one call**, and that is not a bug
    to be tidied away later — it is how `http` and `store` are answered without
    opening a hole in the sandbox. A script that awaits something the host has
    to fetch comes back *halted*: nothing done, nothing sent, and a list of what
    it wanted. This performs those, writes them into a ledger keyed by the
    position of the call in the run, and runs the same source again — where the
    same `await` resolves out of the ledger rather than asking a second time.
    See `commands` for why replaying an unfinished script is free of
    consequences, and why `store.incr` is the one call that must not be
    replayed and therefore never is.

    `bot_id` is whose key/value store `store.*` reads. Its absence is a caller
    with no bot — the editor's «Tekshirish» button, a test — and the store then
    answers out of a namespace of its own rather than refusing, because a
    script being tried out should behave the way it will behave.
    """
    if hook not in HOOK_NAMES:
        raise ValueError(f"unknown hook: {hook}")
    if hook not in declared_hooks(script):
        return None

    body = _normalise(script)
    # Appended, never prepended: every line of the author's file has to keep the
    # number their editor shows beside it, and a driver on top would shift all
    # of them by one.
    #
    # The vocabulary goes *above* the library instead, where it shifts only
    # lines this module already knows how to shift back (`_origin`). It cannot
    # go below, because the composed body is a function body and half of what
    # `runtime.mjs` declares is `const` — hoisting would leave it in the
    # temporal dead zone at the moment the driver calls it.
    composed = compose(f"{RUNTIME_BLOCK}\n{library}", f"{body}\n{_driver(hook)}", FLOW)
    author_lines = body.count("\n") + 1 if body else 0

    config: dict[str, Any] = {
        "scopes": list(commands.declared_scopes(script)),
        "limits": commands.limits(),
        # The ledger. Empty on the first round and only ever added to: an
        # answer, once written, is what every later round replays.
        "answers": {},
        "round": 0,
    }

    for round_number in range(max(1, commands.ceiling("SCRIPT_MAX_ROUNDS"))):
        config["round"] = round_number
        result = run_script(
            composed.source,
            {"ctx": ctx or {}, "__oqim": config},
            limits=LIMITS,
            workspace_id=workspace_id,
        )

        if not result.ok:
            return _failed(hook, result, composed, author_lines)

        envelope = commands.read(result.value)
        if not envelope.halted:
            return HookOutcome(
                ok=True,
                written=writable(envelope.value),
                logs=result.logs,
                commands=envelope.commands,
            )
        # Only the last round's logs are kept, and that is the honest set: every
        # round re-runs the same `console.log` lines, so accumulating them would
        # show the author their own output three times over.
        config["answers"].update(commands.perform(envelope.pending, bot_id=bot_id, studio=studio))

    rounds = max(1, commands.ceiling("SCRIPT_MAX_ROUNDS"))
    return HookOutcome(
        ok=False,
        error=f"{hook}() tashqi javoblarni juda ko'p marta kutdi — eng ko'pi {rounds} bosqich.",
    )


def _failed(hook: str, result, composed, author_lines: int) -> HookOutcome:
    """One fault, pointed at a line the author can actually look at."""
    origin = _origin(composed, result.line, author_lines)
    where = origin.where if origin else ""
    at = f", {origin.label}da {origin.line}-qator" if origin else ""
    return HookOutcome(
        ok=False,
        logs=result.logs,
        error=f"{hook}() xato berdi: {result.error}{at}",
        line=origin.line if origin else None,
        where=where,
    )


def _origin(composed, line: int | None, author_lines: int) -> ScriptOrigin | None:
    """`compose.locate`, corrected for the vocabulary sitting above the library.

    Two ranges of the composed body belong to nobody the author can open: the
    `runtime.mjs` block at the top and the driver line at the bottom. A number
    landing in either is dropped rather than translated — pointing at line 12
    of an eleven-line file is worse than pointing at nothing — and everything
    between them is the library and the flow script, shifted by exactly the
    height of the block on top.
    """
    origin = locate(composed, line)
    if origin is None:
        return None
    if origin.where == LIBRARY:
        if origin.line <= RUNTIME_LINES:
            return None
        return ScriptOrigin(LIBRARY, origin.line - RUNTIME_LINES)
    # A line inside the driver is a line the author cannot see. It happens for
    # the one fault the driver itself can raise — the name resolving to
    # something that is not callable.
    if origin.where == FLOW and origin.line > author_lines:
        return None
    return origin


def writable(value: Any) -> dict[str, Any]:
    """The part of a hook's answer that may become variables.

    Anything that is not an object is dropped without complaint. `return 42`
    from a hook is not an error — there is simply nothing in it to write, and
    the alternative would be inventing a name for it, which is what the Kod
    block's own `variable` field exists to let an author choose.
    """
    if not isinstance(value, dict):
        return {}
    written: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not WRITABLE_KEY.match(key):
            continue
        written[key] = item
        if len(written) >= MAX_WRITES:
            break
    return written


def context_for(run, *, node: dict | None = None, message: str = "", command: str = "") -> dict[str, Any]:
    """`ctx` — where this conversation is, as a hook sees it.

    Built from what the run already carries rather than re-queried: everything
    below is a field of the run, its flow, its bot or its contact, all of which
    are in memory by the time a hook fires. A `ctx` that cost a query per hook
    would be a query per webhook on flows that have no script at all, because
    the cheap way to write this is to build it before asking whether anybody
    wants it.

    Names are camelCase — this is JavaScript the author writes, and `ctx.first_name`
    beside `ctx.now` would be two conventions in one object. The dotted keys the
    runtime stores variables under (`user.first_name`, and the rest of
    `runner._initial_context`) are handed over whole as `ctx.vars`, unchanged,
    because that is the name every `{{...}}` in the same flow already uses.
    """
    flow = run.flow
    bot = flow.bot
    contact = run.contact
    context = run.context if isinstance(run.context, dict) else {}

    ctx: dict[str, Any] = {
        "module": flow.module_key,
        # "test" is the studio's own chat, "live" is a real customer. A hook
        # that charges a card wants to know which one it is in.
        "mode": "test" if run.is_test else "live",
        "bot": {
            "id": bot.telegram_id or "",
            "username": bot.username or "",
            "name": bot.handle,
        },
        "flow": {"id": flow.id, "name": flow.name},
        "now": timezone.now().isoformat(),
        "locale": context.get("language") or bot.main_language,
        "vars": {key: value for key, value in context.items() if not key.startswith("__")},
    }

    if contact is not None:
        ctx["user"] = {
            "id": contact.telegram_user_id,
            "firstName": contact.first_name,
            "lastName": contact.last_name,
            "username": contact.username,
            "phone": contact.phone,
        }
    ctx["chat"] = {
        "id": context.get("chat.id") or context.get("chat_id"),
        "type": context.get("chat.type", ""),
        "title": context.get("chat.title", ""),
    }
    if node is not None:
        ctx["block"] = {"id": node.get("id", ""), "type": node.get("type", ""), "title": node.get("title", "")}
    # Only on the hook that has one. An empty `ctx.message` on `onFlowStart`
    # would read as "the customer sent nothing", which is a different fact from
    # "nothing was sent to this hook".
    if message or command:
        ctx["message"] = {"text": message, "command": command}
    return ctx


def _driver(hook: str) -> str:
    """The one line that calls the hook, appended under the author's file.

    It goes through `globalThis.__oqim.run` rather than calling the hook
    directly, because what the runtime needs back is not the hook's return
    value alone: it is that value, plus the command list the script built, plus
    whatever it stopped waiting for. The hook is handed over as a closure so
    that a script declaring `async function onFlowStart` and one declaring a
    plain function are the same call from here.
    """
    return f"return await globalThis.__oqim.run(inputs.__oqim, () => {hook}(inputs.ctx));"


#: `script/runtime.mjs`, as text, wrapped so it can be poured into a function body.
#:
#: **Why the file is inlined rather than imported.** The plan is one line in
#: `host.mjs` — `import "./runtime.mjs";` — and Node's permission model refuses
#: it: with `--permission` and no `--allow-fs-read`, the entry point is loaded
#: and *every* file it imports is `ERR_ACCESS_DENIED`. Measured on Node 25.2,
#: which is what this machine runs. Granting `--allow-fs-read=<this file>`
#: would fix it and is a change to `script.sandbox`'s flags, which are
#: deliberately not something another module reaches into.
#:
#: So the same text is folded into the composed body instead, and the file
#: stays a module: it declares only functions and constants and ends by
#: assigning `globalThis.__oqim`, which is the single line both routes arrive
#: at. The day the host carries the import, `RUNTIME_BLOCK` becomes `""` and
#: nothing else here changes.
#:
#: The wrapper is an IIFE and not a bare paste, for a reason that is not
#: cosmetic: the composed body is one scope shared with the bot's library and
#: the author's own file, and a library declaring `function text(...)` — which
#: `runtime.mjs` also declares — would make the whole body a syntax error the
#: author cannot see the cause of. Inside the IIFE only `globalThis.__oqim`
#: escapes.
def _runtime_block() -> str:
    source = (Path(__file__).parent / "script" / "runtime.mjs").read_text(encoding="utf-8")
    return "(function () {\n" + source.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n") + "\n})();"


RUNTIME_BLOCK = _runtime_block()

#: How far the block above pushes everything under it down. Read once, because
#: it is arithmetic on a constant and `_origin` is on the failing path of every
#: hook.
RUNTIME_LINES = RUNTIME_BLOCK.count("\n") + 1


def _normalise(text: str) -> str:
    """`compose._normalise`, for the count this module does before composing."""
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
