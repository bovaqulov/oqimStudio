"""Flow payloads — camelCase, matching `features/flows/types.ts`.

Per-block *fields* are still passed through untouched, and for the reason this
docstring has always given: the editor owns the block schema, and a backend that
re-validated every option of every block type would have to be redeployed before
the editor could ship one.

What is no longer passed through is the graph's **vocabulary** — the node `type`
and the edge `port`. Those are not the editor's private business: they are the
contract between what the editor saves and what the runtime walks, and a graph
now arrives from outside the editor as well (`/api/flows/import/`). See
`graph_validation`, which is what a graph is checked against.

That check belongs to the *table*, not to any one endpoint, so it lives in
`refuse_unwalkable_graph` and every serializer that can write blocks calls it —
the save, the entry-point POST and the create. The create was the one that
proved the point: it had been taking `nodes` and `edges` as raw dictionaries the
whole time, so the graph the autosave refused was accepted, stored and indexed
by posting it one URL to the left.
"""

from __future__ import annotations

from rest_framework import serializers

from .graph_validation import errors_of, validate_graph
from .models import MODULE_CHOICES, Flow, FlowRun, FlowRunStep


class FlowSummarySerializer(serializers.ModelSerializer):
    """A flow without its graph — what a list of cards needs."""

    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    projectId = serializers.CharField(source="project_id", read_only=True)
    botId = serializers.CharField(source="bot_id", read_only=True)
    moduleKey = serializers.CharField(source="module_key", read_only=True)
    isMain = serializers.BooleanField(source="is_main", read_only=True)
    # Writable: which editor the author prefers is theirs to change, and a
    # PATCH is all it takes — there is no graph conversion behind it.
    layoutMode = serializers.ChoiceField(source="layout_mode", choices=["simple", "pro"], required=False)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    status = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Flow
        fields = [
            "id", "name", "description", "workspaceId", "projectId", "botId", "moduleKey",
            "status", "stats", "updatedAt", "enabled", "runs", "origin", "isMain", "layoutMode",
        ]
        # A PATCH may rename a flow and nothing else. `enabled` has its own
        # endpoint because switching a flow on has a rule of its own (an empty
        # one may not run), and `runs` is a counter the runtime owns.
        read_only_fields = ["id", "enabled", "runs"]

    def get_status(self, flow: Flow) -> dict:
        return {"label": flow.status, "tone": flow.status_tone}

    def get_stats(self, flow: Flow) -> list[dict]:
        return [
            {"label": "Kirdi", "value": str(flow.runs)},
            {"label": "Bloklar", "value": str(len(flow.nodes))},
        ]


class FlowSerializer(FlowSummarySerializer):
    """The whole flow, graph included — what the editor opens.

    The graph is read-only *here*: saving it also has to re-derive the trigger
    index, so it goes through `/flows/<id>/graph/`, which does both in one
    transaction. A PATCH that could write `nodes` on its own would leave the
    runtime matching against the graph the flow had before the edit.
    """

    # Read-only for the same reason the graph is: a script is stored only after
    # it has been shown to compile, and that check lives in its own endpoint.
    script = serializers.CharField(read_only=True)
    scriptUpdatedAt = serializers.DateTimeField(source="script_updated_at", read_only=True)

    class Meta(FlowSummarySerializer.Meta):
        fields = FlowSummarySerializer.Meta.fields + ["nodes", "edges", "script", "scriptUpdatedAt"]
        read_only_fields = FlowSummarySerializer.Meta.read_only_fields + ["nodes", "edges"]


#: Error codes that belong to a connection rather than to a block. An edge with
#: no `id` carries nothing to point at, so the code is the only thing left to
#: read the field off.
EDGE_ERROR_CODES = {"invalid_edge", "edge_to_missing_node", "missing_port", "unknown_port", "edge_into_entry"}


def refuse_unwalkable_graph(nodes: list, edges: list) -> None:
    """Raises if the runtime could not walk this graph. One rule, one copy.

    Every door into `Flow.nodes` goes through here, because a graph does not
    become safe by the URL it arrived on: `reindex_triggers` runs on a created
    flow exactly as it runs on a saved one, and `runner.walk` reads the stored
    blocks either way. Two copies of this check would drift, and the one that
    drifted would be the quieter endpoint — which is precisely the one that was
    left unguarded the first time (`POST /flows/` accepted a `"type": "kod"`
    the autosave had refused since the day the check was written).

    **Errors only.** Warnings are half-built work — a branch nobody has wired
    yet is most of what anybody saves — and refusing those would lock an author
    out of the edit that finishes them. Same argument as the plan check the
    graph endpoint deliberately does not make (see `views.graph`).

    One message, not the list: this raises into the API's single error
    envelope, which has room for one. It names the first error and how many
    there are, and `/api/flows/import/validate/` is where the whole report
    lives.
    """
    errors = errors_of(validate_graph({"nodes": nodes, "edges": edges}))
    if not errors:
        return

    first = errors[0]
    message = first.message if len(errors) == 1 else f"{first.message} (jami {len(errors)} ta xato)"
    # `field` decides which half of the editor the message is shown under, and
    # the existing clients branch on it. Both payloads that reach here name
    # their halves `nodes` and `edges`, so the same two strings fit both.
    field = "edges" if first.edge_id or first.code in EDGE_ERROR_CODES else "nodes"
    raise serializers.ValidationError({field: message})


class CreateFlowSerializer(serializers.Serializer):
    """A new flow, optionally arriving with its graph already drawn.

    The graph is checked here for the same reason the save checks it, and this
    is the door it was actually easier to walk through: what is posted is
    stored and indexed without ever having been on a canvas. The editor's own
    callers already send graphs it built rather than drew — the flow-kit
    wizard compiles one from a blueprint, and splitting a branch out of a flow
    posts the moved blocks — and beside those sit every caller nobody wrote:
    an old client, a script with a token, a graph a model produced for someone
    who did not notice `/flows/import/` exists.
    """

    projectId = serializers.CharField()
    botId = serializers.CharField()
    # A free-text module would be stored happily and then match nothing: the
    # dispatcher looks flows up by this exact string.
    moduleKey = serializers.ChoiceField(choices=[key for key, _ in MODULE_CHOICES])
    name = serializers.CharField(required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    nodes = serializers.ListField(child=serializers.DictField(), required=False)
    edges = serializers.ListField(child=serializers.DictField(), required=False)
    origin = serializers.DictField(required=False)

    def validate(self, attrs):
        nodes = attrs.get("nodes") or []
        edges = attrs.get("edges") or []
        if not nodes and not edges:
            # The blank canvas, and the one thing this endpoint has that the
            # save does not. «Yangi oqim» posts no graph at all; a flow starts
            # empty and is drawn afterwards. Stated here rather than left to
            # `validate_graph` returning nothing but a warning for it, so that
            # making "no entry block" an error one day cannot quietly turn the
            # most ordinary request in the product into a 400.
            return attrs
        refuse_unwalkable_graph(nodes, edges)
        return attrs


class GraphSerializer(serializers.Serializer):
    """A graph save. Checked against the block vocabulary before it is written,
    because everything past this point assumes it walks: `reindex_triggers`
    derives the match index from the blocks, and `runner.walk` looks for an edge
    leaving a port by its exact name."""

    nodes = serializers.ListField(child=serializers.DictField())
    edges = serializers.ListField(child=serializers.DictField())
    #: What the flow is called, and the line under it.
    #:
    #: They travel with the graph because they are edited in the same place and
    #: by the same autosave — the editor's top bar sits above the canvas, not on
    #: some settings screen of its own. Without them here the name a person
    #: typed was held in the browser and never written down, so every flow in
    #: the product stayed «Nomsiz oqim» however many times it was renamed.
    #:
    #: Optional, because a client that only means to save the canvas must not
    #: blank them by omission.
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    description = serializers.CharField(max_length=280, required=False, allow_blank=True)

    def validate(self, attrs):
        """Refuses a save the runtime could not walk.

        This is worth more than the import endpoint it was written for. Autosave
        is where most graphs are written, and until now the only two things
        checked here were unique ids and edges landing on a block that exists —
        so a `"type": "kod"` or a `"port": "success"` typed by a script, a stale
        client or an old template was stored, re-derived into `FlowTrigger` rows
        and only discovered by a customer whose conversation stopped.

        The rule itself is `refuse_unwalkable_graph`, shared with the create
        endpoint: unlike the save, a graph can reach the table without ever
        passing this serializer, and the same words have to come back whichever
        way it arrived.

        Unlike the create path, an empty graph here is not exempt — and does not
        need to be, since an empty one raises nothing. A save that names both
        lists is a save of a canvas; it is only *arriving* with no graph that is
        an ordinary request, and that is the other endpoint's case.
        """
        refuse_unwalkable_graph(attrs["nodes"], attrs["edges"])
        return attrs


class ImportGraphSerializer(serializers.Serializer):
    """The envelope `/api/flows/import/validate/` and `/api/flows/import/` take.

    `graph` is a bare `DictField` on purpose. The graph is the untrusted half of
    this request and `graph_validation` is what reads it — a DRF field that
    rejected a malformed one first would answer "This field is required" to
    somebody holding a file they cannot see anything wrong with, instead of the
    findings that name the block and the line to change.
    """

    graph = serializers.DictField()


class ImportFlowSerializer(ImportGraphSerializer):
    """`/api/flows/import/`: the graph, plus where the new flow is being filed.

    Deliberately carries no flow id. An import that could name an existing flow
    would be a replace, and nobody uploading a file has asked for the flow they
    already have to be overwritten — see `views.flow_import`.
    """

    projectId = serializers.CharField()
    botId = serializers.CharField()
    moduleKey = serializers.ChoiceField(choices=[key for key, _ in MODULE_CHOICES])
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    description = serializers.CharField(max_length=280, required=False, allow_blank=True)
    #: The flow's own JavaScript, when the file carries any — `export` writes it
    #: and this is what reads it back.
    #:
    #: `trim_whitespace=False` because this is a source file and not a name: a
    #: field that quietly strips what it was handed is a field that edits an
    #: author's code. And no `max_length`, unlike the two above — a script is
    #: refused by length *and* by whether it compiles, and both of those live in
    #: `views.flow_import` beside the ceiling `views.script` already states.
    #: Half the rule here and half there is how the two come to disagree.
    script = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)


class FlowRunStepSerializer(serializers.ModelSerializer):
    nodeId = serializers.CharField(source="node_id", read_only=True)
    nodeType = serializers.CharField(source="node_type", read_only=True)
    at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = FlowRunStep
        fields = ["id", "nodeId", "nodeType", "actor", "text", "payload", "at"]


class FlowRunSerializer(serializers.ModelSerializer):
    flowId = serializers.CharField(source="flow_id", read_only=True)
    botId = serializers.CharField(source="bot_id", read_only=True)
    contactId = serializers.CharField(source="contact_id", read_only=True)
    currentNodeId = serializers.CharField(source="current_node_id", read_only=True)
    startedAt = serializers.DateTimeField(source="started_at", read_only=True)
    finishedAt = serializers.DateTimeField(source="finished_at", read_only=True)
    isTest = serializers.BooleanField(source="is_test", read_only=True)
    steps = FlowRunStepSerializer(many=True, read_only=True)

    class Meta:
        model = FlowRun
        fields = [
            "id", "flowId", "botId", "contactId", "status", "currentNodeId",
            "context", "error", "isTest", "startedAt", "finishedAt", "steps",
        ]
