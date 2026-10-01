"""Workspace payloads — camelCase, matching `features/workspace/types.ts`."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from django.utils.text import slugify
from rest_framework import serializers

from apps.common.exceptions import ApiError
from apps.common.models import InterfaceLocale, new_id

from .models import Invite, Membership, Role, Workspace


def validated_zone(value: str) -> str:
    """An IANA zone name, or a refusal in the words the form can print.

    `Workspace.timezone` is not a label. Two things read it and both are
    `ZoneInfo(...)` calls that fall back to UTC when the string is not a zone —
    `analytics.services.workspace_zone` and `engine.matching._within_schedule`
    — so a value nothing can parse does not fail anywhere: it silently moves
    every schedule trigger and every grouped report by up to a day, and the
    settings screen goes on displaying the string that did it.

    The panel offers a `<select>` of five zones, so nothing a person can press
    produces one. That was the whole defence, and a picker is not a rule — the
    same hole `InterfaceLocale` closed for `locale`, where the column had also
    been accepting any sixteen characters behind a dropdown of three.
    """
    zone = (value or "").strip()
    try:
        ZoneInfo(zone)
    except Exception as exc:  # noqa: BLE001 - every failure means the same thing here
        raise ApiError(
            "invalid_timezone",
            f"«{zone}» — bunday vaqt mintaqasi yo'q. Ro'yxatdan tanlang.",
            field="timezone",
        ) from exc
    return zone


class WorkspaceSerializer(serializers.ModelSerializer):
    #: Read-only, and this is the whole of why: the plan is what the workspace
    #: pays for, `POST /api/billing/subscription/` is owner-only for that
    #: reason, and `plan_for` reads `Workspace.plan_key` whenever there is no
    #: `Subscription` row — which is every workspace that has never bought
    #: anything. Writable here it was a second door onto the same value with no
    #: lock on it: `perform_update` asks only for a write role, so any editor
    #: could send one extra key and raise every limit in `billing.services` for
    #: free, and the billing screen would then report the plan it was handed.
    planKey = serializers.CharField(source="plan_key", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    ownerUserId = serializers.CharField(source="owner_id", read_only=True)
    isDemo = serializers.BooleanField(source="is_demo", read_only=True)

    class Meta:
        model = Workspace
        fields = [
            "id", "name", "slug", "planKey", "timezone", "locale", "currency",
            "createdAt", "ownerUserId", "isDemo",
        ]
        read_only_fields = ["id", "slug"]

    def validate_timezone(self, value: str) -> str:
        return validated_zone(value)


class CreateWorkspaceSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    currency = serializers.CharField(max_length=8, required=False, default="UZS")
    #: Same list the model holds — see `InterfaceLocale`.
    locale = serializers.ChoiceField(choices=InterfaceLocale.choices, required=False, default=InterfaceLocale.UZ)
    timezone = serializers.CharField(max_length=64, required=False, default="Asia/Tashkent")

    def validate_timezone(self, value: str) -> str:
        # On both serializers, or the hole simply moves to the screen that
        # creates the workspace in the first place.
        return validated_zone(value)

    def create(self, validated_data) -> Workspace:
        owner = self.context["request"].user
        base = slugify(validated_data["name"])[:48] or "ish-maydoni"
        slug = base
        # A handle is part of URLs people paste to each other, so it stays
        # readable: a collision gets a short suffix, not a random name.
        while Workspace.objects.filter(slug=slug).exists():
            slug = f"{base}-{new_id()[:4]}"

        workspace = Workspace.objects.create(
            id=slug,
            name=validated_data["name"],
            slug=slug,
            currency=validated_data.get("currency", "UZS"),
            locale=validated_data.get("locale", InterfaceLocale.UZ),
            timezone=validated_data.get("timezone", "Asia/Tashkent"),
            owner=owner,
        )
        Membership.objects.create(
            workspace=workspace,
            user=owner,
            email=owner.email,
            name=owner.name,
            role=Role.OWNER,
        )
        return workspace


class MemberSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    userId = serializers.CharField(source="user_id", read_only=True)
    joinedAt = serializers.DateTimeField(source="joined_at", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "workspaceId", "userId", "name", "email", "role", "joinedAt", "invited"]
        read_only_fields = ["id", "workspaceId", "userId", "joinedAt", "invited"]


class InviteMemberSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Role.choices)


class InviteSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    expiresAt = serializers.DateTimeField(source="expires_at", read_only=True)
    acceptedAt = serializers.DateTimeField(source="accepted_at", read_only=True)

    class Meta:
        model = Invite
        fields = ["id", "workspaceId", "code", "role", "email", "expiresAt", "acceptedAt"]
        read_only_fields = fields


class InviteLinkSerializer(serializers.Serializer):
    """What "havola yaratish" sends: a role, and nothing else.

    No email — that is the whole difference from `InviteMemberSerializer`. A
    link invite names no recipient, so there is nobody to hold a seat for and no
    pending `Membership` row until somebody actually redeems it.
    """

    role = serializers.ChoiceField(choices=Role.choices, required=False, default=Role.EDITOR)


class JoinWorkspaceSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=64)
