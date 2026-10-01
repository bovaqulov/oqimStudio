from __future__ import annotations

from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("metric", "value", "workspace", "flow_id", "module_key", "occurred_on")
    list_filter = ("metric", "module_key", "workspace")
