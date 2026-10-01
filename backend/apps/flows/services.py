"""Turning a saved graph into something the runtime can match against.

The editor speaks in blocks; the dispatcher needs rows it can query by bot,
module and kind in one round trip. `reindex_triggers` is the translation, and
it runs on every save so the two can never drift: the index is derived, never
authored.

The priority ladder is the same one the editor draws in its handler list (see
`frontend/src/features/flow-builder/lib/trigger.ts`) — if the two disagreed,
the order the author sees would not be the order the bot runs.
"""

from __future__ import annotations

from django.db import transaction

from apps.common.exceptions import ApiError

from .models import (
    ENTRY_NODE_TYPES,
    PRIORITY_CATCH_ALL,
    PRIORITY_EXACT,
    PRIORITY_PARTIAL,
    Flow,
    FlowTrigger,
)

#: Content-type kinds. They narrow a message rather than owning an update of
#: their own, which is why they rank below an explicit command.
MEDIA_KINDS = {"photo", "document", "audio", "voice", "video", "location", "contact"}

#: dms kinds that map straight onto a trigger row of the same name.
DIRECT_KINDS = {"start", "command", "keyword", "any", "callback", "reaction", "payment", "webapp", "blocked", "unblocked"}

#: Group and channel entry blocks: the block type *is* the event.
EVENT_NODE_KINDS = {"groupjoin", "groupleave", "joinrequest", "channelpost"}


def _keyword_priority(match: str) -> int:
    return PRIORITY_EXACT if match == "exact" else PRIORITY_PARTIAL


def _dms_kind_priority(kind: str, match: str, command: str = "") -> int:
    if kind == "any":
        return PRIORITY_CATCH_ALL
    if kind == "keyword":
        return _keyword_priority(match)
    # A «Buyruqlar» handler with no command written in it is not an exact match
    # — `matching.matches` reads an empty `command` as "any command at all", the
    # same way an empty `media_kinds` means any media. Left at PRIORITY_EXACT it
    # sorted *above* every handler that names a real command, so one unfinished
    # block quietly took `/narx`, `/menyu` and everything else in the bot. It is
    # what it behaves like: a catch-all.
    if kind == "command" and not command:
        return PRIORITY_CATCH_ALL
    return PRIORITY_PARTIAL if kind in MEDIA_KINDS else PRIORITY_EXACT


def _business_priority(business: dict) -> int:
    """A business handler's level, plus the one rule that orders a real inbox.

    A working-hours window moves the block one level closer to the front,
    because a handler that only claims part of the day is strictly more
    specific than the same one without a window. That is what makes an
    after-hours autoreply beat the plain catch-all without anyone setting a
    number by hand.
    """
    match = business.get("match") or "any"
    if match == "command":
        # Same rule as the dms side: an unwritten command claims every command.
        base = PRIORITY_EXACT if (business.get("command") or "").lstrip("/") else PRIORITY_CATCH_ALL
    elif match == "keyword":
        base = _keyword_priority(business.get("keywordMatch") or "contains")
    elif match == "media":
        base = PRIORITY_PARTIAL
    else:
        base = PRIORITY_CATCH_ALL

    schedule = business.get("schedule") or {}
    scheduled = schedule.get("mode") in {"inside", "outside"}
    return max(PRIORITY_EXACT, base - 1) if scheduled else base


#: How long a script may be — the flow's own file, and equally whatever is sent
#: to `script/run` to be tried out.
#:
#: One number, and it used to be two: 40 000 stored, 20 000 accepted for a run.
#: A flow script between them saved cleanly and then refused to run — the author
#: pressed «Ishga tushirish» on a file this product had accepted a second
#: earlier and was told it was too long, about the only copy of it there is. A
#: ceiling on what may be stored has to be a ceiling on what may be run, or
#: storing is the trap. The Kod block panel sends its block through the same
#: endpoint and is bounded by the same number; nothing bounds a *block's* source
#: on the way into the graph, so this is the only ceiling it meets at all.
#:
#: The same order as the bot library's ceiling and for the same reason: this is
#: a caller-controlled blob that travels with every read of the flow, and a
#: limit stated here is one an author meets while writing rather than one the
#: database meets at 3am.
#:
#: Here rather than beside the endpoint it is checked in, because two endpoints
#: check it — see `refuse_broken_script`.
SCRIPT_LIMIT = 40_000


def refuse_broken_script(script: str | None) -> str:
    """One imported flow's script, or a refusal. Returns what may be stored.

    Two endpoints import a flow — the panel's `/api/flows/import/` and the
    public API's `/api/v1/flows/import/` — and they share a serializer, which
    is exactly how this went wrong once already: the public one accepted a
    `script` key the moment the serializer grew it and then dropped it on the
    floor, storing a flow without the code that was uploaded with it and saying
    nothing. A rule written at one of two call sites is a rule the other one
    does not have.

    **A file that does not compile refuses the whole import**, in the same
    words a save is refused in, so an author who has met the message once knows
    what it is. Both alternatives are worse. Storing it anyway is the five-day
    failure this feature was built after: a file that does not compile means
    every hook in it silently never runs. Landing the flow *without* its code
    and saying so in the 201 is the failure an import is most likely to hide —
    nothing between an import and the new canvas renders a warning, so the
    author arrives at a flow missing half of what they uploaded and is told
    nowhere.

    Not the `graph_invalid` shape either, though that is the precedent sitting
    beside both call sites. That refusal carries a list because a graph produces
    one finding per block and there is no canvas to go and look at; a script
    produces exactly one sentence with the line number already in it, and a list
    of one is a report pretending to be one.

    Costs a Node process (~117 ms) and only when there is something to compile,
    so call it last — after the graph, the bot and the plan have had their say.
    """
    source = script or ""
    if len(source) > SCRIPT_LIMIT:
        raise ApiError(
            "script_too_long",
            f"Skript juda uzun — {SCRIPT_LIMIT} belgidan oshmasin",
            field="script",
        )
    if not source:
        return ""

    # Imported here rather than at module scope: `engine.script` reaches the
    # sandbox, and this module is imported by everything that touches a flow.
    from apps.engine.script import check_syntax

    broken = check_syntax(source)
    if broken:
        raise ApiError("script_syntax_error", f"Kodda xato: {broken}", field="script")
    return source


def derive_triggers(flow: Flow) -> list[FlowTrigger]:
    """Reads every entry block in the graph as one or more matching rules."""
    rows: list[FlowTrigger] = []

    for order, node in enumerate(flow.nodes):
        node_type = node.get("type")
        if node_type not in ENTRY_NODE_TYPES:
            continue

        common = {
            "flow": flow,
            "bot_id": flow.bot_id,
            "module_key": flow.module_key,
            "node_id": node.get("id", ""),
            "order": order,
        }
        # The author's override wins over everything derived below — that is
        # what the number on the card is for.
        override = node.get("priority")

        if node_type in EVENT_NODE_KINDS:
            rows.append(
                FlowTrigger(**common, kind=node_type, priority=override or PRIORITY_EXACT)
            )
            continue

        if node_type == "start":
            rows.append(FlowTrigger(**common, kind=FlowTrigger.Kind.START, priority=override or PRIORITY_EXACT))
            continue

        business = node.get("business")
        if business:
            match = business.get("match") or "any"
            kind = {
                "command": FlowTrigger.Kind.COMMAND,
                "keyword": FlowTrigger.Kind.KEYWORD,
                "media": FlowTrigger.Kind.MEDIA,
            }.get(match, FlowTrigger.Kind.ANY)
            rows.append(
                FlowTrigger(
                    **common,
                    kind=kind,
                    command=(business.get("command") or "").lstrip("/"),
                    keywords=business.get("keywords") or "",
                    keyword_match=business.get("keywordMatch") or "contains",
                    keyword_flags=business.get("keywordFlags") or "",
                    media_kinds=business.get("mediaKinds") or [],
                    schedule=business.get("schedule") or {},
                    priority=override or _business_priority(business),
                )
            )
            continue

        dms = node.get("dmsTrigger") or {}
        kinds = dms.get("kinds") or ["any"]
        match = dms.get("keywordMatch") or "contains"
        media = sorted(kind for kind in kinds if kind in MEDIA_KINDS)
        if media:
            rows.append(
                FlowTrigger(
                    **common,
                    kind=FlowTrigger.Kind.MEDIA,
                    media_kinds=media,
                    priority=override or PRIORITY_PARTIAL,
                )
            )
        for kind in kinds:
            if kind not in DIRECT_KINDS:
                continue
            rows.append(
                FlowTrigger(
                    **common,
                    kind=kind,
                    command=(dms.get("command") or "").lstrip("/"),
                    keywords=dms.get("keywords") or "",
                    keyword_match=match,
                    keyword_flags=dms.get("keywordFlags") or "",
                    priority=override or _dms_kind_priority(kind, match, (dms.get("command") or "").lstrip("/")),
                )
            )

    return rows


@transaction.atomic
def reindex_triggers(flow: Flow) -> int:
    """Replaces this flow's index with what its graph currently says."""
    flow.triggers.all().delete()
    rows = derive_triggers(flow)
    FlowTrigger.objects.bulk_create(rows)
    return len(rows)


def starter_graph() -> tuple[list[dict], list[dict]]:
    """The graph a `dms` main flow is born with when nobody supplies one.

    Deliberately the same two blocks the interface builds, down to the ids and
    the coordinates (see `frontend/src/features/flows/data/starter-graph.ts`):
    the `start` block and a greeting. A bot's first contact is a hello, and a
    flow that opens on an empty canvas is the moment a non-technical owner
    closes the tab.

    It used to be a four-question intake — name, phone, thank you. That
    answered a question nobody had asked yet, and «Savol» has since been
    removed from the palette entirely.

    The interface hands its own copy over when it asks for the entry point, so
    this runs for the callers that have none: the seed, a script, a bot
    connected outside the app.
    """
    # Left to right, 384px apart, matching `starter-graph.ts` exactly — an exit
    # leaves a card's right edge, so a column laid downwards would have every
    # edge in a brand-new flow bulge out one block's right and double back into
    # the left of the one below it.
    base = {"channel": "tg", "scopes": ["private"], "y": 40}
    nodes = [
        {**base, "id": "n1", "type": "start", "x": 300, "title": "start", "text": ""},
        {**base, "id": "n2", "type": "message", "x": 684, "title": "Xush kelibsiz",
         "text": "Assalomu alaykum! 👋\nSizga yordam berish uchun shu yerdaman — savolingizni yozing.",
         "buttons": []},
    ]
    edges = [
        {"id": f"e{index + 1}", "from": node["id"], "port": "out", "to": nodes[index + 1]["id"]}
        for index, node in enumerate(nodes[:-1])
    ]
    return nodes, edges


def ensure_main_flow(*, workspace, project, bot, graph: tuple[list, list] | None = None) -> Flow:
    """The `dms` module's entry point: one per bot, created with the module.

    `graph` lets the caller hand over the blocks it wants the entry point built
    from — the editor owns the block schema, so when the interface asks for the
    main flow it sends its own intake template rather than letting two starter
    graphs drift apart. `starter_graph()` is the fallback for callers that have
    none (the seed, a script).
    """
    existing = Flow.objects.filter(bot=bot, is_main=True).first()
    if existing:
        return existing

    nodes, edges = graph if graph and graph[0] else starter_graph()
    flow = Flow.objects.create(
        workspace=workspace,
        project=project,
        bot=bot,
        module_key="dms",
        name="Asosiy oqim",
        description="/start buyrug'iga javob beradigan asosiy oqim",
        status="Faol",
        status_tone="success",
        enabled=True,
        is_main=True,
        nodes=nodes,
        edges=edges,
        origin={"kind": "blank", "label": "Bo'lim bilan yaratilgan"},
    )
    reindex_triggers(flow)
    return flow
