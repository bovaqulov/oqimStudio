"""Calling the bot's own JavaScript from inside a `{{ }}`.

A placeholder has always been a *name*: `{{ism}}` is looked up in the run's
context and nothing else happens. That covers everything a flow can already
remember and nothing it has to work out — a basket total, a delivery window, a
price with a tiered discount. Every one of those ends with an author wanting a
function, and the bot already has somewhere to keep functions: its script
library (`Bot.script_library`), which until now nothing but a test button ever
ran.

So this module is the seam between the two. It reads an author's text, finds
the placeholders that *call* something rather than name something, asks the
sandbox for their values, and hands them back as strings the renderer can drop
in. Three properties matter more than anything else here:

  1. **A name is still a name.** `{{ism}}` never reaches this module — the
     grammar below only claims a placeholder that opens with `identifier(`. A
     flow written before any of this existed renders through exactly the code
     it always did, and the sandbox is not started for it at all.
  2. **An expression cannot break a conversation.** A throw, a timeout, a
     missing function, a machine with no Node on it: all of them come back as
     an empty string. The block's own text is still sent, with a hole where the
     value would have been, because a customer waiting for an answer is not the
     person who can fix the script.
  3. **One call per block, not one per placeholder.** Starting the sandbox
     costs ~90 ms of process launch (measured), and a message with four
     placeholders would otherwise pay it four times before any arithmetic
     happened. Everything on a block is collected, evaluated together, and
     cached on the run's context for the renderers that come after.

What this deliberately is *not*: a second implementation of anything. The
expressions run on the same engine, against the same library text, as the
script the author tests in the panel — because two implementations of one set
of rules is how a green test chat ends up beside a broken bot, which this
repository has already paid for once.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .script import ScriptLimits, compose, run_script

logger = logging.getLogger(__name__)

#: A placeholder that calls something.
#:
#: It has to open with `identifier(` — that is the whole test, and it is chosen
#: so the existing grammar cannot be disturbed. `{{ism}}` has no bracket;
#: `{{ism | default: "a(b)"}}` has one but does not open with a call, so a
#: filter argument that happens to contain a bracket stays a filter argument.
EXPRESSION_PATTERN = re.compile(
    r"\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*\(.*?)\s*\}\}"
)

#: Every `name(` inside an expression. What the save-time check counts as "the
#: functions this flow depends on", so that renaming one in the library shows
#: up as a warning instead of as an empty space in a customer's message.
#:
#: A name reached through a dot is not one of them: `Math.round(x)` calls a
#: method on something JavaScript brings itself, and reporting `round` as a
#: function the library forgot to declare would be noise on every block that
#: rounds a number.
CALL_PATTERN = re.compile(r"(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(")

#: `table("narxlar")` — a table this block reads, named as a literal so the
#: handles can be read out of the source *before* anything runs.
TABLE_CALL_PATTERN = re.compile(
    r"""\btable(?:Text)?\(\s*["']([a-z0-9_]+)["']\s*[,)]"""
)

#: How many rows of one table an expression may be handed.
#:
#: A price list or a service catalogue is tens of rows and this never binds. A
#: queue table is thousands, and handing all of them to a sandbox on every
#: message would be paying for the whole table to answer one question — so it
#: is cut, and the cut is *reported* rather than silent, because a lookup that
#: quietly stops finding rows past a threshold is the worst kind of bug to own.
MAX_TABLE_ROWS = 500

#: A bare name inside an expression: not reached through a dot, and not the
#: thing being called. `cartTotal(savat)` has one — `savat`.
IDENTIFIER_PATTERN = re.compile(r"(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*(?!\s*\()")

#: A context key that can be bound as a bare JavaScript identifier. Telegram's
#: own fields are stored under keys containing a dot (`user.first_name`), which
#: is not a name an expression can write, so those are left out of the binding
#: and reached through the context object instead.
IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")

#: Names that would turn `const <name> = …` into a syntax error and take every
#: expression on the block down with it.
RESERVED = frozenset(
    """
    break case catch class const continue debugger default delete do else enum export
    extends false finally for function if implements import in instanceof interface let
    new null package private protected public return static super switch this throw true
    try typeof var void while with yield await inputs console table tableText
    """.split()
)

#: Where resolved values are kept on the run context, so every renderer that
#: runs after `resolve_into` finds them without asking again. Underscored
#: because it is not a variable an author wrote and must never be offered as
#: one — `_lookup` in `sender` would happily find it otherwise.
CONTEXT_KEY = "__expressions"

#: How many placeholders one block may evaluate. A block with more than this is
#: not a block any more, and the cap keeps one badly generated flow from
#: turning into a long script.
MAX_EXPRESSIONS = 20

#: Wall clock for the whole batch.
#:
#: Not the 200 ms an expression is *meant* to get: that is a CPU budget, and
#: today the ~90 ms of process launch is inside the same stopwatch. Until the
#: sandbox is a resident pool the number has to cover both, so it is sized as
#: "launch, plus room to actually work, plus margin for a loaded box". A script
#: that spins is still killed; it just costs a little more before it is.
TIMEOUT_MS = 600


def sources_in(value: Any) -> list[str]:
    """Every expression written in `value`, in the order they appear.

    `value` is whatever a block stores: a string, a map of translations, a list
    of buttons, a nested settings object. All of them are walked, because an
    expression is as legitimate in a button's label as in the message body and
    the caller should not have to know which fields exist this month.
    """
    found: list[str] = []
    _walk(value, found)
    return found


def _walk(value: Any, found: list[str]) -> None:
    if isinstance(value, str):
        found.extend(match.group(1).strip() for match in EXPRESSION_PATTERN.finditer(value))
    elif isinstance(value, dict):
        for item in value.values():
            _walk(item, found)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _walk(item, found)


def functions_in(value: Any) -> set[str]:
    """The library functions `value` depends on.

    Read out of the expressions rather than out of the whole text, so a bracket
    in an ordinary sentence is not mistaken for a call.
    """
    return {name for source in sources_in(value) for name in CALL_PATTERN.findall(source)}


#: A name the library declares at its top level, in the two shapes an author
#: writes: `function name(...)` and `const name = ...`.
DECLARATION_PATTERN = re.compile(
    r"^[ \t]*(?:async[ \t]+)?function[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)"
    r"|^[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*=",
    re.M,
)

#: What JavaScript brings itself. Reported as missing, these would be noise on
#: every flow that rounds a number.
BUILTINS = frozenset(
    """
    Array Boolean Date Error Intl JSON Map Math Number Object Promise RegExp Set String Symbol
    decodeURI decodeURIComponent encodeURI encodeURIComponent isFinite isNaN parseFloat parseInt
    """.split()
)

#: What *this module* brings — declared by `_driver`, not by the bot's library.
#:
#: The distinction matters twice. A flow calling only these needs no library at
#: all, so a bot that has never opened the script panel can still write
#: `{{ tableText("narxlar") }}`; and neither name may be reported as a function
#: the library forgot to declare.
PROVIDED = frozenset({"table", "tableText"})


def declared_functions(library: str) -> set[str]:
    """The names a script may call, read out of the library's own text.

    A regex and not the engine, because this answers a question asked on every
    autosave and the engine costs a process launch. It reads the two shapes the
    library is written in and nothing cleverer: a name it cannot see is a
    warning the author can dismiss by looking, which is a far better failure
    than a save that takes a second.
    """
    found: set[str] = set()
    for one, two in DECLARATION_PATTERN.findall(library or ""):
        found.add(one or two)
    return found


def missing_functions(nodes: list[dict], library: str) -> list[dict]:
    """Functions this graph calls that the library does not declare.

    The check the whole feature turns on. An expression naming a function that
    is not there does not fail loudly at run time — it renders as an empty
    space in a customer's message, which nobody reports and nobody sees. Asked
    at save time it is the opposite: renaming `money` in the library lights up
    every block that was calling it, before the bot answers anybody.

    One row per block and function, so the editor can name both.
    """
    declared = declared_functions(library) | BUILTINS | PROVIDED
    rows: list[dict] = []
    for node in nodes or []:
        for name in sorted(functions_in(node)):
            if name in declared:
                continue
            rows.append(
                {
                    "nodeId": node.get("id", ""),
                    "function": name,
                    "message": f"«{name}()» funksiyasi bot kutubxonasida yo'q.",
                }
            )
    return rows


def _load_tables(handles: set[str], workspace_id: str | None) -> tuple[dict[str, list[dict]], list[str]]:
    """The rows of the tables these expressions name, and what could not be given.

    Read here and handed in, never fetched from inside the sandbox: the script
    process has no network and no database on purpose — six boundaries in
    `engine.script.sandbox` say so — and opening one for a table lookup would be
    opening it for everything. The host does the I/O, the script does the
    arithmetic.

    Only the tables actually written in the text are loaded, so a workspace with
    forty of them pays for the one this block mentions.
    """
    if not handles or not workspace_id:
        return {}, []

    # Local: the engine is the lower layer and must not import a feature app at
    # module load, or the import graph decides which of the two starts first.
    from apps.tables.models import Table

    problems: list[str] = []
    loaded: dict[str, list[dict]] = {}
    found = {
        table.handle: table
        for table in Table.objects.filter(workspace_id=workspace_id, handle__in=handles)
    }
    for handle in sorted(handles):
        table = found.get(handle)
        if table is None:
            problems.append(f"«{handle}» ma'lumoti topilmadi.")
            loaded[handle] = []
            continue
        rows = list(table.rows.values_list("data", flat=True)[: MAX_TABLE_ROWS + 1])
        if len(rows) > MAX_TABLE_ROWS:
            problems.append(f"«{handle}» ma'lumotidan faqat birinchi {MAX_TABLE_ROWS} qator o'qildi.")
            rows = rows[:MAX_TABLE_ROWS]
        # Same reading as «Ma'lumot o'qish» gives: an id is storage, a name is
        # what goes in a message, and the two paths must not disagree about
        # which one an author gets.
        from apps.tables.services import readable_rows

        loaded[handle] = readable_rows(table, [row if isinstance(row, dict) else {} for row in rows])
    return loaded, problems


def resolve_into(
    context: dict[str, Any],
    node: dict,
    *,
    library: str,
    workspace_id: str | None = None,
) -> list[str]:
    """Works out this block's expressions and files them on the context.

    Returns what went wrong, as sentences — one per expression that failed, for
    the trace. An empty list is the ordinary case, including the very ordinary
    case of a block with no expressions at all, which never starts the sandbox.
    """
    sources = _unique(sources_in(node))
    if not sources:
        return []

    values: dict[str, str] = {}
    problems: list[str] = []

    # An empty library is only a problem for an expression that needs one. The
    # data helpers are declared by the driver below, so a bot whose owner has
    # never opened the script panel can still read a table into a message —
    # which is most of them, and was the whole point of building `table()` in.
    needs_library = {
        name
        for source in sources
        for name in CALL_PATTERN.findall(source)
        if name not in PROVIDED and name not in BUILTINS
    }
    if needs_library and not library.strip():
        problems.append("Bot kutubxonasi bo'sh — ifodadagi funksiyalar topilmadi.")
        context[CONTEXT_KEY] = {source: "" for source in sources}
        return problems

    if len(sources) > MAX_EXPRESSIONS:
        problems.append(
            f"Blokda {len(sources)} ta ifoda bor — {MAX_EXPRESSIONS} tadan ko'pi hisoblanmaydi."
        )
        sources = sources[:MAX_EXPRESSIONS]

    # The same joining a Kod block gets: the bot's library above, the body
    # below, one newline between them. Written through `compose` rather than
    # with a `+` so that a library ending in a `//` comment cannot swallow the
    # first line of the driver — which is the whole reason that module exists.
    handles = {handle for source in sources for handle in TABLE_CALL_PATTERN.findall(source)}
    tables, table_problems = _load_tables(handles, workspace_id)
    problems.extend(table_problems)

    body = compose(library, _driver(sources, _names_to_bind(sources, context, library))).source
    result = run_script(
        body,
        {"vars": _bindable_values(context), "tables": tables},
        limits=ScriptLimits(timeout_ms=TIMEOUT_MS),
        workspace_id=workspace_id,
    )

    if not result.ok:
        # The whole batch failed: a syntax error in the library, a timeout, no
        # Node on the machine. Every placeholder empties, the block still sends.
        problems.append(f"Ifodalar hisoblanmadi: {result.error}")
        context[CONTEXT_KEY] = {source: "" for source in sources}
        return problems

    answers = result.value if isinstance(result.value, list) else []
    for index, source in enumerate(sources):
        answer = answers[index] if index < len(answers) else None
        if isinstance(answer, dict) and "__err" in answer:
            problems.append(f"«{source}» xato berdi: {answer['__err']}")
            values[source] = ""
        else:
            values[source] = _stringify(answer)

    context[CONTEXT_KEY] = values
    return problems


def substitute(text: str, context: dict[str, Any], *, escape=None) -> str:
    """Replaces expression placeholders with what `resolve_into` worked out.

    An expression nobody resolved — a caller that renders text without walking
    a block first, a value that arrived after the batch ran — becomes an empty
    string rather than staying on screen as source code. That is the one place
    this differs from a plain name, which stays visible so its author can find
    it: `{{ money(total) }}` left in a customer's message is not a hint, it is
    a leak of how the bot is built.
    """
    values = context.get(CONTEXT_KEY) or {}

    def replace(match: re.Match[str]) -> str:
        rendered = values.get(match.group(1).strip(), "")
        return escape(rendered) if escape and rendered else rendered

    return EXPRESSION_PATTERN.sub(replace, text)


def _unique(sources: list[str]) -> list[str]:
    """The same expression written twice is one call, and keeps its order."""
    seen: dict[str, None] = {}
    for source in sources:
        seen.setdefault(source, None)
    return list(seen)


def _names_to_bind(sources: list[str], context: dict[str, Any], library: str) -> list[str]:
    """Every bare name an expression mentions, whether the run has it or not.

    The second half is the important one. A conversation starts with an empty
    context — nobody has answered anything yet — so `{{ money(cartTotal(savat)) }}`
    on the first block would meet an undeclared `savat` and die of a
    ReferenceError, and every expression written against a variable the flow
    collects later would fail until the customer had already answered. Declared
    from the context and reading `undefined` when it is not there, the same
    expression hands `undefined` to the library, which answers 0 — which is
    exactly what the library's own contract promises for input it does not
    like.

    Names the library declares are left out: binding one would shadow the
    function with `undefined` and break the very call being made.
    """
    mentioned = {name for source in sources for name in IDENTIFIER_PATTERN.findall(source)}
    known = declared_functions(library) | BUILTINS | RESERVED | PROVIDED
    return sorted(
        {name for name in _bindable(context)}
        | {name for name in mentioned if IDENTIFIER.match(name) and name not in known}
    )


def _bindable(context: dict[str, Any]) -> list[str]:
    return [
        name
        for name in context
        if IDENTIFIER.match(name) and name not in RESERVED and not name.startswith("__")
    ]


def _bindable_values(context: dict[str, Any]) -> dict[str, Any]:
    """The context, cut down to what will survive the trip as JSON.

    A value the sandbox cannot be handed is dropped rather than raising: the
    context carries model instances and datetimes on some runs, and one of them
    must not cost the author every expression on the block.
    """
    out: dict[str, Any] = {}
    for name in _bindable(context):
        value = context[name]
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            continue
        out[name] = value
    return out


def _driver(sources: list[str], names: list[str]) -> str:
    """The body handed to the sandbox: bind the variables, answer the list.

    Each expression is wrapped in its own `try`, so one that throws costs its
    own placeholder and not the four beside it. The failure comes back as an
    object rather than as a thrown error for the same reason — a batch that
    raised would lose the answers already computed.
    """
    lines = [
        "const __v = inputs.vars;",
        # The table reader, declared here rather than expected from the bot's
        # library: an author writes `table("narxlar")` and the rows are already
        # beside them. A handle nobody loaded answers an empty list, so a typo
        # costs an empty space and not a thrown error — the shape every other
        # failure in this module takes.
        "const __t = inputs.tables || {};",
        'function table(handle) { return __t[handle] || []; }',
        # The rows as something a message can carry.
        #
        # Telegram has no table: a column layout survives exactly until somebody
        # opens the chat on a phone, where a proportional font and a 320px
        # screen turn aligned columns into ragged noise. A bulleted line per row
        # is what actually reads there, and it is what this returns — the point
        # is that an author writing «Narxlarimiz:\n{{ tableText("narxlar") }}»
        # gets a list without first learning `map` and `join`.
        "function tableText(handle, options) {",
        "  const opts = options || {};",
        "  const rows = table(handle);",
        "  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : rows.length;",
        "  const sep = opts.separator === undefined ? ' — ' : String(opts.separator);",
        "  const bullet = opts.bullet === undefined ? '• ' : String(opts.bullet);",
        "  const keys = Array.isArray(opts.columns) && opts.columns.length ? opts.columns : null;",
        "  return rows.slice(0, limit).map((row) => {",
        "    const cells = (keys || Object.keys(row || {}))",
        "      .map((key) => (row || {})[key])",
        "      .filter((cell) => cell !== null && cell !== undefined && String(cell) !== '');",
        "    return bullet + cells.join(sep);",
        "  }).join('\\n');",
        "}",
    ]
    lines += [f"const {name} = __v[{json.dumps(name)}];" for name in names]
    lines.append("return [")
    for source in sources:
        lines.append(
            "  (() => { try { return ("
            + source
            + "); } catch (e) { return { __err: String((e && e.message) || e) }; } })(),"
        )
    lines.append("];")
    return "\n".join(lines)


def _stringify(value: Any) -> str:
    """What a value looks like once it is inside a sentence.

    `null` and `undefined` are an empty string and not the words "null" and
    "undefined": a function that found nothing should leave a gap, which is
    what the library's own contract promises ("noto'g'ri kirishga bo'sh satr,
    0 yoki bo'sh ro'yxat qaytaradi").
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        # 12500.0 is a price, not a float that has to show its decimal point.
        return str(int(value)) if float(value).is_integer() else str(value)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)
