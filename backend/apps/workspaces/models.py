"""Tenancy.

A workspace is the boundary every other read in the product is filtered by:
projects, bots, flows, contacts and numbers all hang off one, and no query in
this codebase is written without it.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.common.models import InterfaceLocale, new_id

INVITE_TTL = timedelta(days=14)


def default_invite_expiry():
    """Named rather than a lambda so migrations can serialise it."""
    return timezone.now() + INVITE_TTL


class Role(models.TextChoices):
    """What a member may do inside one workspace.

    Ordered by power in `RANK` — nothing in the product hands out a role above
    the one held by the person doing the handing.
    """

    OWNER = "owner", "Egasi"
    ADMIN = "admin", "Administrator"
    EDITOR = "editor", "Muharrir"
    ANALYST = "analyst", "Analitik"


#: Higher wins. Used for "can this member edit that member" checks.
RANK: dict[str, int] = {Role.OWNER: 4, Role.ADMIN: 3, Role.EDITOR: 2, Role.ANALYST: 1}

#: Roles allowed to change anything. An analyst reads, and that is the whole rule.
WRITE_ROLES = {Role.OWNER, Role.ADMIN, Role.EDITOR}


class Workspace(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    name = models.CharField(max_length=120)
    #: URL-safe handle, unique per install.
    slug = models.SlugField(max_length=64, unique=True)
    plan_key = models.CharField(max_length=32, default="start")
    #: IANA zone every schedule and timestamp in this workspace is read in.
    timezone = models.CharField(max_length=64, default="Asia/Tashkent")
    #: The tenant's formatting default — dates and money on a shared report.
    #: Which words a member reads is `User.locale`, theirs alone.
    locale = models.CharField(max_length=16, choices=InterfaceLocale.choices, default=InterfaceLocale.UZ)
    #: ISO-4217 code the plan and invoices are billed in.
    currency = models.CharField(max_length=8, default="UZS")
    #: Filled by `seed_demo`. Every screen that shows numbers says so, because a
    #: demo shown to a customer looks exactly like their own data — and "60 mln
    #: so'm tushum" is a claim nobody should make by accident.
    is_demo = models.BooleanField(default=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_workspaces")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.name

    def role_of(self, user) -> str | None:
        membership = self.memberships.filter(user=user, invited=False).first()
        return membership.role if membership else None


class Membership(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="memberships",
        null=True,
        blank=True,
    )
    #: Kept next to the FK so an invitation can name an address no account exists for yet.
    email = models.EmailField()
    name = models.CharField(max_length=120, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.EDITOR)
    #: An invitation that has been sent but not accepted yet.
    invited = models.BooleanField(default=False)
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["joined_at"]
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user"], name="uniq_membership_user"),
            models.UniqueConstraint(fields=["workspace", "email"], name="uniq_membership_email"),
        ]

    def __str__(self) -> str:
        return f"{self.email} @ {self.workspace_id} ({self.role})"

    @property
    def rank(self) -> int:
        return RANK.get(self.role, 0)


class Invite(models.Model):
    """A code an admin hands out. Accepting one turns it into a `Membership`."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invites")
    code = models.CharField(max_length=32, unique=True, default=new_id)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.EDITOR)
    email = models.EmailField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    expires_at = models.DateTimeField(default=default_invite_expiry)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.code} -> {self.workspace_id}"

    @property
    def is_usable(self) -> bool:
        return self.accepted_at is None and self.expires_at > timezone.now()
