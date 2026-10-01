from __future__ import annotations

from django.contrib import admin

from .models import Notification, NotificationSettings


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "kind", "read_at", "created_at")
    list_filter = ("kind", "workspace")


@admin.register(NotificationSettings)
class NotificationSettingsAdmin(admin.ModelAdmin):
    list_display = ("workspace", "handoff", "usage_warnings", "updated_at")
    list_filter = ("handoff", "usage_warnings")
