"""Contact payloads."""

from __future__ import annotations

from rest_framework import serializers

from apps.flows.models import FlowRun, FlowRunStep

from .models import Contact, ContactTag


class ContactSerializer(serializers.ModelSerializer):
    botId = serializers.CharField(source="bot_id", read_only=True)
    telegramUserId = serializers.IntegerField(source="telegram_user_id", read_only=True)
    chatId = serializers.IntegerField(source="chat_id", read_only=True)
    displayName = serializers.CharField(source="display_name", read_only=True)
    firstName = serializers.CharField(source="first_name", read_only=True)
    lastName = serializers.CharField(source="last_name", read_only=True)
    isBlocked = serializers.BooleanField(source="is_blocked", read_only=True)
    lastSeenAt = serializers.DateTimeField(source="last_seen_at", read_only=True)
    tags = serializers.SerializerMethodField()
    #: Annotated by the viewset — the flow that first reached this person.
    sourceFlowName = serializers.CharField(source="source_flow_name", read_only=True, default="")
    sourceFlowId = serializers.CharField(source="source_flow_id", read_only=True, default="")
    firstSeenAt = serializers.DateTimeField(source="first_seen_at", read_only=True)
    #: Telegram's own `language_code`, unmapped — "ru-RU", "en", or nothing at
    #: all. Kept beside `language` because they answer different questions:
    #: what the phone is set to, and what the bot decided to speak.
    languageCode = serializers.CharField(source="language_code", read_only=True)
    #: Which of the bot's languages this person is answered in — see
    #: `apps.common.i18n.contact_language`.
    language = serializers.CharField(read_only=True)

    class Meta:
        model = Contact
        fields = [
            "id", "botId", "telegramUserId", "chatId", "displayName", "firstName", "lastName",
            "username", "phone", "source", "variables", "tags", "isBlocked",
            "sourceFlowName", "sourceFlowId", "firstSeenAt", "lastSeenAt",
            "language", "languageCode",
        ]

    def get_tags(self, contact: Contact) -> list[str]:
        return contact.tag_names()


class ContactStepSerializer(serializers.ModelSerializer):
    nodeId = serializers.CharField(source="node_id", read_only=True)
    at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = FlowRunStep
        fields = ["id", "actor", "text", "nodeId", "at"]


class ContactHistorySerializer(serializers.ModelSerializer):
    """One conversation, whole: which flow, how it ended, and every line of it."""

    flowId = serializers.CharField(source="flow_id", read_only=True)
    flowName = serializers.CharField(source="flow.name", read_only=True)
    startedAt = serializers.DateTimeField(source="started_at", read_only=True)
    finishedAt = serializers.DateTimeField(source="finished_at", read_only=True)
    steps = ContactStepSerializer(many=True, read_only=True)

    class Meta:
        model = FlowRun
        fields = ["id", "flowId", "flowName", "status", "error", "startedAt", "finishedAt", "steps"]


class ContactTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactTag
        fields = ["id", "name"]
