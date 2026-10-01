"""Bot payloads — camelCase, matching `features/bots/types.ts`.

The token is not a field on any of these. It leaves the server through exactly
one endpoint, which says so in its name (`/reveal-token/`), so no future
serializer change can leak it into a list response by accident.
"""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.common.i18n import LANGUAGES

from .business import business_problems
from .chats import chat_problems
from .models import (
    MAX_LANGUAGES,
    MODULE_KEYS,
    Bot,
    BotActivity,
    BotChat,
    BusinessConnection,
    PaymentConnection,
    normalise_languages,
)


def bot_status(bot: Bot) -> dict:
    """One rule for how a bot's state reads, wherever it is shown."""
    if bot.is_paused:
        # First, and above a webhook fault: a bot somebody stopped on purpose
        # reading "Muammo bor" sends them looking for a problem they created.
        # The list, the header and every module page print this one field, so
        # a stopped bot has to read as stopped on all of them and not only on
        # the screen carrying the switch.
        return {"label": "To'xtatilgan", "tone": "warning"}
    if bot.webhook_error:
        return {"label": "Muammo bor", "tone": "danger"}
    if bot.webhook_pending_updates:
        return {"label": "Xabarlar kutmoqda", "tone": "warning"}
    return {"label": bot.status, "tone": bot.status_tone}


class BotActivitySerializer(serializers.ModelSerializer):
    when = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = BotActivity
        fields = ["id", "text", "icon", "when"]


class BotListSerializer(serializers.ModelSerializer):
    """A bot as a row in a list.

    No metrics and no activity: both cost a query per bot, and a list of twenty
    bots would spend forty of them rendering numbers the list does not show.
    """

    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    projectId = serializers.CharField(source="project_id", read_only=True)
    status = serializers.SerializerMethodField()
    tokenMasked = serializers.CharField(source="token_masked", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    enabledModules = serializers.ListField(source="enabled_modules", child=serializers.CharField(), read_only=True)
    isPaused = serializers.BooleanField(source="is_paused", read_only=True)

    class Meta:
        model = Bot
        fields = [
            "id", "workspaceId", "projectId", "handle", "kind", "status",
            "updatedAt", "tokenMasked", "settings", "enabledModules", "isPaused",
        ]

    def get_status(self, bot: Bot) -> dict:
        return bot_status(bot)


class BotSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    projectId = serializers.CharField(source="project_id")
    status = serializers.SerializerMethodField()
    tokenMasked = serializers.CharField(source="token_masked", read_only=True)
    webhookUrl = serializers.SerializerMethodField()
    webhookRegistered = serializers.SerializerMethodField()
    webhookPending = serializers.IntegerField(source="webhook_pending_updates", read_only=True)
    webhookCheckedAt = serializers.DateTimeField(source="webhook_checked_at", read_only=True)
    webhookError = serializers.CharField(source="webhook_error", read_only=True)
    webhookActualUrl = serializers.CharField(source="webhook_actual_url", read_only=True)
    webhookLastErrorAt = serializers.DateTimeField(source="webhook_last_error_at", read_only=True)
    connectedAt = serializers.DateTimeField(source="connected_at", read_only=True)
    connectedBy = serializers.SerializerMethodField()
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    enabledModules = serializers.ListField(source="enabled_modules", child=serializers.CharField(), required=False)
    #: The one switch that is about the bot rather than one of its surfaces.
    #: Writable, unlike everything else derived from Telegram: this is the
    #: workspace's own decision, and `Bot.module_enabled` is where it lands.
    isPaused = serializers.BooleanField(source="is_paused", required=False)
    activity = serializers.SerializerMethodField()

    class Meta:
        model = Bot
        fields = [
            "id", "workspaceId", "projectId", "handle", "kind", "status", "updatedAt",
            "tokenMasked", "settings", "enabledModules", "webhookUrl", "webhookError",
            "connectedAt", "connectedBy", "activity", "webhookRegistered",
            "webhookPending", "webhookCheckedAt", "webhookActualUrl", "webhookLastErrorAt",
            "isPaused",
        ]
        read_only_fields = ["id", "workspaceId", "handle", "kind", "updatedAt"]

    def validate_settings(self, value: dict) -> dict:
        """Checks the one part of `settings` the runtime cannot repair silently.

        The rest of this blob is text and switches, where a wrong value shows
        itself the moment somebody reads the bot's reply. A language is not
        like that: text stored under a code nothing maps to is invisible in the
        editor and never sent, so the author sees an empty field and assumes
        the translation was lost.
        """
        stored = (value or {}).get("languages")
        if not isinstance(stored, dict):
            return value

        enabled = stored.get("enabled")
        enabled = list(enabled) if isinstance(enabled, (list, tuple)) else []
        unknown = [code for code in [stored.get("main"), *enabled] if code not in LANGUAGES]
        if unknown:
            raise serializers.ValidationError(f"Noma'lum til: {', '.join(str(code) for code in unknown)}")
        if len(set(enabled)) > MAX_LANGUAGES:
            raise serializers.ValidationError(f"Ko'pi bilan {MAX_LANGUAGES} ta til tanlash mumkin")
        # Stored in the repaired shape rather than as it arrived, so the main
        # language is in the list on disk and not only when read back.
        return {**value, "languages": normalise_languages(stored)}

    #: What a caller is told when they ask for a bot with nothing switched on.
    #:
    #: Named rather than written inline because the interface says the same
    #: sentence before the request is made (`features/bots/actions.ts`), and a
    #: rule with two wordings is read as two rules by whoever has to support it.
    #: `apps/bots/tests.py` asserts the two are byte-identical.
    NO_MODULES = "Kamida bitta bo'lim yoqilgan bo'lishi kerak."

    def validate_enabledModules(self, value: list[str]) -> list[str]:  # noqa: N802 - contract is camelCase
        """A misspelt module is a bot that silently stops answering on it.

        An *empty* list is the other half, and it is the one that took a while
        to see. `Bot.module_enabled` reads an empty column as "nobody has
        configured this yet" and answers `dms` regardless — so a caller who
        sends `[]` meaning "everything off" gets a bot that still replies in its
        own chat, and a panel drawing that state shows every switch off beside a
        bot that is answering. The unconfigured default stays empty; asking for
        empty does not, because the two mean different things and only one of
        them is something somebody chose.
        """
        unknown = [key for key in value if key not in MODULE_KEYS]
        if unknown:
            raise serializers.ValidationError(f"Noma'lum bo'lim: {', '.join(unknown)}")
        if not value:
            raise serializers.ValidationError(self.NO_MODULES)
        return value

    def get_webhookUrl(self, bot: Bot) -> str:  # noqa: N802 - contract is camelCase
        """Where Telegram *should* be posting, computed from today's address.

        Deliberately not the stored column: that one records where Telegram was
        last pointed, and showing it after the public address moved is how a bot
        looks connected while nothing reaches it.
        """
        from .services import webhook_url_for

        return webhook_url_for(bot)

    def get_webhookRegistered(self, bot: Bot) -> bool:  # noqa: N802
        """Whether *Telegram* is posting to that address.

        Read back from `getWebhookInfo`, not from our own column: writing
        "connected" after a successful `setWebhook` is exactly how a bot whose
        webhook was later moved — by a new tunnel, or by hand — keeps showing
        green while every message goes nowhere.

        Before the first check has run there is nothing to compare, so what we
        registered stands in; the check runs on boot and hourly.
        """
        from .services import webhook_is_current, webhook_url_for

        if bot.webhook_checked_at and bot.webhook_actual_url:
            return bot.webhook_actual_url == webhook_url_for(bot) and not bot.webhook_error
        return webhook_is_current(bot) and not bot.webhook_error

    def get_status(self, bot: Bot) -> dict:
        """What the bot is doing, not what somebody wrote in a column once.

        A stored "Faol" survives a bot that stopped answering hours ago, and a
        panel that keeps saying so is worse than one that says nothing: it is
        the reason a dead webhook can go unnoticed. Telegram's own answer wins
        here — a delivery error, or updates piling up unanswered.
        """
        return bot_status(bot)

    def get_connectedBy(self, bot: Bot) -> str:  # noqa: N802
        return bot.connected_by.email if bot.connected_by else ""

    def get_activity(self, bot: Bot) -> list[dict]:
        """The bot's own audit trail — who did what to it, newest first.

        Read on its Sozlamalar screen. One query, and only on the detail view:
        `BotListSerializer` deliberately carries neither this nor anything else
        that costs a query per row.

        `metrics` used to sit beside it here — two `COUNT`s over the event log
        on every read of a bot, for a folded section under the flow list that
        printed an hour's conversations next to a link to `/analytics`. That
        section is gone, `/analytics` answers the same question properly, and
        nothing else ever read the field: the two places in the panel that
        mention `bot.metrics[0]` are fed by the list endpoint, which has never
        sent it.
        """
        return BotActivitySerializer(bot.activity.all()[:8], many=True).data


class ConnectBotSerializer(serializers.Serializer):
    """What the "yangi bot" form sends: a project and a token, nothing else."""

    projectId = serializers.CharField()
    token = serializers.CharField()
    kind = serializers.ChoiceField(choices=Bot.Kind.choices, required=False, default=Bot.Kind.BOT)


class CreateBotRequestSerializer(serializers.Serializer):
    """What the "Telegramda yaratish" half of the form sends.

    Both names are suggestions rather than settings: Telegram pre-fills them on
    its own confirmation screen and lets the reader change either, which is the
    only place where "@sotuv_bot is taken" can actually be discovered. So the
    rules checked here are the ones that would make the *link* malformed, and
    nothing more — a form that guessed harder would only be wrong more often.
    """

    projectId = serializers.CharField()
    name = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    username = serializers.CharField(max_length=32)

    def validate_username(self, value: str) -> str:
        username = value.strip().lstrip("@")
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", username):
            raise serializers.ValidationError(
                "Username 5-32 belgidan iborat bo'lsin: harf bilan boshlanib, harf, raqam va _ dan tuzilsin."
            )
        if not username.lower().endswith("bot"):
            raise serializers.ValidationError("Telegram talabi: username 'bot' bilan tugashi kerak.")
        return username


class BusinessConnectionSerializer(serializers.ModelSerializer):
    """One Business account that has attached this bot, and what it may do.

    `problems` is here for the reason `BotChatSerializer.problems` is: the
    answer joins what Telegram granted with what this workspace switched on,
    and working it out in the browser would put that rule in a second place
    where the two can disagree. See `apps.bots.business`.
    """

    connectionId = serializers.CharField(source="connection_id", read_only=True)
    userName = serializers.CharField(source="user_name", read_only=True)
    isEnabled = serializers.BooleanField(source="is_enabled", read_only=True)
    connectedAt = serializers.DateTimeField(source="connected_at", read_only=True)
    problems = serializers.SerializerMethodField()

    class Meta:
        model = BusinessConnection
        fields = ["id", "connectionId", "userName", "username", "rights", "isEnabled", "connectedAt", "problems"]

    def get_problems(self, connection: BusinessConnection) -> list[dict]:
        # `connection.bot` and not a lookup: the view selects it, so a list of
        # accounts asks for the bot once rather than once per row.
        return business_problems(connection, connection.bot)


class PaymentConnectionSerializer(serializers.ModelSerializer):
    providerId = serializers.CharField(source="provider_id")
    tokenMasked = serializers.CharField(source="token_masked", read_only=True)
    connectedAt = serializers.DateTimeField(source="connected_at", read_only=True)
    lastCheckedAt = serializers.DateTimeField(source="last_checked_at", read_only=True)
    status = serializers.SerializerMethodField()
    token = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = PaymentConnection
        fields = [
            "id", "providerId", "tokenMasked", "mode", "status", "error",
            "connectedAt", "lastCheckedAt", "token",
        ]
        read_only_fields = ["id", "tokenMasked", "connectedAt", "lastCheckedAt", "error"]

    def get_status(self, connection: PaymentConnection) -> dict:
        return {"label": connection.status, "tone": connection.status_tone}


class ScriptLibrarySerializer(serializers.ModelSerializer):
    """The bot's shared Kod source, as the panel reads it.

    Read-only, and the write half is deliberately not here: the ceiling on how
    long a library may be is refused with an `ApiError` carrying a code the
    panel branches on, and a `max_length` on this field would answer
    `validation_error` instead — the same 400, but one the interface can only
    render as a sentence.

    `updatedAt` is null until somebody first saves. The panel prints it as
    "saqlandi" under the editor, and the bot's own `updated_at` would have said
    that of a library nobody has ever opened — it is `auto_now`, and a rotated
    token or an hourly webhook check moves it.
    """

    source = serializers.CharField(source="script_library", read_only=True)
    updatedAt = serializers.DateTimeField(source="script_library_updated_at", read_only=True)

    class Meta:
        model = Bot
        fields = ["source", "updatedAt"]


class BotChatSerializer(serializers.ModelSerializer):
    """One group or channel, as the management screen reads it.

    `problems` is the reason this serializer is not a field list. The screen is
    opened with one question — «botim nega bu guruhda ishlamayapti» — and the
    answer is a join of the bot's own modules, Telegram's rights and a refresh
    that may have failed. Working it out in the browser would put that rule in
    a second place, where a chat can read as healthy on one screen and broken
    on another.
    """

    chatId = serializers.IntegerField(source="chat_id", read_only=True)
    inviteLink = serializers.CharField(source="invite_link", read_only=True)
    isAdministrator = serializers.BooleanField(source="is_administrator", read_only=True)
    isMember = serializers.BooleanField(source="is_member", read_only=True)
    moduleKey = serializers.CharField(source="module_key", read_only=True)
    memberCount = serializers.IntegerField(source="member_count", read_only=True)
    memberCountAt = serializers.DateTimeField(source="member_count_at", read_only=True)
    joinByRequest = serializers.BooleanField(source="join_by_request", read_only=True)
    addedAt = serializers.DateTimeField(source="added_at", read_only=True)
    leftAt = serializers.DateTimeField(source="left_at", read_only=True)
    refreshedAt = serializers.DateTimeField(source="refreshed_at", read_only=True)
    problems = serializers.SerializerMethodField()

    class Meta:
        model = BotChat
        fields = [
            "id", "chatId", "type", "title", "username", "inviteLink", "status",
            "isAdministrator", "isMember", "moduleKey", "rights", "memberCount",
            "memberCountAt", "joinByRequest", "addedAt", "leftAt", "refreshedAt",
            "problems",
        ]

    def get_problems(self, chat: BotChat) -> list[dict]:
        # `chat.bot` and not a lookup: the queryset selects it, so a list of
        # forty chats asks for the bot once rather than forty times.
        return chat_problems(chat, chat.bot)
