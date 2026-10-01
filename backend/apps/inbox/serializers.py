"""Suhbat payloads — camelCase, matching `features/inbox/types.ts`."""

from __future__ import annotations

from rest_framework import serializers

from .models import Message


class MessageSerializer(serializers.ModelSerializer):
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    #: The operator's name, or `null` for everything the runtime sent. The
    #: interface draws the two differently, and a name is the only way it can
    #: tell — "the bot answered" and "Aziza answered" are not the same event.
    operatorName = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "direction", "kind", "text", "operatorName", "createdAt"]

    def get_operatorName(self, message: Message):  # noqa: N802
        return message.operator.name if message.operator_id else None


class ConversationSerializer(serializers.Serializer):
    """One row of the chat list.

    Not a `ModelSerializer` over `Contact`: the last-message fields are
    annotations from `conversation_rows`, and declaring them here says out loud
    that this payload is a join and not a table.
    """

    contactId = serializers.CharField(source="id", read_only=True)
    name = serializers.CharField(source="display_name", read_only=True)
    username = serializers.CharField(read_only=True)
    botId = serializers.CharField(source="bot_id", read_only=True)
    #: A bot is its handle everywhere else in the product; it has no `name`.
    botHandle = serializers.CharField(source="bot.handle", read_only=True)
    chatType = serializers.CharField(source="chat_type", read_only=True)
    isBlocked = serializers.BooleanField(source="is_blocked", read_only=True)
    lastMessage = serializers.SerializerMethodField()

    def get_lastMessage(self, contact) -> dict | None:  # noqa: N802
        if getattr(contact, "last_at", None) is None:
            return None
        return {
            "text": contact.last_text or "",
            "kind": contact.last_kind or "",
            "direction": contact.last_direction or "",
            "createdAt": contact.last_at,
        }
