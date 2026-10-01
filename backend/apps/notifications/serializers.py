from __future__ import annotations

from rest_framework import serializers

from .models import Notification, NotificationSettings


class NotificationSerializer(serializers.ModelSerializer):
    isRead = serializers.SerializerMethodField()
    at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "text", "icon", "href", "isRead", "at"]

    def get_isRead(self, notification: Notification) -> bool:  # noqa: N802
        return notification.read_at is not None


class NotificationSettingsSerializer(serializers.ModelSerializer):
    """The workspace's switches, camelCase — `NotificationSettings` in
    `features/notifications/types.ts`.

    `workspace` is not a field: the tenant comes from the request the way it
    does everywhere else, and a body that could name one would be a second,
    unchecked way to reach another workspace's row.
    """

    usageWarnings = serializers.BooleanField(source="usage_warnings", required=False)

    class Meta:
        model = NotificationSettings
        fields = ["handoff", "usageWarnings"]
