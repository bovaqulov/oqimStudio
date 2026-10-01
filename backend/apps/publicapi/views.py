"""`/api/v1/` — the surface an outside program is allowed to depend on.

## Why this is not an alias of `/api/…`

Because an alias is not a version. `/api/flows/` is the editor's own endpoint
and it moves when the editor moves: a field is added because a card needs it, a
serializer is split because a list got expensive, a query parameter changes
meaning. Every one of those is a perfectly ordinary internal change and every
one of them breaks a CRM that was pointed at the same URL — and it breaks it
silently, weeks later, in somebody else's deployment.

So the routes are separate and the views are their own. What is *shared* is
deliberately chosen and it is the part that must never diverge:

- `flows.serializers.FlowSerializer` / `FlowSummarySerializer` — one payload
  shape. A second copy would drift field by field until a graph exported here
  could not be re-imported there.
- `flows.serializers.GraphSerializer` — it calls `refuse_unwalkable_graph`. A
  graph the editor is refused must not walk in through the open door.
- `flows.serializers.ImportFlowSerializer` — same envelope, same graph check.
- `flows.graph_validation` — the findings report, unchanged.
- `flows.services.reindex_triggers` — a graph nobody indexed is a flow that
  looks saved and answers nothing.
- `billing.services.check_plan_allows` — a limit reachable round the side is
  not a limit.
- `bots.serializers.BotListSerializer`, `contacts.serializers.ContactSerializer`
  — same reason as the flow payloads.

What is *not* shared is the routing and the choice of which endpoints exist at
all. That is the seam: the internal API can gain, lose or rename an endpoint
tomorrow and nothing here changes, because nothing here points at one.

## The six endpoints

```
GET    /api/v1/me/                    (any live key)
GET    /api/v1/flows/                 flows:read
GET    /api/v1/flows/<id>/            flows:read      graph included
POST   /api/v1/flows/import/          flows:write
PUT    /api/v1/flows/<id>/graph/      flows:write
GET    /api/v1/bots/                  bots:read
GET    /api/v1/contacts/              contacts:read
```

Seven and no more. Every endpoint here is a promise to keep working, and the
way to keep few promises is to make few. `me/` is the one that is not about
this product's data at all — it is about the credential in the caller's hand,
and `KeyIdentityView` argues below why that earns a line here.

## The tenant

`self.workspace` is `request.auth.workspace` and it is read from the key, never
from the request. There is no code path in this file that turns a header into a
workspace — `HasApiKeyScope` only *compares* one, and answers 404 when it
disagrees. The isolation therefore does not depend on any view remembering to
filter correctly; it depends on there being no other workspace available to
filter by.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.metadata import SimpleMetadata
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.apikeys.authentication import ApiKeyAuthentication
from apps.apikeys.permissions import HasApiKeyScope, IsApiKey
from apps.apikeys.throttling import ApiKeyThrottle, rate_per_minute
from apps.billing.services import check_graph_allows, check_plan_allows
from apps.bots.models import Bot
from apps.bots.serializers import BotListSerializer
from apps.common.exceptions import ApiError
from apps.contacts.models import Contact
from apps.contacts.serializers import ContactSerializer
from apps.flows.graph_validation import errors_of, summarise, validate_graph
from apps.flows.models import Flow, FlowRun
from apps.flows.serializers import (
    FlowSerializer,
    FlowSummarySerializer,
    GraphSerializer,
    ImportFlowSerializer,
)
from apps.flows.services import refuse_broken_script, reindex_triggers
from apps.projects.models import Project


class PublicApiMetadata(SimpleMetadata):
    """What `OPTIONS` on one of these paths is allowed to say.

    DRF's default answer includes the view's **docstring**, rendered as
    `description`. The docstrings in this file are design arguments written in
    English for whoever edits them next — the reasoning about webhook tokens,
    about plan limits, about what an alias would cost — and every one of them
    was being handed to any key holder who sent an `OPTIONS`. Nothing
    catastrophic and nobody decided it, which is the same shape as the
    technical 404 page.

    What replaces it is the two facts a caller actually wants from an
    `OPTIONS`: which methods this path takes, and which scope it needs. The
    second is not a leak — the key already holds a fixed set of scopes and the
    403 names the missing one anyway — and it turns an accident into the one
    place a program can ask "may I, before I try".
    """

    def determine_metadata(self, request, view) -> dict:
        return {
            "path": request.path,
            "methods": sorted(view.allowed_methods),
            "scope": getattr(view, "required_scope", "") or None,
        }


class PublicApiMixin:
    """Authentication, scope and budget for every endpoint under `/api/v1/`.

    `authentication_classes` is set here and names one class, which is the
    other half of the promise in `apikeys.authentication`: a session cookie or
    a DRF token is not accepted on this surface. That is not tidiness — it is
    what makes "a key sees one workspace" checkable. If a panel credential
    could also arrive here, every view would need a second branch for a caller
    with memberships, and the tenant would stop being a property of the
    endpoint.
    """

    authentication_classes = [ApiKeyAuthentication]
    permission_classes = [HasApiKeyScope]
    throttle_classes = [ApiKeyThrottle]
    metadata_class = PublicApiMetadata

    #: Overridden by every view. `HasApiKeyScope` refuses a view that leaves it
    #: unset rather than assuming one, so a new endpoint cannot be born open.
    required_scope = ""

    @property
    def workspace(self):
        return self.request.auth.workspace


class WalkableListMixin(PublicApiMixin):
    """A list whose pages can be walked without losing rows.

    The panel never needs this and so never asked for it: a screen renders
    fifty rows and a human scrolls. Every list on this surface exists to be
    *walked* — `?limit=`/`?offset=` until `next` is null is the shape of a CRM
    sync and of a model reading a workspace — and offset paging is only correct
    over an order that is **total** (no ties a database may break differently
    twice) and **stable** (no column that moves while the walk is in progress).

    The models' own `Meta.ordering` is neither, because it was written for the
    panel and is right there: `Contact` is ordered by `-last_seen_at`, which is
    rewritten on every incoming Telegram message. A customer writing to the bot
    between page one and page two moves to the front of the list, everything
    behind them shifts by one, and the row at the page boundary is served twice
    or never — a sync that silently skips people, with nothing on either side
    reporting it.

    So the public lists re-order on a column that does not move, with the
    primary key behind it to break ties. `PublicApiTests` and
    `PublicApiPagingTests` hold both halves.

    This does not make the walk transactional and nothing short of a cursor
    would: rows *created* during it still shift the offsets under it. What it
    removes is the case where an existing row disappears from the walk
    entirely — with an insert-ordered list the drift only ever repeats a row,
    which an upsert absorbs.
    """

    #: The stable ordering. Ends with the primary key, always.
    walk_order: tuple[str, ...] = ("id",)

    def filter_queryset(self, queryset):
        """Applied here and not in `get_queryset`, on purpose.

        Every view below writes its own `get_queryset` — the filters it takes
        are half of what it is — so an ordering put there would have to be
        remembered three times and would be missing from the fourth. DRF calls
        `filter_queryset` on whatever `get_queryset` returned, which is the
        same hook `OrderingFilter` uses, so this one line covers every list on
        this surface and every one added later.
        """
        return super().filter_queryset(queryset).order_by(*self.walk_order)


class FlowListView(WalkableListMixin, generics.ListAPIView):
    """The workspace's flows, without their graphs.

    Summaries and not whole flows, matching what the panel's own list does and
    for the same reason: a workspace with two hundred flows would otherwise
    send every block of every one of them to answer "what have I got". The
    graph is one request away, per flow, which is also the shape a caller
    walking the list actually wants.
    """

    required_scope = "flows:read"
    serializer_class = FlowSummarySerializer
    #: Not the model's `-updated_at`: an autosave in the editor moves a flow to
    #: the front while somebody is paging past it. Creation order does not
    #: move, and for a list this short the difference only shows on the walk.
    walk_order = ("-created_at", "id")

    def get_queryset(self):
        queryset = Flow.objects.select_related("bot", "project").filter(workspace=self.workspace)
        params = self.request.query_params
        # The same three filters the panel's list takes, spelled the same way.
        # Nothing here widens the query — each one only ever narrows it inside
        # the workspace the key names.
        for param, field in (("botId", "bot_id"), ("moduleKey", "module_key"), ("projectId", "project_id")):
            if params.get(param):
                queryset = queryset.filter(**{field: params[param]})
        return queryset


class FlowDetailView(PublicApiMixin, generics.RetrieveAPIView):
    """One flow with its blocks — what an AI reads before rewriting it."""

    required_scope = "flows:read"
    serializer_class = FlowSerializer

    def get_queryset(self):
        # The filter *is* the isolation: a flow id belonging to another tenant
        # is not "forbidden", it is not in this queryset at all, so nothing
        # here has to decide that — there is no branch to get wrong.
        return Flow.objects.select_related("bot", "project").filter(workspace=self.workspace)

    def get_object(self):
        """The same 404 the write endpoints give, in the same words.

        DRF's own miss answers «No Flow matches the given query.» under the
        generic code `error`. That is tolerable inside the panel, where the
        reader is looking at a screen that already told them what went wrong;
        it is not tolerable on an API whose whole audience is code branching on
        `error.code`, and where an English sentence sits beside Uzbek ones from
        the endpoint next door.
        """
        flow = self.get_queryset().filter(pk=self.kwargs["pk"]).first()
        if flow is None:
            raise ApiError("flow_not_found", "Oqim topilmadi", status_code=404)
        return flow


class FlowImportView(PublicApiMixin, APIView):
    """A graph from outside, filed as a new flow.

    Every rule the panel's importer applies, applied here in the same order and
    by the same code:

    - `validate_graph` first, and the *whole* findings report on refusal. This
      caller is the one holding a file it cannot open on a canvas — the list of
      what to change is the entire answer, not the first line of it.
    - `check_plan_allows` **before** the write, so a 402 is a refusal somebody
      can act on rather than an explanation arriving after the row exists. An
      import must not be the way round a flow cap, and an import through a key
      must not be the way round the way round.
    - `reindex_triggers` inside the same transaction as the create, so a flow
      never exists with a trigger index that does not match its graph.

    Always a new flow, never a replacement, and there is no flow id in the
    payload to make one possible — same as `/api/flows/import/`. Replacing is
    `PUT /api/v1/flows/<id>/graph/`, where the caller has had to name the flow
    they mean.

    It lands **disabled**, like every imported flow. A program that can upload
    a graph cannot thereby put a bot in front of customers; switching a flow on
    is a decision that stays in the panel, which is also why there is no
    `enable` in this API.
    """

    required_scope = "flows:write"

    def post(self, request):
        serializer = ImportFlowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        graph = data["graph"]

        findings = validate_graph(graph)
        errors = errors_of(findings)
        if errors:
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

        # Through the same function the panel's importer calls, because this
        # endpoint shares its serializer: the moment `ImportFlowSerializer` grew
        # a `script` field, this view began accepting one and dropping it on the
        # floor — a documented-looking key that stored a flow without the code
        # uploaded with it and said nothing. Last of the checks, because it is
        # the only one here that costs a Node process.
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
                # Null when there is no script: the row would otherwise read in
                # the panel as a file somebody saved and then emptied.
                script_updated_at=timezone.now() if script else None,
                # The same three-value `FlowOrigin` the cards render, with a
                # label that says where it came from — an admin looking at the
                # list should be able to see which flows an integration wrote.
                origin={"kind": "blank", "label": "API orqali yuklandi"},
            )
            reindex_triggers(flow)
        return Response(FlowSerializer(flow).data, status=status.HTTP_201_CREATED)


class FlowGraphView(PublicApiMixin, APIView):
    """Replaces one flow's blocks.

    `GraphSerializer` is the whole validation story and that is the point of
    reusing it: it calls `refuse_unwalkable_graph`, so a block type that does
    not exist or an edge leaving a port nobody publishes is refused here in the
    same words the editor's autosave is refused in. The rule was written
    because a graph could reach the table through a quieter endpoint than the
    one it was written for; this is the quietest endpoint in the product, and
    it goes through the same door.

    **One rule is stricter here than in the panel, deliberately.** The editor's
    autosave does not check the AI-block limit — refusing it would lock an
    author out of the very edit that removes the blocks. That argument is about
    somebody typing, and there is nobody typing here. So when the flow is
    already **enabled** — the moment its blocks actually cost something, which
    is what `enable` checks in the panel — the incoming graph is checked with
    `check_graph_allows`. It cannot trap anyone: the check counts the *new*
    graph and excludes this flow from the total, so a call that removes AI
    blocks always passes. What it stops is the one thing an open API would
    otherwise make free — pushing ten AI blocks into a flow that is already
    answering customers, past a cap the panel enforces.

    A disabled flow is left alone, exactly as the panel leaves it: an unstarted
    flow costs nothing and the limit is spent when somebody switches it on.
    """

    required_scope = "flows:write"

    def put(self, request, flow_id: str):
        flow = Flow.objects.filter(workspace=self.workspace, pk=flow_id).first()
        if flow is None:
            raise ApiError("flow_not_found", "Oqim topilmadi", status_code=404)

        serializer = GraphSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if flow.enabled:
            check_graph_allows(self.workspace, serializer.validated_data["nodes"], flow_id=flow.id)

        with transaction.atomic():
            flow.nodes = serializer.validated_data["nodes"]
            flow.edges = serializer.validated_data["edges"]
            fields = ["nodes", "edges", "updated_at"]
            # Written only when sent, the same as the panel's save: a caller
            # replacing a graph and nothing else must not blank a name by
            # leaving it out of the body.
            for field in ("name", "description"):
                if field in serializer.validated_data:
                    setattr(flow, field, serializer.validated_data[field])
                    fields.append(field)
            flow.save(update_fields=fields)
            triggers = reindex_triggers(flow)
        return Response({**FlowSerializer(flow).data, "triggerCount": triggers})


class BotListView(WalkableListMixin, generics.ListAPIView):
    """The workspace's bots.

    `BotListSerializer` and not `BotSerializer`, and the choice matters more
    here than it does in the panel: the list payload has no `webhookUrl` on it.
    The detail one does, and a webhook URL carries the bot's `webhook_token` —
    the single secret standing between the open internet and the ability to
    feed this bot fabricated updates. A `bots:read` scope is for finding out
    which bots exist and what they are called, and it stops there. The token
    itself has never been on any serializer (`/reveal-token/`), and there is no
    equivalent of that endpoint in this API at all.
    """

    required_scope = "bots:read"
    serializer_class = BotListSerializer
    #: `handle` is what the panel sorts by and it does not move on its own —
    #: the primary key behind it is only there to make the order total, since
    #: two bots can share a handle before one of them is connected.
    walk_order = ("handle", "id")

    def get_queryset(self):
        queryset = Bot.objects.select_related("project").filter(workspace=self.workspace)
        project_id = self.request.query_params.get("projectId")
        return queryset.filter(project_id=project_id) if project_id else queryset


class ContactListView(WalkableListMixin, generics.ListAPIView):
    """The people who have written to this workspace's bots.

    The annotation is the panel's, copied rather than approximated: without it
    `sourceFlowName` and `sourceFlowId` would come back empty here and filled
    in there, which is the quiet kind of divergence that ends with somebody
    building a report on a field that is blank for half its callers.
    """

    required_scope = "contacts:read"
    serializer_class = ContactSerializer
    #: The one that mattered. `-last_seen_at` is rewritten by every message the
    #: bot receives; `first_seen_at` is written once, when the person first
    #: wrote in, and never again. Newest customers first is also the order a
    #: sync wants — the rows it has not seen before are at the top.
    walk_order = ("-first_seen_at", "id")

    def get_queryset(self):
        first_run = FlowRun.objects.filter(contact=OuterRef("pk")).order_by("started_at")
        queryset = (
            Contact.objects.select_related("bot")
            .prefetch_related("tags")
            .filter(workspace=self.workspace)
            .annotate(
                source_flow_name=Subquery(first_run.values("flow__name")[:1]),
                source_flow_id=Subquery(first_run.values("flow_id")[:1]),
            )
        )
        params = self.request.query_params
        if params.get("botId"):
            queryset = queryset.filter(bot_id=params["botId"])
        if params.get("projectId"):
            # A workspace can hold two businesses, and their customers are two
            # lists — a privacy line before it is a usability one.
            queryset = queryset.filter(bot__project_id=params["projectId"])
        return queryset


class KeyIdentityView(PublicApiMixin, APIView):
    """What this key is, in this key's own words. `GET /api/v1/me/`.

    ## Why an endpoint for something the panel already shows

    Because the panel is not where the integration is. A key is pasted into a
    config file on somebody else's machine, and until this existed the first
    thing that told its holder anything about it was a real request — which
    meant the first symptom of the wrong key was a `403` naming a scope, when
    the actual mistake was often the *workspace*: two keys, two tenants, one
    clipboard. A 403 that says «`flows:read` doirasi kerak» sends that person
    to tick a box, and the box was never the problem.

    So this answers the two questions a start-up check has: *am I who I think I
    am* — the key's name and the workspace it acts in, which is where a wrong
    paste becomes obvious — and *what may I do*, which is the scope list a
    client can branch on before it builds a request it cannot send.

    ## No scope, deliberately

    `IsApiKey` and not `HasApiKeyScope`: a key missing `flows:read` is exactly
    the key whose holder is asking what went wrong, and an endpoint that
    answered only the keys that did not need it would be decoration. Every
    other rule still applies — a revoked key is `401` at authentication, and
    `X-Workspace-Id` naming another tenant is `404` before this method runs.

    ## Nothing secret, and the list is deliberate

    Not the key: it left the server once, in the create response, and this
    endpoint does not have it either — authentication only ever holds the
    digest. Not the digest. Not `createdBy`, which is a person's name and has
    no business travelling to whatever machine holds the key. And **not the
    other keys in this workspace**: holding one credential is not grounds for
    enumerating its neighbours, which is the difference between "what am I"
    and a key-management API this surface deliberately does not have.

    `prefix` is the one identifying string here, and it is the same four
    characters the panel's own list shows — enough for a human comparing this
    answer to that screen, and ~166 bits short of the key.
    """

    required_scope = ""
    permission_classes = [IsApiKey]

    def get(self, request):
        key = request.auth
        return Response(
            {
                "id": key.id,
                "name": key.name,
                "prefix": key.prefix,
                "scopes": key.scope_list,
                "workspaceId": key.workspace_id,
                "workspaceName": key.workspace.name,
                "createdAt": key.created_at,
                # The same column the panel's list renders, and the reason
                # it is here: an integration that logs this on boot leaves a
                # record of when it last actually worked. Written at most once
                # a minute (`ApiKey.TOUCH_INTERVAL`), so it is "recently" and
                # not a request log — including for this very call.
                "lastUsedAt": key.last_used_at,
                # Stated rather than left to be discovered by hitting it — and
                # per workspace rather than per key, which is the part a caller
                # cannot guess and the part that explains a 429 arriving while
                # this key sat idle (`apikeys.throttling`).
                "rateLimit": {"perMinute": rate_per_minute(), "scope": "workspace"},
            }
        )
