"""Project endpoints."""

from __future__ import annotations

from django.db.models import Count
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.analytics.models import Event, Metric
from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin

from .models import Project
from .serializers import ProjectActivitySerializer, ProjectSerializer


#: The icon each measure gets in the feed. The names are the product's own set
#: (`components/ui/icon-names.ts`); an unlisted metric falls back rather than
#: rendering a hole, because a new metric must not be able to break this screen.
ACTIVITY_ICONS = {
    Metric.CONVERSATION: "chat-teardrop-text",
    Metric.NEW_CONTACT: "user-plus",
    Metric.MESSAGE: "paper-plane-tilt",
    Metric.CLICK: "cursor-click",
    Metric.HANDOFF: "headset",
    Metric.CONVERSION: "target",
    Metric.REVENUE: "credit-card",
}


def _activity_row(event, names: dict[str, str]) -> dict:
    """One analytics event, in the shape the Faoliyat tab already renders.

    The subject is the measure's own Uzbek label — `Metric.choices` has carried
    those since the analytics screen was built, so nothing new had to be named
    here. The text says *where* it happened, because a project with four bots in
    it has a feed that means nothing without them.

    Names and not ids: `4614b732f093063f` identifies a flow to the database and
    to nobody else, and a column of those is a feed a reader scrolls past. An id
    with no name behind it is printed as itself rather than dropped — a flow
    deleted since is still something that happened.
    """
    label = Metric(event.metric).label if event.metric in Metric.values else event.metric
    where = " · ".join(
        names.get(part, part) for part in (event.bot_id, event.flow_id) if part
    )
    return {
        "id": event.id,
        "subject": label,
        "text": where or "—",
        "icon": ACTIVITY_ICONS.get(event.metric, "flow-arrow"),
        "when": event.occurred_at.isoformat(),
    }


def _activity_names(project) -> dict[str, str]:
    """Bot and flow ids to the names a reader knows them by.

    Two queries for the whole page rather than one per row: the feed is fifty
    events over a handful of bots and flows, and resolving each one where it is
    printed is how a list turns into fifty round trips.
    """
    names = {bot.id: bot.handle or bot.id for bot in project.bots.all()}
    names.update({flow.id: flow.name for flow in project.flows.all()})
    return names


class ProjectViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = (
        Project.objects.select_related("workspace", "created_by")
        .annotate(
            flow_count=Count("flows", distinct=True),
            bot_count=Count("bots", distinct=True),
            contact_count=Count("bots__contacts", distinct=True),
        )
        .all()
    )

    def perform_create(self, serializer):
        serializer.save(workspace=self.workspace, created_by=self.request.user)

    def perform_destroy(self, instance):
        """Only an empty project. Everything else is a cascade nobody asked for.

        `Bot.project`, `Flow.project` and `Agent.project` are all `CASCADE`, so
        deleting a folder here would silently take the bots answering customers
        inside it — and their flows, their runs and their contacts with them.
        The panel has said "move them first" since before there was anything
        behind the button; this is that sentence becoming true.

        `agents` joined the list the day an agent stopped belonging to the
        workspace and started belonging to a project. It is named separately in
        the message rather than folded into "bot yoki oqim", because a project
        holding *only* agents is the case this would otherwise miss entirely:
        both other counts are zero, the delete goes through, and a persona
        somebody wrote is gone with no warning that it was ever there.
        """
        held = {
            "bot": instance.bots.count(),
            "oqim": instance.flows.count(),
            "agent": instance.agents.count(),
        }
        present = [name for name, count in held.items() if count]
        if present:
            raise ApiError(
                "project_not_empty",
                f"Loyihada {', '.join(present)} bor — "
                "o'chirishdan avval ularni boshqa loyihaga ko'chiring.",
                status_code=409,
            )
        instance.delete()

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        """What has happened in this project, newest first.

        Read from `analytics.Event` and not from `ProjectActivity`, which is the
        table this used to return. That model's docstring says "written by the
        app, never edited by hand" — and grepping every writer in the backend
        finds exactly one, `seed_demo`. Nothing in the runtime, the engine or
        any view has ever appended a row to it. So the tab said «Hali hodisa
        yo'q» while Analitika, on the same screen's sibling, listed four
        conversations and six button presses of the *same events*: sixteen rows
        in `analytics.Event`, every one of them carrying this project's id.

        The events are already there and already attributed, so this reads them
        rather than adding a second thing to write. That also means the feed
        cannot drift from the numbers beside it — the two are now one source,
        which is the whole reason a reader trusts either.

        `ProjectActivity` is deliberately left in place: rows a demo seeded are
        still that project's history, and merging them is one union rather than
        a migration that throws them away.
        """
        project = self.get_object()
        events = Event.objects.filter(workspace=project.workspace, project_id=project.id)[:50]
        names = _activity_names(project)
        rows = [_activity_row(event, names) for event in events]
        rows += ProjectActivitySerializer(project.activity.all()[:50], many=True).data
        # One list, newest first, however the two halves were ordered. `when` is
        # a serialized string on one side and a datetime on the other, and both
        # are ISO-8601 in UTC — which sorts correctly as text.
        rows.sort(key=lambda row: str(row["when"]), reverse=True)
        return Response(rows[:50])
