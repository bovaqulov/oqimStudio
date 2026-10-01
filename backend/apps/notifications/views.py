"""Notification endpoints. The live copies arrive on the workspace socket."""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin, resolve_workspace
from apps.workspaces.models import Role

from .models import Notification, NotificationSettings
from .serializers import NotificationSerializer, NotificationSettingsSerializer

#: Who may change what the workspace hears. The same two roles that own the
#: rest of its settings — and the refusal names them, because a control that is
#: merely hidden teaches an editor that the feature is broken rather than that
#: it is somebody else's.
MANAGE_ROLES = {Role.OWNER, Role.ADMIN}
MANAGE_ONLY = "Bildirishnomalarni faqat ish maydoni egasi yoki admini o'zgartira oladi"


class NotificationViewSet(
    WorkspaceScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    serializer_class = NotificationSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = Notification.objects.all()

    def get_queryset(self):
        # Workspace-wide notices plus the ones addressed to this person.
        return super().get_queryset().filter(Q(user__isnull=True) | Q(user=self.request.user))

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True, "updated": count})

    @action(detail=False, methods=["get"])
    def unread(self, request):
        return Response({"count": self.get_queryset().filter(read_at__isnull=True).count()})


@api_view(["GET", "PATCH"])
@permission_classes([IsWorkspaceMember])
def notification_settings(request):
    """Which notices this workspace raises.

    The GET does not create the row. A settings screen renders more often than
    the reader asked for — a prefetch, a double render in development, a
    refresh — and a read that writes is a read that has already been spent by
    whatever fetched the page first. Defaults come off an unsaved instance
    instead, which is also the truthful answer: no row *is* everything on.
    """
    workspace, membership = resolve_workspace(request)
    row = NotificationSettings.objects.filter(workspace=workspace).first()

    if request.method == "PATCH":
        if membership.role not in MANAGE_ROLES:
            raise ApiError("forbidden", MANAGE_ONLY, status_code=403)
        if row is None:
            row = NotificationSettings(workspace=workspace)
        serializer = NotificationSettingsSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = serializer.save()

    return Response(NotificationSettingsSerializer(row or NotificationSettings(workspace=workspace)).data)
