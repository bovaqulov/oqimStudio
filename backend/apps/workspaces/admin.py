from __future__ import annotations

from django.contrib import admin

from .models import Invite, Membership, Workspace


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "plan_key", "currency", "owner", "created_at")
    search_fields = ("name", "slug")


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("email", "workspace", "role", "invited", "joined_at")
    list_filter = ("role", "invited")
    search_fields = ("email",)


@admin.register(Invite)
class InviteAdmin(admin.ModelAdmin):
    list_display = ("code", "workspace", "role", "email", "expires_at", "accepted_at")
