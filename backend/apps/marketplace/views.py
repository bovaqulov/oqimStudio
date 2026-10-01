"""Market endpoints: browse, review, install.

Installing copies the template's graph into a new flow. The flow that comes out
has no link back — a template improving later must never change a bot that is
already answering customers.

That copy is a write into `Flow.nodes`, so it answers to the same rule as every
other one: `flows.serializers.refuse_unwalkable_graph`. See
`_refuse_a_broken_template` for why a shelf nobody can publish to still needs
the check.
"""

from __future__ import annotations

from django.db.models import F
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.bots.models import Bot
from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, resolve_workspace
from apps.flows.models import MODULE_CHOICES, Flow
from apps.flows.serializers import FlowSerializer, refuse_unwalkable_graph
from apps.flows.services import reindex_triggers

from .models import MarketTemplate, TemplateReview
from .serializers import TemplateDetailSerializer, TemplateSerializer


def _installed_ids_for(workspace) -> set[str]:
    """Which templates this workspace has installed.

    `install` stamps the new flow with `origin = {"kind": "template", "key":
    <template id>}` and keeps no other record — the flow is a copy, deliberately
    not a live dependency (see the module docstring) — so the origin is the only
    place the fact lives. A flow deleted afterwards takes the fact with it,
    which is the right answer: nothing of that install is left in the workspace.
    """
    origins = Flow.objects.filter(workspace=workspace, origin__kind="template").values_list("origin", flat=True)
    return {origin.get("key") for origin in origins if isinstance(origin, dict) and origin.get("key")}


def _installed_template_ids(request) -> set[str]:
    """The same set for whichever workspace the request resolved to.

    A request that names no workspace it belongs to never reaches here —
    `IsWorkspaceMember` refuses first — but the serializer is also used from a
    shell and from the admin, where there is no request at all, so this stays
    tolerant of one that cannot resolve.
    """
    try:
        workspace, _ = resolve_workspace(request)
    except Exception:  # noqa: BLE001 - no workspace simply means nothing is installed
        return set()
    return _installed_ids_for(workspace)


def _refuse_a_broken_template(template: MarketTemplate) -> None:
    """Refuses to install a template the runtime could not walk.

    The same rule every other door into `Flow.nodes` applies
    (`flows.serializers.refuse_unwalkable_graph`), because a graph does not
    become safe by the URL it arrived on. Installing writes the blocks verbatim
    and then `reindex_triggers` builds the match index off them, so a template
    naming a block type that does not exist becomes a bot that matches a
    command, walks to the entry block, finds no edge on the port it is looking
    for, and goes silent — with nothing anywhere saying why.

    Today `MarketTemplate.nodes` has no API write path: templates come from
    `seed_demo`, the Django admin or the database. So this is a door that is
    shut rather than one standing open — and it is worth shutting now, because
    `is_published` and `owner_workspace` are already on the model and `?mine=1`
    already serves a workspace its own shelf. The endpoint that lets somebody
    publish a flow as a template is the obvious next feature, and on the day it
    lands this check is either here or it is not.

    Reworded rather than re-raised as-is. `refuse_unwalkable_graph` writes for
    an author looking at their own canvas; the person who reaches this line
    pressed «install» on somebody else's work and did nothing wrong. So the
    message says the template is at fault and keeps the reason on the end,
    where whoever maintains the shelf can act on it.
    """
    try:
        refuse_unwalkable_graph(template.nodes or [], template.edges or [])
    except serializers.ValidationError as exc:
        raise ApiError(
            "template_invalid",
            f"Bu shablonni o'rnatib bo'lmadi — u buzilgan. Sabab: {_reason(exc)}",
            field="id",
        ) from exc


def _reason(exc: serializers.ValidationError) -> str:
    """The one sentence out of DRF's detail map, whichever half it landed under."""
    detail = exc.detail
    if isinstance(detail, dict):
        for value in detail.values():
            return str(value[0] if isinstance(value, list) and value else value)
    return str(detail)


class TemplateViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsWorkspaceMember]
    queryset = MarketTemplate.objects.filter(is_published=True).prefetch_related("reviews")

    def get_serializer_class(self):
        return TemplateSerializer if self.action == "list" else TemplateDetailSerializer

    def get_serializer_context(self):
        """The ids this workspace has already installed, counted once.

        An install writes `Flow.origin = {"kind": "template", "key": <id>}` and
        nothing else records the fact, so that is what "installed" is read from
        — one query for the whole page instead of one per row.
        """
        context = super().get_serializer_context()
        context["installed_ids"] = _installed_template_ids(self.request)
        return context

    def get_queryset(self):
        queryset = super().get_queryset()
        # `?mine=1` is the workspace's own shelf: what it published, including
        # anything still unpublished, which the public list never shows.
        if self.request.query_params.get("mine") in {"1", "true"}:
            workspace, _ = resolve_workspace(self.request)
            return MarketTemplate.objects.filter(owner_workspace=workspace).prefetch_related("reviews")

        category = self.request.query_params.get("category")
        module_key = self.request.query_params.get("moduleKey")
        search = self.request.query_params.get("q")
        if category and category != "all":
            queryset = queryset.filter(category=category)
        if module_key:
            queryset = queryset.filter(module_key=module_key)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset

    @action(detail=True, methods=["post"])
    def install(self, request, pk=None):
        workspace, _ = resolve_workspace(request)
        template = self.get_object()
        bot = Bot.objects.filter(workspace=workspace, pk=request.data.get("botId")).select_related("project").first()
        if bot is None:
            raise ApiError("bot_not_found", "Bot topilmadi", field="botId", status_code=404)

        module_key = request.data.get("moduleKey") or template.module_key
        if module_key not in dict(MODULE_CHOICES):
            raise ApiError("invalid_module", "Noma'lum bo'lim", field="moduleKey")

        _refuse_a_broken_template(template)

        flow = Flow.objects.create(
            workspace=workspace,
            project=bot.project,
            bot=bot,
            module_key=module_key,
            name=template.name,
            description=template.description,
            nodes=template.nodes,
            edges=template.edges,
            origin={"kind": "template", "key": template.id, "label": f"Shablon · {template.name}"},
        )
        reindex_triggers(flow)
        MarketTemplate.objects.filter(pk=template.pk).update(installs=F("installs") + 1)
        return Response(FlowSerializer(flow).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        template = self.get_object()
        # A review is a report from use, so it is owed by somebody who used it.
        # Without this the catalogue's own numbers are open to anybody who can
        # open the sheet: a rating is the only signal on this screen a reader
        # has no other way to check, and one left by somebody who never
        # installed the template is not about the template.
        workspace, _ = resolve_workspace(request)
        if template.pk not in _installed_ids_for(workspace):
            raise ApiError(
                "not_installed",
                "Sharh qoldirish uchun avval shablonni o'rnating.",
                field="id",
                status_code=403,
            )
        rating = int(request.data.get("rating") or 0)
        if not 1 <= rating <= 5:
            raise ApiError("invalid_rating", "Bahoni 1 dan 5 gacha bering", field="rating")
        record = TemplateReview.objects.create(
            template=template,
            user=request.user,
            author_name=request.user.name,
            rating=rating,
            text=(request.data.get("text") or "")[:500],
        )
        return Response({"id": record.id, "rating": record.rating}, status=status.HTTP_201_CREATED)
