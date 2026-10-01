"""Flow endpoints — the editor's whole backend, and the way in from outside it.

Saving a graph and re-deriving its triggers happen in one request, so a flow
that is switched on is never matching against the graph it had before the last
save.

Four of these endpoints exist because the editor is no longer the only thing
that writes a graph: `schema` says what a block looks like, `import/validate`
reads a graph without keeping it, `import` files one as a **new** flow, and
`export` hands one back as a file. Everything they accept goes through
`graph_validation` first — including the autosave the editor itself uses and
`create`, which is the other way a graph reaches the table: a flow may be
posted with its blocks already drawn, and `reindex_triggers` runs on it exactly
as it runs on a save.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.billing.services import check_graph_allows, check_plan_allows
from apps.engine import expressions, hooks
from apps.bots.models import Bot
# The library ceiling itself, not a copy of the number: `SCRIPT_COMPOSED_LIMIT`
# below is the two halves added together, and a second 50 000 written out here
# would be a second 50 000 to remember when one of them moves.
from apps.bots.views import SCRIPT_LIBRARY_LIMIT
from django.utils import timezone

from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin
from apps.engine.script import ScriptLimits, compose, locate, run_script, syntax_line
from apps.workspaces.models import WRITE_ROLES
from apps.projects.models import Project

from .graph_validation import errors_of, summarise, validate_graph
from .models import Flow, FlowRun
from .serializers import (
    CreateFlowSerializer,
    FlowRunSerializer,
    FlowSerializer,
    FlowSummarySerializer,
    GraphSerializer,
    ImportFlowSerializer,
    ImportGraphSerializer,
)
from .services import SCRIPT_LIMIT, ensure_main_flow, refuse_broken_script, reindex_triggers
from .vocabulary import SCHEMA_VERSION, definition, schema_payload

#: How much one request may hand the Node process: the source *and* the bot's
#: library composed above it, which is what actually runs (`script.compose`).
#:
#: A different question from the one above — a sandbox budget is about what
#: runs, not about what somebody typed — and derived from the two stored
#: ceilings rather than chosen, so that a file and a library which are each
#: within their own limits can never be refused together. What it does catch is
#: the half nothing else bounds: `SCRIPT_LIBRARY_LIMIT` is enforced by the
#: endpoint that writes a library, not by the column, so a library that reached
#: the row some other way — a seed, a market install, a lowered ceiling — is
#: unbounded until here.
SCRIPT_COMPOSED_LIMIT = SCRIPT_LIMIT + SCRIPT_LIBRARY_LIMIT


class ScriptRunThrottle(SimpleRateThrottle):
    """How often one account may spend a Node process from the editor.

    The endpoint under it is the exposed one. The runtime's scripts arrive
    through Celery, whose concurrency is already a queue; this one runs inside
    the Django process that serves every other screen in the product, and
    before this it had no ceiling of any kind — so exhausting it did not
    degrade scripts, it took the panel down for everybody.

    Keyed on the signed-in user, and that is the one place this departs from
    `accounts.views.IpRateThrottle`. The panel reaches Django through the
    Next.js server, which does not forward the reader's address — the same fact
    the `auth-poll` note in `settings.base` is written around — so `get_ident`
    sees one client for the whole deployment. An address bucket here would be a
    bucket a company shares, and the first author to hold the run button down
    would lock the panel for their colleagues. A signed-in identity is
    available here in a way it is not on the auth endpoints, so it is what gets
    counted.
    """

    scope = "script-run"

    def get_cache_key(self, request, view) -> str:
        # Permissions run before throttles in `APIView.initial`, so by this
        # line the caller is a workspace member and `pk` is always there. The
        # address is kept as the fallback anyway, because a throttle that
        # returns None silently lets everything through — the failure mode
        # nobody notices until it matters.
        user = getattr(request, "user", None)
        ident = user.pk if user is not None and user.is_authenticated else self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class FlowViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsWorkspaceMember]
    queryset = Flow.objects.select_related("bot", "project").all()

    def get_serializer_class(self):
        # A list of cards does not need every block of every graph, and sending
        # them makes the modules screen scale with what authors have drawn.
        # `?withGraph=1` is for the one caller that does need them: the "jump to
        # flow" picker lists the blocks inside each flow, not just their names.
        if self.action == "list" and self.request.query_params.get("withGraph") not in {"1", "true"}:
            return FlowSummarySerializer
        return FlowSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        for param, field in (("botId", "bot_id"), ("moduleKey", "module_key"), ("projectId", "project_id")):
            if params.get(param):
                queryset = queryset.filter(**{field: params[param]})
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = CreateFlowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        bot = Bot.objects.filter(workspace=self.workspace, pk=data["botId"]).first()
        project = Project.objects.filter(workspace=self.workspace, pk=data["projectId"]).first()
        if bot is None or project is None:
            raise ApiError("not_found", "Bot yoki loyiha topilmadi", status_code=404)
        if bot.project_id != project.id:
            # Both belong to this workspace but not to each other; filing the
            # flow under either one would make the other screen lie about it.
            raise ApiError("bot_project_mismatch", "Bot bu loyihaga tegishli emas", field="botId")

        # Before the write, so a 402 is a refusal somebody can act on rather
        # than an explanation arriving after the row already exists. Only the
        # flow count: what the blocks cost is settled when the flow is switched
        # on, so a template that carries an AI block still lands and can be
        # edited down to something the plan covers.
        check_plan_allows(self.workspace, "flows", field="name")

        with transaction.atomic():
            flow = Flow.objects.create(
                workspace=self.workspace,
                project=project,
                bot=bot,
                module_key=data["moduleKey"],
                name=data.get("name") or "Yangi oqim",
                description=data.get("description", ""),
                nodes=data.get("nodes") or [],
                edges=data.get("edges") or [],
                origin=data.get("origin") or {"kind": "blank", "label": "Bo'sh kanvas"},
            )
            reindex_triggers(flow)
        return Response(FlowSerializer(flow).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance: Flow):
        if instance.is_main:
            raise ApiError("main_flow_locked", "Asosiy oqimni o'chirib bo'lmaydi", status_code=403)
        instance.delete()

    @action(detail=False, methods=["get", "post"])
    def main(self, request):
        """The `dms` module's entry point for a bot, created on first ask."""
        bot_id = request.query_params.get("botId") or request.data.get("botId")
        bot = Bot.objects.filter(workspace=self.workspace, pk=bot_id).select_related("project").first()
        if bot is None:
            raise ApiError("bot_not_found", "Bot topilmadi", field="botId", status_code=404)

        # A POST may carry the graph the entry point is built from; a GET just
        # reads it, creating a default one if this bot has none yet.
        graph = None
        if request.method == "POST" and request.data.get("nodes"):
            serializer = GraphSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            graph = (serializer.validated_data["nodes"], serializer.validated_data["edges"])

        flow = ensure_main_flow(workspace=self.workspace, project=bot.project, bot=bot, graph=graph)
        if graph and not flow.triggers.exists():
            reindex_triggers(flow)
        return Response(FlowSerializer(flow).data)

    @action(detail=True, methods=["put", "patch"])
    def graph(self, request, pk=None):
        """Saves the canvas and re-derives what the runtime matches on."""
        flow = self.get_object()
        serializer = GraphSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # No plan check here, deliberately. This endpoint is autosave: refusing
        # it locks an author out of the very edit that would fix the problem —
        # a flow with two AI blocks on a plan without them could not be saved,
        # and deleting those blocks is a save. What the plan gates is the flow
        # running, which is `enable` below.

        with transaction.atomic():
            flow.nodes = serializer.validated_data["nodes"]
            flow.edges = serializer.validated_data["edges"]
            fields = ["nodes", "edges", "updated_at"]
            # Written only when sent. A caller that left them out is saving the
            # canvas and nothing else, and treating that as "set them to empty"
            # is how an autosave erases a name somebody typed in another tab.
            for field in ("name", "description"):
                if field in serializer.validated_data:
                    setattr(flow, field, serializer.validated_data[field])
                    fields.append(field)
            flow.save(update_fields=fields)
            triggers = reindex_triggers(flow)
        # Answered on the save that caused it, not on a screen somebody has to
        # go and open. A `{{ money(...) }}` naming a function the library does
        # not declare renders as an empty space in a customer's message — the
        # one failure in this feature that nobody would ever report — so the
        # moment to say it is while the author is still looking at the block.
        return Response(
            {
                **FlowSerializer(flow).data,
                "triggerCount": triggers,
                "expressionWarnings": expressions.missing_functions(
                    flow.nodes, getattr(flow.bot, "script_library", "") or ""
                ),
            }
        )

    @action(detail=True, methods=["post"])
    def enable(self, request, pk=None):
        """Switching a flow on is a decision of its own, so it is its own endpoint."""
        flow = self.get_object()
        enabled = bool(request.data.get("enabled", True))
        if enabled and flow.is_empty:
            raise ApiError("empty_flow", "Bo'sh oqimni yoqib bo'lmaydi — avval blok qo'shing")
        # Switching a flow on is the moment the plan is spent, and the only
        # moment refusing helps: the author is holding the graph, they can take
        # a block out and try again. Turning one *off* is never refused —
        # nobody may be trapped in a state they are being billed for — and a
        # flow that is *already* running is left alone, so a limit introduced
        # after the fact does not retroactively break what was working.
        if enabled and not flow.enabled:
            check_graph_allows(self.workspace, flow.nodes, flow_id=flow.id)

        flow.enabled = enabled
        flow.status, flow.status_tone = ("Faol", "success") if enabled else ("To'xtatilgan", "neutral")
        flow.save(update_fields=["enabled", "status", "status_tone"])
        return Response(FlowSummarySerializer(flow).data)

    @action(detail=False, methods=["post"], url_path="script/run", throttle_classes=[ScriptRunThrottle])
    def script_run(self, request):
        """Runs a Kod block's source against inputs the author typed.

        On the collection rather than on a flow, and deliberately: the panel
        this answers sits in the Inspector beside a block that may not have been
        saved yet. Requiring a flow id would mean saving a draft to try a line
        of arithmetic — which is the loop the panel exists to remove.

        Write roles only. Nothing here reaches a customer and nothing is stored,
        but it *is* compute on our machines paid for by a tenant, so it belongs
        to the people who may change the flow rather than to everyone who may
        read it.

        `botId` is optional and naming one is what makes this panel honest: the
        runtime puts that bot's shared library above every block it runs
        (`script.compose`), so a test that skipped it would pass on a script
        calling a helper the bot does not have — or fail on one it does. The
        answer carries `where` and `line` for the same reason: a fault
        somewhere in the library has to be reported as the library's, not as a
        line number that is nowhere in the block the author is looking at.

        The sandbox is `apps/engine/script`; what is enforced here is who may
        ask and how much they may spend, not what the script may do. Two
        ceilings, and they stop different things: `ScriptRunThrottle` bounds how
        *often* one account may press the button, and the workspace passed to
        `run_script` bounds how many of this tenant's scripts may be running at
        the same instant — the second is shared with the runtime, so the panel
        cannot crowd out the bots (`script.concurrency`).
        """
        if self.membership.role not in WRITE_ROLES:
            raise ApiError("forbidden", "Kodni ishga tushirish uchun tahrirlash huquqi kerak", status_code=403)

        source = str(request.data.get("source") or "")
        if len(source) > SCRIPT_LIMIT:
            # The stored ceiling, said with the number in it. Both panels that
            # press this button save through an endpoint holding the same one,
            # so a file that gets this far is a file nobody can shorten by
            # editing what they are looking at.
            raise ApiError("script_too_long", f"Kod juda uzun — {SCRIPT_LIMIT} belgidan oshmasin", field="source")

        inputs = request.data.get("inputs")
        if inputs is not None and not isinstance(inputs, dict):
            raise ApiError("invalid_inputs", "Kirish qiymatlari obyekt bo'lishi kerak", field="inputs")

        bot_id = str(request.data.get("botId") or "")
        library = ""
        if bot_id:
            # Scoped to the resolved workspace, so an id from another tenant is
            # "no such bot" rather than a way to read their shared source.
            bot = Bot.objects.filter(workspace=self.workspace, pk=bot_id).first()
            if bot is None:
                raise ApiError("bot_not_found", "Bot topilmadi", field="botId", status_code=404)
            library = bot.script_library
        composed = compose(library, source)
        if len(composed.source) > SCRIPT_COMPOSED_LIMIT:
            # Named separately from the refusal above because the fix is
            # somewhere else: the file in front of the author is within its
            # ceiling and shortening it is not what would help.
            raise ApiError(
                "script_with_library_too_long",
                "Kod bot kutubxonasi bilan birga juda uzun — kutubxonani qisqartiring",
                field="source",
            )

        # The editor's budget, not the runtime's: somebody is sitting here
        # watching, and a two-second cap turns "my loop is slow" into "the panel
        # is broken". `runner._script_limits` makes the same distinction from
        # the other side.
        result = run_script(
            composed.source,
            inputs or {},
            limits=ScriptLimits(timeout_ms=8000),
            workspace_id=self.workspace.id,
        )
        # A syntax error names no line, so one is asked for separately.
        #
        # `ScriptResult.line` comes off a stack frame, and a file that does not
        # compile never produced one — so «Tekshirish» reported "Unexpected
        # number" and nothing else, while «Saqlash» reported the same fault as
        # "(986-qator)". Two buttons over one editor disagreeing about whether
        # the position of a fault is knowable, and the one that could not say it
        # is the one pressed while hunting for it.
        #
        # The save path has always asked: `sandbox.check_syntax` falls back to
        # `syntax_line`, which compiles the text with `vm.Script` purely to
        # locate the fault. This asks the same question of the same function, so
        # the two buttons cannot drift apart. Counted in the *composed* source,
        # which is what `locate` translates back into "library, line 4" or
        # "block, line 12".
        #
        # Only for `author`: an infrastructure failure has no line in the
        # author's file, and pointing at one would send them editing code that
        # is fine.
        line = result.line
        if line is None and result.kind == "author":
            line = syntax_line(composed.source)
        origin = locate(composed, line)
        return Response(
            {
                "ok": result.ok,
                "value": result.value,
                "logs": list(result.logs),
                "error": result.error,
                "kind": result.kind,
                "durationMs": result.duration_ms,
                # Translated before it leaves: the number the sandbox reported
                # counts lines of the library and the block together, and only
                # this side knows where the seam between them was.
                "where": origin.where if origin else "",
                "line": origin.line if origin else None,
            }
        )

    # ------------------------------------------------------------------
    # Import and export
    # ------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="schema")
    def schema(self, request):
        """The block vocabulary, written to be pasted into another model.

        This is the endpoint the whole import feature turns on. Somebody asks an
        AI for a flow; the AI has never seen this product; what it writes is a
        graph or it is nothing. So the answer is not a JSON Schema — it is a
        description in the language the reader will be prompted in, with the
        envelope stated first (`howTo`) and then one entry per block saying what
        its exits are called and what may go in its fields.

        Readable by any member, analysts included. It carries no tenant data at
        all — the same bytes for every workspace — and the alternative is people
        pasting a vocabulary they reconstructed by hand from a screenshot.
        """
        return Response(schema_payload())

    @action(detail=False, methods=["post"], url_path="import/validate")
    def import_validate(self, request):
        """A dry run: what is wrong with this graph, without writing anything.

        Its own endpoint rather than a flag on the import, because the two
        answer different questions and the interface asks them at different
        moments — this one runs while somebody is still looking at a file they
        pasted, and has to be safe to call on every keystroke if it comes to
        that.

        `ok` is false when there is at least one **error**. Warnings do not move
        it: a graph with three unwired branches imports perfectly well and the
        author fixes them on the canvas, which is where they can see them.

        Write roles, through `IsWorkspaceMember` — this is the first half of an
        import rather than a report, and an analyst who may not create a flow
        has nothing to do with the answer.
        """
        serializer = ImportGraphSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        graph = serializer.validated_data["graph"]

        findings = validate_graph(graph)
        return Response(
            {
                "ok": not errors_of(findings),
                "findings": [finding.as_payload() for finding in findings],
                "summary": summarise(graph),
            }
        )

    @action(detail=False, methods=["post"], url_path="import")
    def flow_import(self, request):
        """Turns an uploaded graph into a new flow.

        **Always a new flow.** There is no id in the payload and none is read
        from anywhere: an import that could land on an existing flow would
        replace a working bot's graph with a file, and whoever uploaded the file
        did not ask for that. Overwriting is `PUT /flows/<id>/graph/`, which is
        reached from the editor with the flow open in front of you.

        The order is the same one `create` uses and for the same reasons: the
        plan is checked before the write, so a refusal is something the caller
        can act on rather than an explanation arriving after the row exists —
        and an import must not be the way round a flow cap. Only the flow count
        here; what the *blocks* cost is settled when the flow is switched on
        (`enable`), so an imported graph carrying an AI block still lands and
        can be edited down to something the plan covers.

        A graph with any error is refused with the whole report rather than one
        line. This is the one caller holding a file it cannot open in the editor
        — there is no canvas to go and look at yet — so the list of what to
        change is the entire answer.

        A file may also carry the flow's own JavaScript, and it is compiled
        before it is stored — the rule `script` holds, held here too, because a
        stored file that does not compile is a set of hooks that silently never
        run. See the comment on the refusal for why a broken one takes the whole
        import down with it rather than landing quietly without its code.
        """
        serializer = ImportFlowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        graph = data["graph"]

        findings = validate_graph(graph)
        errors = errors_of(findings)
        if errors:
            # Not raised through `ApiError`: the envelope carries one message
            # and the point of this refusal is the list. The `error` key is kept
            # beside it so the interface's single error renderer still has
            # something to show without knowing about imports at all.
            return Response(
                {
                    "error": {
                        "code": "graph_invalid",
                        "message": f"Grafikda {len(errors)} ta xato bor — yuklab bo'lmadi",
                        "field": "graph",
                    },
                    "findings": [finding.as_payload() for finding in findings],
                    "summary": summarise(graph),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        bot = Bot.objects.filter(workspace=self.workspace, pk=data["botId"]).first()
        project = Project.objects.filter(workspace=self.workspace, pk=data["projectId"]).first()
        if bot is None or project is None:
            raise ApiError("not_found", "Bot yoki loyiha topilmadi", status_code=404)
        if bot.project_id != project.id:
            raise ApiError("bot_project_mismatch", "Bot bu loyihaga tegishli emas", field="botId")

        check_plan_allows(self.workspace, "flows", field="name")

        # Last of the checks, and only because it is the one that costs a Node
        # process (~117 ms): a payload that was going to be refused for its
        # graph, its bot or the plan is refused before one is spent on it.
        script = refuse_broken_script(data.get("script"))

        with transaction.atomic():
            flow = Flow.objects.create(
                workspace=self.workspace,
                project=project,
                bot=bot,
                module_key=data["moduleKey"],
                name=data.get("name") or "Yuklangan oqim",
                description=data.get("description", ""),
                nodes=graph.get("nodes") or [],
                edges=graph.get("edges") or [],
                script=script,
                # Now, and null when the file carried no code. An export carries
                # the source and not the moment it was written, so there is no
                # older timestamp to honour — and a row holding a script beside
                # an empty timestamp reads in the panel as a file nobody has
                # ever saved.
                script_updated_at=timezone.now() if script else None,
                # `kind` is one of three strings the frontend's `FlowOrigin`
                # knows; "blank" is the honest one of them for a graph nothing
                # in this product generated, and the label is what the card
                # actually shows.
                origin={"kind": "blank", "label": "JSON'dan yuklandi"},
            )
            reindex_triggers(flow)
        return Response(FlowSerializer(flow).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """The flow as a file — the other half of import, and its round trip.

        `schemaVersion` travels with it because an exported graph outlives the
        deployment that wrote it: it sits in somebody's downloads folder, or in
        a prompt, and comes back months later. Readable by any member: an export
        carries exactly what that member can already read on the canvas.

        Note what is *not* here — the id, the bot, the project, `enabled`,
        `runs`. A file that named them would read as a flow being moved rather
        than copied, and importing it somewhere else would raise the question of
        which of those two it was meant to be.

        The flow's own JavaScript *is* here, for the reason `graph` is: it is
        source the author wrote, and a file that left it behind would hand
        somebody a flow that draws the same and answers differently.
        """
        flow = self.get_object()
        payload = {
            "schemaVersion": SCHEMA_VERSION,
            "name": flow.name,
            "description": flow.description,
            "moduleKey": flow.module_key,
            "graph": {"nodes": flow.nodes, "edges": flow.edges},
        }
        # The one key left out rather than sent empty, and the file's second job
        # is why: it is pasted into a model as a worked example, and
        # `/api/flows/schema/` describes the graph and says nothing about hooks.
        # A `"script": ""` sitting in that example is an invitation to fill it
        # with JavaScript calling moments that do not exist — while a reader
        # opening the file finds every key in it holding something somebody
        # wrote. It costs the other side nothing: the guards in `import-json.ts`
        # already read an envelope key that is not there as an empty string.
        if flow.script:
            payload["script"] = flow.script
        return Response(payload)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        """The flow again, code included.

        The script is the half this used to drop, and it was the worst of the
        three places to drop it: «Nusxa olish» on a flow with fifty lines of
        hooks produced a copy that drew identically and behaved differently,
        with nothing on screen saying so. Nothing is re-compiled on the way —
        the source was checked when it was stored, and a copy of a file that
        compiled compiles.
        """
        source = self.get_object()
        copy = Flow.objects.create(
            workspace=source.workspace,
            project=source.project,
            bot=source.bot,
            module_key=source.module_key,
            name=f"{source.name} (nusxa)",
            description=source.description,
            nodes=source.nodes,
            edges=source.edges,
            script=source.script,
            # The original's timestamp and not `now`. This field says when the
            # *code* was last written, and nobody wrote a line of it by pressing
            # «Nusxa olish» — the panel prints it beside the file, so `now` would
            # tell an author that code from March changed today. When the row
            # itself came into being is `created_at`, which does move.
            script_updated_at=source.script_updated_at,
            origin=source.origin,
        )
        reindex_triggers(copy)
        return Response(FlowSerializer(copy).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "put"], url_path="script")
    def script(self, request, pk=None):
        """This flow's own JavaScript — read it, or store it once it compiles.

        Its own endpoint and not a field on the graph autosave, for two reasons
        that point the same way. The graph is written on a debounce while
        somebody types and must never be refused; a script is saved on purpose
        and *has* to be refusable. And the check costs a process launch, which
        is nothing on a button and far too much on every keystroke.

        The answer is wider than the file because the panel that opens it is.
        An author reading their hooks needs the vocabulary the runtime actually
        calls beside them, and the bot's library is the other half of what will
        run — one screen assembled from three reads is three chances to show a
        file, a library and an expression list captured at three different
        moments, and the one that arrives last is the one that looks wrong. So
        the panel opens with a single round trip, and the PUT answers the same
        payload: after a save, `declared` describes the file that was just
        stored rather than the one before it, without a second call to find
        that out.
        """
        from apps.engine.script import check_syntax

        flow = self.get_object()
        if request.method == "GET":
            return Response(_script_payload(flow))

        source = request.data.get("script")
        if not isinstance(source, str):
            raise ApiError("script_required", "Kod matni yuborilmadi", field="script")
        if len(source) > SCRIPT_LIMIT:
            raise ApiError(
                "script_too_long",
                f"Skript juda uzun — {SCRIPT_LIMIT} belgidan oshmasin",
                field="script",
            )

        broken = check_syntax(source)
        if broken:
            raise ApiError("script_syntax_error", f"Kodda xato: {broken}", field="script")

        flow.script = source
        flow.script_updated_at = timezone.now()
        flow.save(update_fields=["script", "script_updated_at", "updated_at"])
        return Response(_script_payload(flow))

    @action(detail=True, methods=["get"])
    def runs(self, request, pk=None):
        rows = self.get_object().runs_log.prefetch_related("steps")[:25]
        return Response(FlowRunSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Runs the flow for real, against a run marked as a test.

        The same walker, the same blocks, the same trace on the socket — the
        only difference is that a test run sends nothing to Telegram and is
        left out of the numbers.

        `nodeId` starts the walk anywhere in the graph, which is what the "shu
        qadamdan sinab ko'rish" button on a block card asks for: a flow that is
        eight blocks long should not have to be replayed from the top to check
        the eighth. It has to name a block this flow actually holds — a stale
        id would otherwise open a run that dies on its first step with
        "Blok topilmadi", and a refusal the editor can show beats a failed run
        it has to explain.
        """
        from apps.engine.runner import start_run

        flow = self.get_object()
        entries = flow.entry_nodes() or flow.nodes
        if not entries:
            raise ApiError("empty_flow", "Oqimda blok yo'q")

        requested = request.data.get("nodeId")
        if requested and flow.node(requested) is None:
            raise ApiError("node_not_found", "Bunday blok bu oqimda yo'q", field="nodeId", status_code=404)

        entry_id = requested or entries[0]["id"]
        run = start_run(
            flow=flow,
            entry_node_id=entry_id,
            is_test=True,
            extra_context=_tester_identity(request.user),
        )
        return Response(FlowRunSerializer(run).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="test-reply")
    def test_reply(self, request, pk=None):
        """Continues a parked test run with a typed answer or a button press."""
        from apps.engine.runner import resume_with_reply

        flow = self.get_object()
        run = FlowRun.objects.filter(flow=flow, pk=request.data.get("runId"), is_test=True).first()
        if run is None:
            raise ApiError("run_not_found", "Test seansi topilmadi", field="runId", status_code=404)
        if run.status != FlowRun.Status.WAITING:
            raise ApiError("run_not_waiting", "Bu seans javob kutmayapti")

        resume_with_reply(run, text=request.data.get("text", ""), port=request.data.get("port") or "out")
        run.refresh_from_db()
        return Response(FlowRunSerializer(run).data)


def _tester_identity(user) -> dict:
    """Who a test run is talking to.

    A test run has no `Contact`, so `_initial_context` leaves every `user.*` key
    unset — and an unset placeholder renders as itself. The tester saw
    «Assalomu alaykum, {{user.first_name}} !» while the same block in the real
    chat greeted the customer by name, and the only thing that told them apart
    was that one of them had a person behind it.

    So the panel user stands in, because in a test run they *are* the customer:
    they typed the answers, and the greeting is addressed to them. Their own
    name rather than a made-up sample, so nothing here can be mistaken for data
    the flow collected.

    Deliberately only the `user.*` identity. `mijoz_ismi` and `mijoz_telefoni`
    are answers a flow gathers, not facts about who is talking — seeding those
    would show a variable as already filled in before the block that fills it
    has run, which is the one lie a test chat must not tell.
    """
    full = (getattr(user, "name", "") or "").strip()
    first, _, last = full.partition(" ")
    username = getattr(user, "telegram_username", "") or ""
    return {
        "user.id": getattr(user, "telegram_id", None) or "",
        "user.first_name": first or "Sinovchi",
        "user.last_name": last,
        "user.username": f"@{username}" if username else "",
    }


def _script_payload(flow: Flow) -> dict:
    """Everything the Script panel opens with, read off the flow and its bot.

    `getattr(flow, "bot", None)` and not `flow.bot`: an unset relation raises
    `RelatedObjectDoesNotExist` on the attribute rather than answering None,
    and that class is an `AttributeError` subclass — which is what makes the
    default take here. A flow with no bot then reads an empty library, which is
    the truth rather than a fallback: there is no bot to have written one.
    """
    bot = getattr(flow, "bot", None)
    library = bot.script_library if bot is not None else ""
    declared = set(hooks.declared_hooks(flow.script))
    return {
        "script": flow.script,
        "scriptUpdatedAt": flow.script_updated_at,
        "library": library,
        "libraryUpdatedAt": bot.script_library_updated_at if bot is not None else None,
        # Every hook and not only the declared ones. The panel is where an
        # author finds out which moments exist at all, and a list that grew as
        # they typed could only ever offer back what they had already thought
        # of — while `HOOKS` is exactly what the runtime will call.
        "hooks": [
            {"name": hook.name, "when": hook.when, "declared": hook.name in declared} for hook in hooks.HOOKS
        ],
        "expressions": _expression_rows(flow.nodes, library),
    }


def _expression_rows(nodes: list, library: str) -> list[dict]:
    """One row per block that calls a function inside a `{{ }}`.

    A block calling none is left out entirely rather than sent with an empty
    list: this is an inventory of what the flow's text depends on, and on a
    canvas of thirty blocks the twenty-eight that only print a sentence are
    noise between the two that do arithmetic.

    `missing` is asked through `expressions.missing_functions` — a block at a
    time — instead of re-deriving "what the library declares, plus the
    builtins, plus what the driver provides" here. That set is the whole
    difference between a warning and noise (`Math.round` and `table()` are not
    the library's to declare), and a second copy of it would drift from the one
    the autosave answers with. Two implementations of one rule is how a panel
    comes to disagree with the save that follows it.
    """
    rows: list[dict] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        called = sorted(expressions.functions_in(node))
        if not called:
            continue
        rows.append(
            {
                "nodeId": str(node.get("id") or ""),
                "title": _block_title(node),
                "functions": called,
                "missing": [row["function"] for row in expressions.missing_functions([node], library)],
            }
        )
    return rows


def _block_title(node: dict) -> str:
    """What the list calls this block.

    The author's own title wherever there is one. A blank title is a naming
    choice and not a fault — most cards are never named — but a row in a list
    still has to say which block it belongs to, so it falls back to the header
    the canvas draws on that type of card, and to the id for a type this
    vocabulary does not know.
    """
    title = str(node.get("title") or "").strip()
    if title:
        return title
    block = definition(node.get("type"))
    return block.kind_label if block else str(node.get("id") or "")
