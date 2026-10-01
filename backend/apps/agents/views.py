"""Agent endpoints — the list, one agent whole, its trace, and whether the
machine can run one at all.

Tenant-scoped through `WorkspaceScopedMixin` like every other surface here, so
the isolation is not something this file can forget: an agent, its tools and
its trace all belong to a workspace, and there is no id a caller could send
that would reach another one's.

`projectId` narrows that further, and the order the two are applied in is the
whole of the isolation. The mixin filters by workspace **first**; the project
filter runs on what is left. So a `projectId` belonging to somebody else's
workspace matches nothing and the list comes back empty — it never becomes a
way to name a folder and be shown its contents.
"""

from __future__ import annotations

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin
from apps.projects.models import Project

from . import provider
from .catalogue import DEFAULT_EFFORT, DEFAULT_MODEL, EFFORT_LEVELS, MODELS
from .models import Agent, AgentRun
from .serializers import AgentRunSerializer, AgentSerializer

#: How many trace rows one request may ask for. A trace is read to answer a
#: question about one conversation, not to be exported.
MAX_RUNS = 200
DEFAULT_RUNS = 50


class AgentViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    serializer_class = AgentSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = Agent.objects.select_related("project").prefetch_related("tools").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("projectId")
        return queryset.filter(project_id=project_id) if project_id else queryset

    def _project(self, project_id: str) -> Project:
        """The named project, or the 404 that does not say whose it is.

        `Loyiha topilmadi` is the same answer for a project that never existed
        and for one belonging to another workspace, and deliberately so: an
        error that told a caller "that project exists but is not yours" is an
        error that answers questions about other people's tenants.
        """
        project = Project.objects.filter(workspace=self.workspace, pk=project_id).first()
        if project is None:
            raise ApiError("project_not_found", "Loyiha topilmadi", field="projectId", status_code=404)
        return project

    def perform_create(self, serializer):
        self._project(serializer.validated_data.get("project_id") or "")
        super().perform_create(serializer)

    def perform_update(self, serializer):
        """An agent may be moved between projects — but only inside its own tenant.

        Without this a PATCH naming another workspace's project would file the
        agent there: `workspace` would still say one thing and `project` would
        say another, which is the one way those two columns can disagree.
        """
        project_id = serializer.validated_data.get("project_id")
        if project_id:
            self._project(project_id)
        serializer.save()

    @action(detail=False, methods=["get"])
    def status(self, request):
        """Whether an agent can run here, and what it may run on.

        The same shape the script block reports: either the machine can do this
        or it cannot, and when it cannot the answer names the thing to fix
        rather than leaving a screen to guess from an empty list. `offline` is
        the third state — the whole path works and nothing leaves the machine,
        which is how the stand is driven without an account.
        """
        return Response(
            {
                "available": provider.is_available(),
                "offline": provider.is_offline(),
                "reason": provider.unavailable_reason(),
                "defaultModel": DEFAULT_MODEL,
                "defaultEffort": DEFAULT_EFFORT,
                "effortLevels": list(EFFORT_LEVELS),
                "models": [
                    {
                        "id": model.id,
                        "label": model.label,
                        "hint": model.hint,
                        "inputPricePerMTok": model.input_price_per_mtok,
                        "outputPricePerMTok": model.output_price_per_mtok,
                        "contextTokens": model.context_tokens,
                        "supportsEffort": model.supports_effort,
                    }
                    for model in MODELS
                ],
            }
        )

    @action(detail=True, methods=["get"])
    def runs(self, request, pk=None):
        """This agent's trace, newest first — every turn with every message in it.

        Read off `self.get_object()` rather than off `pk`, so the tenant check
        the mixin does is the one thing standing between a caller and somebody
        else's conversations.
        """
        agent = self.get_object()
        try:
            limit = min(int(request.query_params.get("limit", DEFAULT_RUNS)), MAX_RUNS)
        except ValueError:
            limit = DEFAULT_RUNS
        rows = (
            AgentRun.objects.filter(agent=agent)
            .select_related("contact")
            .prefetch_related("messages")[: max(limit, 1)]
        )
        return Response(AgentRunSerializer(rows, many=True).data)
