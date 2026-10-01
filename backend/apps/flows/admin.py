from __future__ import annotations

from django.contrib import admin

from .models import Flow, FlowRun, FlowRunStep, FlowTrigger


class FlowTriggerInline(admin.TabularInline):
    model = FlowTrigger
    extra = 0
    # Derived from the graph on every save — editing a row here would be
    # overwritten by the next save, so the index is shown, not edited.
    readonly_fields = ("kind", "command", "keywords", "priority", "node_id")
    can_delete = False


@admin.register(Flow)
class FlowAdmin(admin.ModelAdmin):
    list_display = ("name", "bot", "module_key", "enabled", "is_main", "runs", "updated_at")
    list_filter = ("module_key", "enabled", "workspace")
    search_fields = ("name", "description")
    inlines = [FlowTriggerInline]


@admin.register(FlowRun)
class FlowRunAdmin(admin.ModelAdmin):
    list_display = ("id", "flow", "contact", "status", "started_at", "finished_at")
    list_filter = ("status", "is_test")


@admin.register(FlowRunStep)
class FlowRunStepAdmin(admin.ModelAdmin):
    list_display = ("run", "node_type", "actor", "text", "created_at")
