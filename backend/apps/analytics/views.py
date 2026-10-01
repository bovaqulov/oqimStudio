"""Analytics endpoints.

The tenant comes from the session and never from the request, so no client can
ask for another workspace's numbers by editing a parameter. Same query
parameters in, same `AnalyticsReport` JSON out as the interface already reads.
"""

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.bots.models import Bot
from apps.common.tenancy import IsWorkspaceMember, resolve_workspace
from apps.flows.models import Flow
from apps.projects.models import Project

from .models import TRAFFIC_SOURCES
from .services import MODULE_LABELS, build_report, parse_query


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def report(request):
    workspace, _ = resolve_workspace(request)
    query = parse_query(request.query_params, workspace)
    return Response(build_report(workspace, query))


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def dimensions(request):
    """What the filter bar can offer, derived from this workspace's own records."""
    workspace, _ = resolve_workspace(request)
    return Response(
        {
            "projects": [
                {"id": row.id, "label": row.name} for row in Project.objects.filter(workspace=workspace)
            ],
            "bots": [
                {"id": row.id, "label": row.handle, "parentId": row.project_id}
                for row in Bot.objects.filter(workspace=workspace)
            ],
            "flows": [
                {"id": row.id, "label": row.name, "parentId": row.bot_id}
                for row in Flow.objects.filter(workspace=workspace)
            ],
            "sources": [{"id": key, "label": label} for key, label in TRAFFIC_SOURCES],
            "channels": [{"id": key, "label": label} for key, label in MODULE_LABELS.items()],
        }
    )
