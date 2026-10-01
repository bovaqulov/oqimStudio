"""`studio` — the host side of the library that manages flows, and creates them.

`apps/engine/script/studio.mjs` is what an author calls; this is what answers.
One command name per method, spelled identically on both sides, so wiring the
sandbox bridge is a table lookup with nothing to translate.

## The rule that comes before the API

A bot that creates a flow on every customer message destroys itself within an
hour: the quota fills, the graphs tangle, and nobody can say which version is
running. So the gate is not a permission on some of these commands, it is the
first line of `Studio.call` and it covers all of them.

`ctx.surface` is what it reads. `"management"` is the Script panel, a scheduled
job or an API key — somebody asked for this, once, on purpose. Everything else
is a conversation and is refused. The test is for the *open* value, so a
context built by an older runtime, or by hand, or not at all, is a conversation:
a gate that has to recognise every closed case in order to close is a gate that
opens on the case nobody thought of.

**Why `surface` and not `mode`.** `ctx.mode` already exists and already means
something — `"test"` is the studio's own chat and `"live"` is a real customer
(`hooks.context_for`), and a hook that charges a card branches on it. That is a
different question from this one, and all four combinations are real: the
Script panel is management *and* a test; a scheduled job is management *and*
live. One key cannot carry two orthogonal facts. Overloading `mode` would also
break every hook already reading it, without a word anywhere — which is the
failure shape this codebase is written against.

The change `hooks.context_for` needs is one line: `"surface": CONVERSATION` in
the dictionary it builds. It only ever builds a `ctx` *from a run*, and a run
means somebody is in a chat waiting for an answer, so the constant is the whole
of it. Management contexts are built by the callers that have no run.

## One validator, two thresholds

`apps/flows/graph_validation.py` is the check, and nothing here re-implements
it. What differs is where the line between "refuse" and "report" is drawn, and
the difference is not about the graph — it is about what happens next:

* an **import** lands on a canvas with an author in front of it, so a missing
  entry block and an unreachable block are warnings they will see and finish;
* a **script** creates a flow and walks away. There is no canvas and nobody
  reads the warning; what is left behind is a flow nothing can start, or a
  block nothing reaches.

So `create` refuses on `CREATE_FATAL` and `enable` on `ENABLE_FATAL`, both of
which are warning codes to the importer. The precedent is already in the tree:
`PUT /api/v1/flows/<id>/graph/` applies a check the panel's autosave skips, for
exactly this reason — nobody is typing on that surface either.

The **edits** (`nodes.*`, `edges.*`, `flows.update`) hold the editor's own line
instead: errors only. An edit is one step of a sequence, and a threshold that
refused an unreachable block would make a flow impossible to build — the node
is added before the edge that reaches it, always.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from django.db import transaction

from apps.billing.services import check_plan_allows
from apps.common.exceptions import ApiError
from apps.common.models import new_id
from apps.flows.graph_validation import errors_of, summarise, validate_graph
from apps.flows.models import MODULE_CHOICES, Flow
from apps.flows.serializers import FlowSerializer, FlowSummarySerializer
from apps.flows.services import reindex_triggers

#: Somebody is in a chat waiting for an answer. `studio.*` is closed.
CONVERSATION = "conversation"
#: The Script panel by hand, a scheduled job, an API key. Open only here.
MANAGEMENT = "management"

#: Warning codes that stop a `studio.flows.create` — see the module docstring.
CREATE_FATAL = frozenset({"no_entry", "unreachable"})

#: And a switch-on. Narrower on purpose: a flow nothing can start is the one
#: thing «enabled» cannot mean, while an unreachable block on an otherwise
#: working flow is a wart the panel's own switch has never refused. Making a
#: script stricter than the button beside it would produce a flow a person can
#: turn on and a script cannot, which is a rule nobody can hold in their head.
ENABLE_FATAL = frozenset({"no_entry"})

#: What `flows.list` may be narrowed by, and the column each one means.
LIST_FILTERS = {
    "botId": "bot_id",
    "projectId": "project_id",
    "moduleKey": "module_key",
    "enabled": "enabled",
}

#: `flows.list` page size, and its ceiling. A script that walks every flow in a
#: workspace asks for them a page at a time like everything else here does.
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

MODULE_KEYS = frozenset(key for key, _ in MODULE_CHOICES)

#: What `flows.update` may move. Deliberately short, and the omissions are the
#: point: `enabled` has its own two commands because switching a flow on has
#: rules of its own, and `moduleKey` decides which updates the dispatcher even
#: offers this flow — changing it under a running bot is a different operation
#: from a rename and should look like one.
PATCH_KEYS = frozenset({"name", "description", "graph", "nodes", "edges"})


class StudioError(ApiError):
    """A refused `studio.*` call, in the API's own error shape.

    `ApiError` rather than a new exception type because these travel two ways:
    back into the script as `{ok: false, code, error}`, and — when the command
    API is reached from an endpoint — out through the same envelope every other
    refusal uses. A second error shape for one library is a second thing every
    caller has to learn.
    """

    def __init__(self, code: str, message: str, *, field: str | None = None, status_code: int = 400):
        super().__init__(code, message, field=field, status_code=status_code)


def surface_of(ctx: Any) -> str:
    """Which surface a `ctx` describes. Anything not plainly management is a
    conversation — see the note on the default in the module docstring."""
    if isinstance(ctx, dict) and ctx.get("surface") == MANAGEMENT:
        return MANAGEMENT
    return CONVERSATION


@dataclass(frozen=True)
class Studio:
    """Who is calling, and what they may reach.

    The workspace is the tenant every read is filtered by and every write is
    charged to; `project` and `bot` are the defaults a `create` fills in when
    the script names neither, which is the ordinary case — a script running in
    a bot's own Script panel means *this* bot.
    """

    workspace: Any
    project: Any = None
    bot: Any = None
    surface: str = CONVERSATION

    @classmethod
    def for_flow(cls, flow: Flow, *, surface: str = CONVERSATION) -> "Studio":
        """The session a flow's own script runs under."""
        return cls(workspace=flow.workspace, project=flow.project, bot=flow.bot, surface=surface)

    def call(self, name: str, payload: dict | None = None) -> Any:
        """One command. The gate first, always, and before the name is even looked up.

        Before the lookup on purpose: a mistyped command name in a conversation
        must answer the same sentence as a correct one, or the refusal becomes
        a way to ask which commands exist.
        """
        if self.surface != MANAGEMENT:
            raise StudioError("studio_conversation", f"{name} faqat boshqaruv rejimida ishlaydi", status_code=403)
        handler = COMMANDS.get(name)
        if handler is None:
            raise StudioError("unknown_command", f"«{name}» — noma'lum studio buyrug'i", status_code=404)
        return handler(self, payload or {})


# ----------------------------------------------------------------------------
# Reading the payload
#
# Every one of these refuses rather than defaults. A script that asked for the
# wrong thing and got the right-looking answer is the shape of B-09 — the
# «O'rnatish» button that failed with nothing said — and a silently ignored
# argument is the same failure one layer down.
# ----------------------------------------------------------------------------


def _text(payload: dict, key: str, *, command: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise StudioError("missing_argument", f"{command} uchun «{key}» kerak", field=key)
    return value.strip()


def _mapping(payload: dict, key: str) -> dict:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _flow(studio: Studio, payload: dict, *, command: str) -> Flow:
    flow_id = _text(payload, "flowId" if "flowId" in payload else "id", command=command)
    flow = Flow.objects.filter(workspace=studio.workspace, pk=flow_id).select_related("bot", "project").first()
    if flow is None:
        # Scoped by workspace before it is looked up, so a flow in another
        # tenant is "not found" here in the same words it is everywhere else —
        # the difference between 403 and 404 is itself a fact about another
        # company's data.
        raise StudioError("not_found", f"«{flow_id}» oqimi topilmadi", status_code=404)
    return flow


def _graph_of(spec: dict) -> tuple[list, list]:
    """`{graph: {nodes, edges}}` or `{nodes, edges}` — both shapes are in the
    tree already (`/api/flows/import/` takes the first, `POST /api/flows/` the
    second) and refusing either would be a rule whose only purpose is to be
    discovered."""
    graph = spec.get("graph") if isinstance(spec.get("graph"), dict) else spec
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    return (nodes if isinstance(nodes, list) else []), (edges if isinstance(edges, list) else [])


# ----------------------------------------------------------------------------
# The graph
# ----------------------------------------------------------------------------


def refuse_graph(nodes: list, edges: list, *, command: str, fatal: frozenset[str] = frozenset()) -> None:
    """Raises when this graph may not be stored by `command`.

    `validate_graph` is the whole of the judgement; `fatal` is only which
    warning codes this particular door treats as a refusal. Nothing here has an
    opinion the editor's own panel does not already have.
    """
    if not nodes:
        # A blank canvas is the most ordinary thing a person creates from the
        # panel and never a thing a script means to create — `POST /api/flows/`
        # exempts it explicitly for exactly that reason. Stated here so a
        # script gets the sentence about blocks rather than the one about entry
        # blocks, which is the next thing wrong and not the first.
        raise StudioError(
            "empty_graph",
            f"{command}: oqimda birorta ham blok yo'q — kamida bitta boshlanish bloki qo'shing",
            field="nodes",
        )

    findings = validate_graph({"nodes": nodes, "edges": edges})
    stopping = [f for f in findings if f.is_error or f.code in fatal]
    if not stopping:
        return

    first = stopping[0]
    # The first one and how many there are, the way `refuse_unwalkable_graph`
    # words it: this raises into an envelope with room for one message, and
    # `studio.flows.validate` is where the whole report lives.
    message = first.message if len(stopping) == 1 else f"{first.message} (jami {len(stopping)} ta xato)"
    raise StudioError(first.code, f"{command}: {message}", field="edges" if first.edge_id else "nodes")


def _save_graph(flow: Flow, nodes: list, edges: list, *, command: str) -> Flow:
    """Writes a graph and re-derives what the runtime matches on, together.

    One transaction, because `FlowTrigger` rows are derived from the blocks: a
    graph saved without its reindex leaves the dispatcher matching against the
    flow as it was before the edit.
    """
    refuse_graph(nodes, edges, command=command)
    with transaction.atomic():
        flow.nodes = nodes
        flow.edges = edges
        flow.save(update_fields=["nodes", "edges", "updated_at"])
        reindex_triggers(flow)
    return flow


# ----------------------------------------------------------------------------
# flows
# ----------------------------------------------------------------------------


def flows_list(studio: Studio, payload: dict) -> list[dict]:
    filters = _mapping(payload, "filter")
    unknown = set(filters) - set(LIST_FILTERS) - {"q", "limit", "offset"}
    if unknown:
        # A filter nobody applied is a longer list than the script asked for,
        # acted on as if it were the right one.
        raise StudioError("unknown_filter", f"Noma'lum filtr: {', '.join(sorted(unknown))}", field="filter")

    rows = Flow.objects.filter(workspace=studio.workspace)
    for key, column in LIST_FILTERS.items():
        if key in filters and filters[key] is not None:
            rows = rows.filter(**{column: filters[key]})
    if filters.get("q"):
        rows = rows.filter(name__icontains=str(filters["q"]))

    limit = filters.get("limit")
    limit = DEFAULT_LIMIT if not isinstance(limit, int) or limit <= 0 else min(limit, MAX_LIMIT)
    offset = filters.get("offset")
    offset = 0 if not isinstance(offset, int) or offset < 0 else offset
    return FlowSummarySerializer(rows[offset : offset + limit], many=True).data


def flows_get(studio: Studio, payload: dict) -> dict:
    return FlowSerializer(_flow(studio, payload, command="studio.flows.get")).data


def flows_create(studio: Studio, payload: dict) -> dict:
    """A new flow from a graph a script built.

    The order is `/api/flows/import/`'s, and for its reasons: the graph first,
    because a broken one is refused whatever else is true; the bot and project
    next; the plan last of the checks and still before the write, so a refusal
    is something the caller can act on rather than an explanation arriving
    after the row exists.
    """
    command = "studio.flows.create"
    spec = _mapping(payload, "spec") or payload
    nodes, edges = _graph_of(spec)
    refuse_graph(nodes, edges, command=command, fatal=CREATE_FATAL)

    bot = studio.bot
    project = studio.project
    if spec.get("botId"):
        bot = _own(studio, "bots", spec["botId"])
    if spec.get("projectId"):
        project = _own(studio, "projects", spec["projectId"])
    if bot is None or project is None:
        raise StudioError("not_found", f"{command}: bot yoki loyiha topilmadi", status_code=404, field="botId")
    if bot.project_id != project.id:
        # Both in this workspace but not in each other; filing the flow under
        # either would make the other screen lie about it.
        raise StudioError("bot_project_mismatch", f"{command}: bot bu loyihaga tegishli emas", field="botId")

    module_key = spec.get("moduleKey") or (bot.enabled_modules or ["dms"])[0]
    if module_key not in MODULE_KEYS:
        # A free-text module stores happily and then matches nothing: the
        # dispatcher looks flows up by this exact string.
        raise StudioError(
            "invalid_module",
            f"{command}: «{module_key}» moduli yo'q. Mavjudlari: {', '.join(sorted(MODULE_KEYS))}",
            field="moduleKey",
        )

    # Raises `PlanLimitExceeded` (402), which carries the plan's own sentence —
    # what the panel would have said, said to a script. Not swallowed into a
    # `False` anywhere on the way out: a create that quietly did nothing is the
    # Marketplace «O'rnatish» button that reported nothing, one layer down.
    check_plan_allows(studio.workspace, "flows", field="name")

    with transaction.atomic():
        flow = Flow.objects.create(
            workspace=studio.workspace,
            project=project,
            bot=bot,
            module_key=module_key,
            name=str(spec.get("name") or "Skript yaratgan oqim")[:120],
            description=str(spec.get("description") or "")[:280],
            nodes=nodes,
            edges=edges,
            # Never enabled on arrival. A flow that started answering customers
            # the instant a script wrote it would be a bot changed by code
            # nobody reviewed; `studio.flows.enable` is a separate decision and
            # is written like one.
            enabled=False,
            origin={"kind": "blank", "label": "Skript yaratdi"},
        )
        reindex_triggers(flow)
    return FlowSerializer(flow).data


def _own(studio: Studio, related: str, pk: Any) -> Any:
    """A bot or a project of this workspace, or None. Never a global lookup —
    the tenant is the filter, not a thing checked afterwards."""
    return getattr(studio.workspace, related).filter(pk=str(pk)).first()


def flows_update(studio: Studio, payload: dict) -> dict:
    command = "studio.flows.update"
    flow = _flow(studio, payload, command=command)
    patch = _mapping(payload, "patch")
    unknown = set(patch) - PATCH_KEYS
    if unknown:
        raise StudioError(
            "unknown_field",
            f"{command}: «{', '.join(sorted(unknown))}» o'zgartirilmaydi. "
            f"Mumkin bo'lganlari: {', '.join(sorted(PATCH_KEYS))}",
            field="patch",
        )

    fields: list[str] = []
    if "name" in patch:
        flow.name = str(patch["name"] or "")[:120]
        fields.append("name")
    if "description" in patch:
        flow.description = str(patch["description"] or "")[:280]
        fields.append("description")
    if fields:
        flow.save(update_fields=[*fields, "updated_at"])

    if patch.keys() & {"graph", "nodes", "edges"}:
        nodes, edges = _graph_of(patch)
        _save_graph(flow, nodes, edges, command=command)
    return FlowSerializer(flow).data


def flows_enable(studio: Studio, payload: dict) -> dict:
    return _switch(studio, payload, enabled=True, command="studio.flows.enable")


def flows_disable(studio: Studio, payload: dict) -> dict:
    return _switch(studio, payload, enabled=False, command="studio.flows.disable")


def _switch(studio: Studio, payload: dict, *, enabled: bool, command: str) -> dict:
    """Both halves of the switch, because only one of them has rules.

    Turning a flow **off** is never refused — nobody may be trapped in a state
    they are being billed for, and a script that cannot stop a misbehaving flow
    is worse than one that cannot start it. Turning it **on** is the moment the
    plan is spent and the moment a customer can reach the graph, so it is
    checked twice: the plan through `check_graph_allows`, which is what the
    panel's own switch calls, and the graph itself against `ENABLE_FATAL`.
    """
    flow = _flow(studio, payload, command=command)
    if enabled and not flow.enabled:
        refuse_graph(flow.nodes, flow.edges, command=command, fatal=ENABLE_FATAL)
        from apps.billing.services import check_graph_allows

        check_graph_allows(studio.workspace, flow.nodes, flow_id=flow.id)

    flow.enabled = enabled
    flow.status, flow.status_tone = ("Faol", "success") if enabled else ("To'xtatilgan", "neutral")
    flow.save(update_fields=["enabled", "status", "status_tone", "updated_at"])
    return FlowSummarySerializer(flow).data


def flows_validate(studio: Studio, payload: dict) -> dict:
    """Everything wrong with a stored flow — errors *and* warnings.

    The reporting half of the pair, in the shape `/api/flows/import/validate/`
    already answers in. `ok` is false on an error alone, the way it is there;
    what `create` and `enable` additionally refuse is named separately so a
    script can see the difference rather than infer it from a refusal.
    """
    flow = _flow(studio, payload, command="studio.flows.validate")
    graph = {"nodes": flow.nodes, "edges": flow.edges}
    findings = validate_graph(graph)
    return {
        "ok": not errors_of(findings),
        "findings": [finding.as_payload() for finding in findings],
        "summary": summarise(graph),
        "blocksCreate": sorted({f.code for f in findings if f.is_error or f.code in CREATE_FATAL}),
        "blocksEnable": sorted({f.code for f in findings if f.is_error or f.code in ENABLE_FATAL}),
    }


# ----------------------------------------------------------------------------
# nodes and edges
#
# The incremental half. Each one reads the stored graph, changes one thing and
# writes it back through `_save_graph`, so a block added by a script meets the
# same check as a block dropped on the canvas — and the trigger index is
# re-derived either way.
# ----------------------------------------------------------------------------


def nodes_add(studio: Studio, payload: dict) -> dict:
    command = "studio.nodes.add"
    flow = _flow(studio, payload, command=command)
    node = _mapping(payload, "node")
    # A minted id where the script gave none: a block has to have one, and
    # making the caller invent it is making them invent something the product
    # already knows how to make. A duplicate is *not* checked here — that is
    # `graph_validation`'s `duplicate_node_id`, which `_save_graph` runs a line
    # below, and a second wording of one rule is how the two come to disagree
    # about what an id is.
    node_id = str(node.get("id") or "").strip() or new_id()
    _save_graph(flow, [*flow.nodes, {**node, "id": node_id}], list(flow.edges), command=command)
    return FlowSerializer(flow).data


def nodes_update(studio: Studio, payload: dict) -> dict:
    command = "studio.nodes.update"
    flow = _flow(studio, payload, command=command)
    node_id = _text(payload, "nodeId", command=command)
    patch = _mapping(payload, "patch")
    found = False
    nodes = []
    for node in flow.nodes:
        if str(node.get("id")) == node_id:
            found = True
            # `id` is not the script's to move: an edge names a block by it, so
            # a rename here would be a rename in one of two places.
            nodes.append({**node, **patch, "id": node_id})
        else:
            nodes.append(node)
    if not found:
        raise StudioError("node_not_found", f"{command}: «{node_id}» bloki bu oqimda yo'q", status_code=404, field="nodeId")
    _save_graph(flow, nodes, list(flow.edges), command=command)
    return FlowSerializer(flow).data


def nodes_remove(studio: Studio, payload: dict) -> dict:
    """Takes the block's wires with it.

    Not a convenience: every edge touching a removed block becomes
    `edge_to_missing_node`, which is an error, so a removal that left them
    behind could never be stored at all. The canvas does the same thing when a
    card is deleted, and doing it differently here would mean a script had to
    unwire a block before it could delete it — in an order it has to work out
    from the graph.
    """
    command = "studio.nodes.remove"
    flow = _flow(studio, payload, command=command)
    node_id = _text(payload, "nodeId", command=command)
    if not any(str(node.get("id")) == node_id for node in flow.nodes):
        raise StudioError("node_not_found", f"{command}: «{node_id}» bloki bu oqimda yo'q", status_code=404, field="nodeId")
    nodes = [node for node in flow.nodes if str(node.get("id")) != node_id]
    edges = [
        edge
        for edge in flow.edges
        if str(edge.get("from")) != node_id and str(edge.get("to")) != node_id
    ]
    _save_graph(flow, nodes, edges, command=command)
    return FlowSerializer(flow).data


def edges_add(studio: Studio, payload: dict) -> dict:
    command = "studio.edges.add"
    flow = _flow(studio, payload, command=command)
    edge = _mapping(payload, "edge")
    edge_id = str(edge.get("id") or "").strip() or new_id()
    # The one id rule that is genuinely this module's own: `graph_validation`
    # has nothing to say about a repeated *edge* id, because the runtime never
    # looks an edge up by one — `Flow.edge` finds it by `(from, port)`. It is
    # `studio.edges.remove` that needs them unique, and a remove that deleted
    # two connections because a script reused a string is a wire disappearing
    # from a canvas nobody was looking at.
    if any(str(existing.get("id")) == edge_id for existing in flow.edges):
        raise StudioError("duplicate_edge_id", f"{command}: «{edge_id}» id'si allaqachon band", field="edge")
    # `port` is deliberately not defaulted to "out". `Flow.edge` matches on the
    # literal value, so a guessed port is an edge the runtime silently never
    # follows — the exact fault `graph_validation` calls the most likely thing
    # for a generator to leave out. It is refused there, by name, with the
    # block's real exits in the sentence.
    _save_graph(flow, list(flow.nodes), [*flow.edges, {**edge, "id": edge_id}], command=command)
    return FlowSerializer(flow).data


def edges_remove(studio: Studio, payload: dict) -> dict:
    command = "studio.edges.remove"
    flow = _flow(studio, payload, command=command)
    edge_id = _text(payload, "edgeId", command=command)
    if not any(str(edge.get("id")) == edge_id for edge in flow.edges):
        raise StudioError("edge_not_found", f"{command}: «{edge_id}» bog'lanishi bu oqimda yo'q", status_code=404, field="edgeId")
    edges = [edge for edge in flow.edges if str(edge.get("id")) != edge_id]
    _save_graph(flow, list(flow.nodes), edges, command=command)
    return FlowSerializer(flow).data


#: The table the bridge wires. Names match `script/studio.mjs` exactly — one
#: string, spelled once on each side, so a method that exists in the library
#: and not here fails loudly at the lookup rather than quietly at the edge of
#: somebody's expectations.
COMMANDS: dict[str, Callable[[Studio, dict], Any]] = {
    "studio.flows.list": flows_list,
    "studio.flows.get": flows_get,
    "studio.flows.create": flows_create,
    "studio.flows.update": flows_update,
    "studio.flows.enable": flows_enable,
    "studio.flows.disable": flows_disable,
    "studio.flows.validate": flows_validate,
    "studio.nodes.add": nodes_add,
    "studio.nodes.update": nodes_update,
    "studio.nodes.remove": nodes_remove,
    "studio.edges.add": edges_add,
    "studio.edges.remove": edges_remove,
}
