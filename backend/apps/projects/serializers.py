"""Project payloads — camelCase, matching `features/projects/types.ts`.

The three count labels the card shows are computed here rather than stored:
they are a view of the flows and contacts that already exist, and a stored copy
would be one more thing that can go stale.
"""

from __future__ import annotations

from django.utils.text import slugify
from rest_framework import serializers

from apps.common.models import new_id
from apps.contacts.models import Contact

from .models import Project, ProjectActivity


class ProjectSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    status = serializers.SerializerMethodField()
    flowCountLabel = serializers.SerializerMethodField()
    contactCountLabel = serializers.SerializerMethodField()
    channelsLabel = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    createdBy = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "workspaceId", "name", "handle", "icon", "tag", "status", "description",
            "flowCountLabel", "contactCountLabel", "channelsLabel", "createdAt", "createdBy",
        ]
        read_only_fields = ["id", "workspaceId", "handle", "createdAt", "createdBy"]

    def get_status(self, project: Project) -> dict:
        return {"label": project.status, "tone": project.status_tone}

    # The three counts come from the queryset's annotations (see
    # `ProjectViewSet.get_queryset`); counting them here instead would be three
    # more queries for every row of the list.
    def get_flowCountLabel(self, project: Project) -> str:  # noqa: N802
        return f"{getattr(project, 'flow_count', None) or project.flows.count()} oqim"

    def get_contactCountLabel(self, project: Project) -> str:  # noqa: N802
        count = getattr(project, "contact_count", None)
        if count is None:
            count = Contact.objects.filter(bot__project=project).count()
        return f"{count} kontakt"

    def get_channelsLabel(self, project: Project) -> str:  # noqa: N802
        return f"{getattr(project, 'bot_count', None) or project.bots.count()} bot"

    def get_createdBy(self, project: Project) -> str:  # noqa: N802
        # The name, not the email: a Telegram-born account's address is the
        # synthetic `tg<id>@telegram.local`, which is plumbing, not a person.
        creator = project.created_by
        if not creator:
            return ""
        return creator.name or creator.email

    def create(self, validated_data) -> Project:
        workspace = validated_data["workspace"]
        base = slugify(validated_data["name"])[:48] or "loyiha"
        handle = base
        while Project.objects.filter(workspace=workspace, handle=handle).exists():
            handle = f"{base}-{new_id()[:4]}"
        validated_data["handle"] = handle
        validated_data.setdefault("id", f"{workspace.id}-{handle}"[:64])
        return super().create(validated_data)


class ProjectActivitySerializer(serializers.ModelSerializer):
    when = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = ProjectActivity
        fields = ["id", "subject", "text", "icon", "when"]
