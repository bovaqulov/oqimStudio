"""Notifications — what the bell shows, and what the workspace socket pushes."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.common.models import new_id
from apps.workspaces.models import Workspace


class Notification(models.Model):
    class Kind(models.TextChoices):
        SYSTEM = "system", "Tizim"
        HANDOFF = "handoff", "Operator kerak"
        BOT = "bot", "Bot"
        BILLING = "billing", "To'lov"
        FLOW = "flow", "Oqim"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="notifications")
    #: Null means everyone in the workspace sees it.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications", null=True, blank=True
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.SYSTEM)
    title = models.CharField(max_length=160)
    text = models.CharField(max_length=280, blank=True)
    icon = models.CharField(max_length=48, default="bell-ringing")
    #: Where clicking it lands, as an in-app path.
    href = models.CharField(max_length=280, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "read_at"])]

    def __str__(self) -> str:
        return self.title


class NotificationSettings(models.Model):
    """Which notices this workspace raises at all.

    One row per workspace, written the first time somebody changes something —
    a workspace with no row is a workspace with everything switched on, which
    is what every workspace that existed before this table had.

    Workspace-level and not per-person because the notices are. Both things
    that reach the bell in this product — `engine.runner._handle_human` and
    `services.warn_about_usage` — write `user=None`, so one member switching
    "Operator kerak" off would be switching it off for the colleague beside
    them. A control labelled as personal over a shared row is a lie in
    whichever direction it is read, so it is labelled as the workspace's and
    only the two roles that manage the workspace may touch it.

    The switches are named after what a reader would call the notice, not after
    the `Kind` they gate: `Kind.BILLING` covers exactly one thing today (a
    limit filling up) and «To'lov» would be the wrong word on a screen.
    """

    workspace = models.OneToOneField(
        Workspace, on_delete=models.CASCADE, related_name="notification_settings", primary_key=True
    )
    #: «Operator kerak» — a flow handed a conversation to a person.
    handoff = models.BooleanField(default=True)
    #: «Limit tugayapti» / «limiti to'ldi». One exception, and it is the whole
    #: reason this is safe to offer: the `contacts` overrun is raised whatever
    #: this says — see `ALWAYS_WARN` in `services`.
    usage_warnings = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Notification settings"

    def __str__(self) -> str:
        return f"{self.workspace_id}: handoff={self.handoff} usage={self.usage_warnings}"
