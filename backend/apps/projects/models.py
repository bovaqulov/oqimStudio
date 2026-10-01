"""Projects — the folder a workspace's bots and flows are grouped into."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.common.models import new_id
from apps.workspaces.models import Workspace


class Project(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    #: Tenant this project belongs to — every read is filtered by it.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=120)
    #: URL-safe handle, unique inside the workspace.
    handle = models.SlugField(max_length=64)
    #: Semantic icon name the interface resolves against its own registry.
    icon = models.CharField(max_length=48, default="folder")
    tag = models.CharField(max_length=48, blank=True)
    status = models.CharField(max_length=32, default="Faol")
    status_tone = models.CharField(max_length=16, default="success")
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["workspace", "handle"], name="uniq_project_handle")]

    def __str__(self) -> str:
        return self.name


class ProjectActivity(models.Model):
    """The project's trail. Written by the app, never edited by hand."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="activity")
    subject = models.CharField(max_length=120)
    text = models.CharField(max_length=280)
    icon = models.CharField(max_length=48, default="flow-arrow")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "project activity"

    def __str__(self) -> str:
        return f"{self.subject}: {self.text}"
