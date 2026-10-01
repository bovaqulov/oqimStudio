"""Agent payloads — camelCase, matching `frontend/src/features/agents/types.ts`.

The tools are written **with** the agent rather than through endpoints of their
own. An agent and its tools are one thing an author edits on one screen — who
it is and what it may do — and splitting the write would let a save land half
applied: a persona describing a tool that was not created, or a tool the agent
no longer mentions. Same argument as a flow's graph, which is also written
whole.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework import serializers

from .catalogue import DEFAULT_EFFORT, DEFAULT_MODEL, EFFORT_LEVELS, MODELS
from .models import Agent, AgentMessage, AgentRun, AgentTool


class AgentToolSerializer(serializers.ModelSerializer):
    #: Sent by the editor for a tool that already exists, absent for a new one.
    #: Not read-only for that reason: this is the only thing that tells an edit
    #: from an addition when the whole list arrives at once.
    id = serializers.CharField(required=False)

    class Meta:
        model = AgentTool
        fields = ["id", "kind", "name", "description", "config", "enabled", "order"]

    def validate_name(self, value: str) -> str:
        """The name is an identifier in the tool schema, not a label.

        Checked here rather than left to the model: an invalid tool name is a
        400 from the API on the next message the agent answers, which is a
        failure that surfaces in front of a customer instead of in front of the
        person who typed it.
        """
        cleaned = (value or "").strip()
        if not cleaned.replace("_", "").isalnum() or not cleaned[:1].isalpha():
            raise serializers.ValidationError("Nomi harfdan boshlanishi va faqat harf, raqam, _ dan iborat bo'lishi kerak")
        return cleaned.lower()


class AgentSerializer(serializers.ModelSerializer):
    tools = AgentToolSerializer(many=True, required=False)
    #: Required on a create and writable on a PATCH, so an agent can be moved
    #: between folders the way a bot can. That it names a project of the
    #: *caller's own* workspace is checked in the view, beside the same check
    #: `bots.views` makes — a serializer has no workspace to check against
    #: until somebody hands it one, and a check that depends on being handed
    #: something is a check that is one day not.
    projectId = serializers.CharField(source="project_id")
    maxTurns = serializers.IntegerField(source="max_turns", required=False, min_value=1, max_value=12)
    maxOutputTokens = serializers.IntegerField(
        source="max_output_tokens", required=False, min_value=64, max_value=8000
    )
    dailyTokenBudget = serializers.IntegerField(source="daily_token_budget", required=False, min_value=0)
    historyDepth = serializers.IntegerField(source="history_depth", required=False, min_value=0, max_value=20)
    replyMaxChars = serializers.IntegerField(source="reply_max_chars", required=False, min_value=80, max_value=4000)
    escalateOnFailure = serializers.BooleanField(source="escalate_on_failure", required=False)
    model = serializers.ChoiceField(choices=[m.id for m in MODELS], required=False, default=DEFAULT_MODEL)
    effort = serializers.ChoiceField(choices=list(EFFORT_LEVELS), required=False, default=DEFAULT_EFFORT)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    #: How many turns this agent has answered in the last day, and what they
    #: cost. Read off the trace, so the screen that sets a budget is the screen
    #: that shows what is being spent against it.
    usage = serializers.SerializerMethodField()

    class Meta:
        model = Agent
        fields = [
            "id", "projectId", "name", "persona", "instructions", "model", "effort",
            "maxTurns", "maxOutputTokens", "dailyTokenBudget", "historyDepth",
            "replyMaxChars", "escalateOnFailure", "enabled", "tools", "usage", "updatedAt",
        ]

    def get_usage(self, agent: Agent) -> dict:
        from .services import spent_today

        return {"tokensToday": spent_today(agent), "budget": agent.daily_token_budget}

    @staticmethod
    def _final_name(tool: AgentTool | None, fields: dict) -> str:
        """What this row will be called once the save has landed.

        `name` can be absent from a row. A PATCH is partial all the way down —
        `Field.validate_empty_values` reads `self.root.partial` — so a caller may
        send `{"id": ..., "order": 2}` and mean "leave it alone but move it".
        Reading the payload alone would then miss a collision the row is one
        half of, and miss it in the direction that raises.
        """
        return fields.get("name", tool.name if tool is not None else "")

    def _write_tools(self, agent: Agent, rows: list[dict]) -> None:
        """Replaces the tool list wholesale, keeping the rows that stayed.

        Kept rather than deleted-and-recreated so a tool's id survives an edit:
        the trace points at names, but an editor that renumbered every tool on
        every save would make a diff of two versions unreadable.

        The order of the writes is the whole of it. `(agent, name)` is unique
        and SQLite checks it row by row, so a name held by two rows for the
        length of one save is an `IntegrityError` and a 500 on an ordinary edit.
        There are three ways to hold one, and they need three different answers:

          * a tool is deleted and its name given to another. Saving before
            deleting leaves the departed row holding the name — so the departed
            rows go first.
          * two surviving tools swap names. Deleting first does not help: the
            row in the way is not leaving. So every survivor that is being
            renamed parks its name out of the way before any of them takes its
            new one. `~<pk>` is safe to park under — `validate_name` requires a
            letter first, so no name an author can type is ever of that shape,
            and pks are distinct, so the parked rows cannot collide either.
          * one save asks for the same name twice, which no ordering satisfies.
            That is refused, below, with the name in the message.
        """
        before = {tool.pk: tool for tool in agent.tools.all()}
        # `id` is what tells an edit from an addition. An id belonging to
        # somebody else's agent is simply not found here and becomes a new row
        # of this one's, rather than a write into theirs.
        incoming: list[tuple[AgentTool | None, dict]] = []
        for index, row in enumerate(rows):
            fields = dict(row)
            tool = before.get(fields.pop("id", None))
            fields["order"] = index
            incoming.append((tool, fields))

        # Refused rather than merged, or renamed on the author's behalf. The
        # name is the identifier the model calls and the string the trace is
        # read by; two rows wanting it is a question only the author can answer,
        # and silently keeping one of them means a tool they drew never runs and
        # nothing said so. Not an edge case either: the editor's «Ma'lumotni
        # saqlash» default arrives as `malumotni_saqla`, so the collision is the
        # second tool anybody adds — and `validate_name` has already lowered the
        # names, so `Saqla` against `saqla` is caught here too.
        seen: set[str] = set()
        for tool, fields in incoming:
            name = self._final_name(tool, fields)
            if name in seen:
                raise serializers.ValidationError(
                    {"tools": f"«{name}» nomi ikki marta ishlatilgan — har bir vosita nomi boshqacha bo'lishi kerak"}
                )
            seen.add(name)

        keep = [tool.pk for tool, _ in incoming if tool is not None]
        agent.tools.exclude(pk__in=keep).delete()

        for tool, fields in incoming:
            if tool is not None and tool.name != self._final_name(tool, fields):
                AgentTool.objects.filter(pk=tool.pk).update(name=f"~{tool.pk}")

        for tool, fields in incoming:
            if tool is None:
                AgentTool.objects.create(agent=agent, **fields)
                continue
            for field, value in fields.items():
                setattr(tool, field, value)
            tool.save()

    # Both writes are one transaction, so a save refused halfway leaves nothing
    # behind. Without it a create turned away for a duplicate tool name still
    # files the agent, and the author is left looking at an error beside a
    # half-built thing that did not exist before they pressed save.
    @transaction.atomic
    def create(self, validated_data):
        rows = validated_data.pop("tools", [])
        agent = Agent.objects.create(**validated_data)
        self._write_tools(agent, rows)
        return agent

    @transaction.atomic
    def update(self, instance, validated_data):
        rows = validated_data.pop("tools", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        # `None` means the caller did not mention tools — a PATCH of the name
        # alone must not silently delete everything the agent may do.
        if rows is not None:
            self._write_tools(instance, rows)
        return instance


class AgentMessageSerializer(serializers.ModelSerializer):
    at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = AgentMessage
        fields = ["id", "role", "text", "payload", "at"]


class AgentRunSerializer(serializers.ModelSerializer):
    """One turn, whole — the answer to "why did it say that"."""

    agentId = serializers.CharField(source="agent_id", read_only=True)
    flowRunId = serializers.CharField(source="flow_run_id", read_only=True)
    contactId = serializers.CharField(source="contact_id", read_only=True)
    contactName = serializers.CharField(source="contact.display_name", read_only=True, default="")
    nodeId = serializers.CharField(source="node_id", read_only=True)
    inputTokens = serializers.IntegerField(source="input_tokens", read_only=True)
    outputTokens = serializers.IntegerField(source="output_tokens", read_only=True)
    costUsd = serializers.DecimalField(source="cost_usd", max_digits=10, decimal_places=6, read_only=True)
    isTest = serializers.BooleanField(source="is_test", read_only=True)
    startedAt = serializers.DateTimeField(source="started_at", read_only=True)
    messages = AgentMessageSerializer(many=True, read_only=True)

    class Meta:
        model = AgentRun
        fields = [
            "id", "agentId", "flowRunId", "contactId", "contactName", "nodeId",
            "outcome", "reason", "model", "turns", "inputTokens", "outputTokens",
            "costUsd", "reply", "error", "isTest", "startedAt", "messages",
        ]
