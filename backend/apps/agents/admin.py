"""Admin, read-mostly.

The trace is registered `readonly` throughout: it is evidence about what a
model did, and a row somebody could edit is evidence nobody can cite.
"""

from __future__ import annotations

from django.contrib import admin

from .models import Agent, AgentMessage, AgentRun, AgentTool


class AgentToolInline(admin.TabularInline):
    model = AgentTool
    extra = 0


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "workspace", "model", "enabled", "updated_at")
    list_filter = ("enabled", "model")
    search_fields = ("name", "persona")
    inlines = [AgentToolInline]


class AgentMessageInline(admin.TabularInline):
    model = AgentMessage
    extra = 0
    can_delete = False
    readonly_fields = ("role", "text", "payload", "created_at")

    def has_add_permission(self, request, obj=None) -> bool:
        return False


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = ("id", "agent", "outcome", "reason", "turns", "input_tokens", "output_tokens", "started_at")
    list_filter = ("outcome", "reason", "is_test")
    readonly_fields = [field.name for field in AgentRun._meta.fields]
    inlines = [AgentMessageInline]

    def has_add_permission(self, request) -> bool:
        return False
