from __future__ import annotations

from django.contrib import admin

from .models import Project, ProjectActivity


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "handle", "status", "created_at")
    list_filter = ("workspace",)
    search_fields = ("name", "handle")


@admin.register(ProjectActivity)
class ProjectActivityAdmin(admin.ModelAdmin):
    list_display = ("project", "subject", "text", "created_at")
