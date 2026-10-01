"""API key payloads — camelCase, matching `features/apikeys/types.ts`.

The secret is not a field on any serializer here, for the same reason the bot
token is not a field on `BotSerializer`: it leaves the server through exactly
one line of exactly one view, so no later change to a `fields` list can put it
in a list response by accident.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import SCOPES, ApiKey


class ApiKeySerializer(serializers.ModelSerializer):
    createdBy = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    lastUsedAt = serializers.DateTimeField(source="last_used_at", read_only=True)
    revokedAt = serializers.DateTimeField(source="revoked_at", read_only=True)
    scopes = serializers.SerializerMethodField()

    class Meta:
        model = ApiKey
        fields = ["id", "name", "prefix", "scopes", "createdBy", "createdAt", "lastUsedAt", "revokedAt"]

    def get_scopes(self, key: ApiKey) -> list[str]:
        # Through the vocabulary rather than straight out of the column, so the
        # panel can never show a tick for a scope this deployment no longer
        # honours — see `ApiKey.scope_list`.
        return key.scope_list

    def get_createdBy(self, key: ApiKey) -> str:
        """The live name when the account is still there, the snapshot when it is not.

        Live first because somebody who changes their name should see the new
        one; the snapshot at all because an account can be deleted, and an
        audit row that answers "kim yaratdi" with an empty string is not an
        audit row.
        """
        if key.created_by is not None:
            return key.created_by.name or key.created_by.email
        return key.created_by_name


class CreateApiKeySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    #: `allow_empty=False` on purpose. A key with no scopes authenticates
    #: perfectly and is refused by every endpoint, which reads as a broken API
    #: rather than as a key that was never given anything to do.
    #:
    #: Both messages are written out because DRF's defaults are English
    #: («This list may not be empty.») and this is a form somebody fills in.
    #: The unknown-scope one names what is allowed rather than only what is
    #: not: the caller is holding a string they believed in, and the useful
    #: answer is the list they can choose from.
    scopes = serializers.ListField(
        child=serializers.ChoiceField(
            choices=sorted(SCOPES),
            error_messages={"invalid_choice": f"Noma'lum doira. Mavjudlari: {', '.join(sorted(SCOPES))}"},
        ),
        allow_empty=False,
        error_messages={"empty": "Kamida bitta doira tanlang — doirasiz kalit hech narsani ocholmaydi"},
    )

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Kalitga nom bering")
        return name
