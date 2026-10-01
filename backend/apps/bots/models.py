"""Bots — the Telegram side of a project.

The token is the one secret this product holds on a customer's behalf, so it
lives in exactly one column, is never serialised into a list response, and is
handed out only through an endpoint that says so in its name.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.common.i18n import DEFAULT_LANGUAGE, LANGUAGES
from apps.common.models import new_id, new_secret
from apps.projects.models import Project
from apps.workspaces.models import Workspace

#: The five surfaces a bot can automate. Mirrors `ModuleKey` in the frontend.
MODULE_KEYS = ["business", "groups", "channels", "dms", "webapp"]

#: Captured here because `Bot` has a field called `settings` of its own, which
#: would otherwise shadow `django.conf.settings` inside the class body.
AUTH_USER = settings.AUTH_USER_MODEL


#: What stopping a bot actually does, in one sentence.
#:
#: Named rather than written twice because two places say it: the finding a
#: chat row carries while the bot is stopped, and the footer under the switch
#: itself. The button this replaced said something else again — "bot xabarlarga
#: javob bermaydi" — which was a third wording *and* a claim this product
#: cannot make: a run already parked on a question is still finished, and every
#: message still reaches «Suhbatlar». `apps/bots/tests.py` asserts the panel
#: repeats this byte for byte.
PAUSED_NOTE = (
    "Bot to'xtatilgan — yangi suhbat boshlamaydi. Kelgan xabarlar «Suhbatlar» bo'limida saqlanadi, "
    "allaqachon boshlangan suhbatlar esa oxiriga yetadi."
)


#: How many languages one bot may speak. Three is not a storage limit — it is
#: how many translations of every single message an author will actually keep
#: up to date, and how many tabs fit in the corner of a text field.
MAX_LANGUAGES = 3


def default_languages() -> dict:
    """Which languages a bot speaks until someone says otherwise.

    Uzbek and Russian, because that is the pair a business here answers in: a
    large share of customers have their phone set to Russian, and a bot that
    can only be written in one language forces its author to choose which half
    of their customers to serve badly.

    Enabling a language costs nothing at runtime — a message with no Russian
    text falls back to the Uzbek one (see `apps.common.i18n.resolve_text`), so
    this default adds a place to write a translation, never a silent message.
    """
    return {"main": DEFAULT_LANGUAGE, "enabled": ["uz", "ru"]}


def default_settings() -> dict:
    """How a freshly connected bot presents itself until someone edits it.

    `workingHours` used to be here — a switch, the weekdays, two clock times, a
    timezone and an away message — and nothing in this repository ever read one
    of them. Working hours are real, one level down: a Business trigger carries
    its own `schedule` and `engine.matching._within_schedule` answers it, which
    is what «Ish vaqtidan tashqari avtojavob» is built on. A bot-level copy was
    a second answer to a question that already had one, sitting where the first
    would be looked for. See `0010_drop_bot_working_hours`.
    """
    return {
        "displayName": "",
        "description": "",
        "shortDescription": "",
        "language": "uz",
        "avatarEmoji": "🤖",
        "languages": default_languages(),
    }


def normalise_languages(stored) -> dict:
    """A stored `languages` setting, repaired.

    Applied on read as well as on write because the repair is what keeps this
    setting migration-free: a bot connected before it existed has no key at
    all, and one written by an older client may name a language this build does
    not have.
    """
    merged = default_languages()
    if isinstance(stored, dict):
        main = stored.get("main")
        if main in LANGUAGES:
            merged["main"] = main
        enabled = stored.get("enabled")
        if isinstance(enabled, (list, tuple)):
            # Order is the author's — it is the order the editor draws the
            # tabs in — so duplicates are dropped in place rather than sorted.
            cleaned = list(dict.fromkeys(code for code in enabled if code in LANGUAGES))
            if cleaned:
                merged["enabled"] = cleaned

    # The main language is spoken whatever the list says. A bot missing its own
    # language from the list would be asked for text it has nowhere to store.
    if merged["main"] not in merged["enabled"]:
        merged["enabled"] = [merged["main"], *merged["enabled"]]
    merged["enabled"] = merged["enabled"][:MAX_LANGUAGES]
    return merged


class Bot(models.Model):
    class Kind(models.TextChoices):
        BOT = "bot", "Bot"
        USERBOT = "userbot", "Userbot"

    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    #: Tenant this bot belongs to — every read is filtered by it.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="bots")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="bots")
    #: "@sunrise_academy_bot", or the masked phone number of a userbot.
    handle = models.CharField(max_length=120)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.BOT)
    status = models.CharField(max_length=32, default="Faol")
    status_tone = models.CharField(max_length=16, default="success")

    #: The real Bot API token. Never included in a list or detail response.
    token = models.CharField(max_length=128, blank=True)
    #: Telegram's own id for the bot, from `getMe`.
    telegram_id = models.BigIntegerField(null=True, blank=True)
    username = models.CharField(max_length=64, blank=True)

    #: Echoed back by Telegram on every update as `X-Telegram-Bot-Api-Secret-Token`.
    webhook_secret = models.CharField(max_length=64, default=new_id)
    #: The unguessable part of the webhook's own URL.
    #:
    #: The path used to end in the bot's id — `@OqimStudioQA_bot` — which is
    #: public by definition: it is how customers find the bot. Anyone who knew
    #: the handle knew the endpoint, and the only thing left protecting it was
    #: the header secret. Two independent secrets is the point: one names the
    #: bot, one proves the caller is Telegram, and neither is derivable from
    #: anything a stranger can see.
    webhook_token = models.CharField(max_length=64, default=new_secret, unique=True, db_index=True)
    #: Where we last told Telegram to post.
    webhook_url = models.URLField(blank=True)
    #: Where Telegram says it is posting, read back with `getWebhookInfo`.
    #: Kept separately because these two disagreeing is the whole failure:
    #: our column says "connected" while the bot receives nothing.
    webhook_actual_url = models.URLField(blank=True)
    webhook_error = models.CharField(max_length=280, blank=True)
    #: When Telegram last failed to deliver — its `last_error_date`.
    webhook_last_error_at = models.DateTimeField(null=True, blank=True)
    webhook_checked_at = models.DateTimeField(null=True, blank=True)
    #: Updates Telegram is holding because delivery failed. Anything above zero
    #: means the bot is not answering somebody right now.
    webhook_pending_updates = models.PositiveIntegerField(default=0)

    settings = models.JSONField(default=default_settings)
    #: JavaScript put above every Kod block this bot's flows run.
    #:
    #: The sandbox refuses every import it is offered — that is one of the six
    #: boundaries, not an oversight — so an author who wants the same discount
    #: helper in four blocks has nowhere to put it. This column is that place,
    #: and prepending it (`engine.script.compose`) gives shared functions
    #: without giving a module loader.
    #:
    #: On the bot rather than on the workspace because a script reads a bot's
    #: own conversations: two bots in one workspace can belong to two different
    #: businesses, and a helper written for one has no business running in the
    #: other. A column of its own rather than a key in `settings` because it is
    #: read on the hot path of every Kod block and edited by its own endpoint.
    script_library = models.TextField(blank=True, default="")
    #: When the library was last written, and null until it first was.
    #:
    #: Not `updated_at`, which is `auto_now` and moves for a rotated token or an
    #: hourly webhook check — the Kod panel prints this under the editor as
    #: "saqlandi", and a bot whose library nobody has ever opened would read as
    #: having been saved a minute ago.
    script_library_updated_at = models.DateTimeField(null=True, blank=True)
    #: Which of the five modules this bot answers on. A module missing here is
    #: off: the dispatcher never even looks for its flows.
    enabled_modules = models.JSONField(default=list)
    #: Stopped from the panel — the one switch that is about the bot rather
    #: than about one of its surfaces.
    #:
    #: A column and not a webhook that gets deleted, because deleting the
    #: webhook is not something this product can keep: `reconcile_webhooks`
    #: re-registers every bot with a token on boot, on `worker_ready` and every
    #: ten minutes, and `BotViewSet.retrieve` repairs one the moment somebody
    #: opens its page. A pause that three unrelated schedules undo is worse
    #: than none. It would also throw away everything Telegram tried to deliver
    #: while it was off, which is the opposite of what stopping is for.
    is_paused = models.BooleanField(default=False)

    connected_by = models.ForeignKey(AUTH_USER, on_delete=models.SET_NULL, null=True)
    connected_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["handle"]

    def __str__(self) -> str:
        return self.handle

    @property
    def token_masked(self) -> str:
        """What the settings screen shows in place of the token."""
        if not self.token:
            return ""
        head, _, tail = self.token.partition(":")
        return f"{head}:{'*' * 6}{tail[-4:]}" if tail else f"{'*' * 6}{self.token[-4:]}"

    @property
    def languages(self) -> dict:
        """The languages this bot speaks, with anything it predates filled in.

        Merged on read rather than in a migration: every bot connected before
        this setting existed has no `languages` key, and the runtime asking for
        `bot.languages["main"]` must not depend on whether a migration reached
        that particular row.
        """
        return normalise_languages((self.settings or {}).get("languages"))

    @property
    def main_language(self) -> str:
        """The language this bot answers in when nothing points elsewhere."""
        return self.languages["main"]

    def module_enabled(self, module_key: str) -> bool:
        # A stopped bot answers on no surface, whatever its switches say. Read
        # here rather than in the dispatcher because this method *is* what the
        # dispatcher asks — `engine.matching.find_trigger` calls it before it
        # looks for a flow — so the runtime, the chat findings and the panel
        # all get the same answer and none of them can be taught a different
        # one by accident.
        if self.is_paused:
            return False
        # An empty list is a bot nobody has configured yet: "dms" answers anyway,
        # because a bot with a token replies to /start whether or not anyone
        # opened the modules screen.
        if not self.enabled_modules:
            return module_key == "dms"
        return module_key in self.enabled_modules


class BotActivity(models.Model):
    """What happened to this bot, newest first. Feeds the overview panel."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="activity")
    text = models.CharField(max_length=280)
    icon = models.CharField(max_length=48, default="robot")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "bot activity"

    def __str__(self) -> str:
        return self.text


class BusinessConnection(models.Model):
    """A Telegram Business account that has attached this bot to its inbox.

    Telegram sends `business_connection` when someone connects the bot in
    Settings → Business → Chatbots; every `business_message` afterwards carries
    the id stored here, which is how a message is traced back to the account it
    belongs to.
    """

    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="business_connections")
    #: Telegram's `business_connection_id`.
    connection_id = models.CharField(max_length=64, unique=True)
    user_chat_id = models.BigIntegerField(null=True, blank=True)
    user_name = models.CharField(max_length=120, blank=True)
    username = models.CharField(max_length=64, blank=True)
    #: The `BusinessBotRights` object as Telegram sent it.
    rights = models.JSONField(default=dict)
    is_enabled = models.BooleanField(default=True)
    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-connected_at"]

    def __str__(self) -> str:
        return f"{self.user_name or self.connection_id}"


class PaymentConnection(models.Model):
    """A payment provider token attached to a bot.

    The token itself never leaves the server: the API returns only the tail,
    which is all the card in the interface needs.
    """

    class Mode(models.TextChoices):
        TEST = "test", "Test"
        LIVE = "live", "Live"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="payment_connections")
    provider_id = models.CharField(max_length=48)
    token = models.CharField(max_length=255, blank=True)
    #: Unset for providers that need no token of their own (Telegram Stars).
    mode = models.CharField(max_length=8, choices=Mode.choices, blank=True)
    status = models.CharField(max_length=32, default="Ulangan")
    status_tone = models.CharField(max_length=16, default="success")
    error = models.CharField(max_length=280, blank=True)
    connected_at = models.DateTimeField(auto_now_add=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["provider_id"]
        constraints = [models.UniqueConstraint(fields=["bot", "provider_id"], name="uniq_bot_provider")]

    def __str__(self) -> str:
        return f"{self.bot_id}:{self.provider_id}"

    @property
    def token_masked(self) -> str | None:
        return f"•••• {self.token[-4:]}" if self.token else None


class ManagedBotRequest(models.Model):
    """One "create a bot from inside the panel" attempt, waiting for Telegram.

    Bot API 9.6 let a bot own other bots: the panel sends the reader to
    `t.me/newbot/<manager>/<username>`, they confirm a screen Telegram draws,
    and the manager bot is handed the new bot in a `managed_bot` update
    (`apps.bots.managed`). What it is *not* handed is any payload of ours —
    unlike a `/start` deep link, this URL carries nothing back — so the only
    thread joining the update to the person who asked for it is their Telegram
    id. That is what this row exists to hold, alongside where the bot should
    land once it arrives.

    Short-lived on purpose. An abandoned request that stayed open would claim
    the next bot that person creates anywhere, months later, and drop it into a
    project they had forgotten about.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Kutilmoqda"
        READY = "ready", "Tayyor"
        FAILED = "failed", "Xato"

    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="bot_requests")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="bot_requests")
    requested_by = models.ForeignKey(AUTH_USER, on_delete=models.CASCADE, related_name="bot_requests")
    #: Copied from the user at open time: re-reading it later would let a
    #: changed link retarget a request that is already in flight.
    telegram_id = models.BigIntegerField(db_index=True)

    suggested_name = models.CharField(max_length=64, blank=True)
    suggested_username = models.CharField(max_length=64, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    bot = models.ForeignKey(Bot, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    error = models.CharField(max_length=280, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["telegram_id", "status"])]

    def __str__(self) -> str:
        return f"{self.suggested_username or self.id} · {self.status}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at


class BotChat(models.Model):
    """A group or channel this bot belongs to, as far as anyone here knows.

    Nothing stored which chats a bot was in before this: `my_chat_member` was
    read only to notice a private chat being blocked, so «bot guruhda ishlamayapti»
    could only be answered by opening Telegram and looking. The panel had no
    list to look at, and the two facts that decide whether the bot works at all
    — is it an administrator, and what was it granted — are not on any screen a
    workspace can reach.

    **Telegram is the authority and this table is a cache of it.** Every column
    is written from something Telegram said: the `my_chat_member` update that
    announced the change, or a refresh that asked. Which means the interesting
    question is not what to store but what to do when the asking fails, and the
    answer is on `refreshed_at`/`refresh_error` — see `chats.refresh_chat`.

    Keyed by `(bot, chat_id)` rather than on the chat alone: two bots of one
    workspace can sit in the same group with different rights, and the row is
    about a bot's standing in a chat rather than about the chat.
    """

    class Type(models.TextChoices):
        GROUP = "group", "Guruh"
        SUPERGROUP = "supergroup", "Superguruh"
        CHANNEL = "channel", "Kanal"

    class Status(models.TextChoices):
        #: Telegram's own `ChatMember.status` strings, unchanged. Translating
        #: them into a vocabulary of ours would be a mapping to keep in step
        #: with an enumeration only Telegram may extend.
        CREATOR = "creator", "Egasi"
        ADMINISTRATOR = "administrator", "Administrator"
        MEMBER = "member", "A'zo"
        RESTRICTED = "restricted", "Cheklangan"
        LEFT = "left", "Chiqib ketgan"
        KICKED = "kicked", "Chiqarilgan"

    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="chats")
    #: Telegram's own id — negative for groups, `-100…` for supergroups and
    #: channels. Every Bot API call about this chat is addressed with it.
    chat_id = models.BigIntegerField()
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.GROUP)
    title = models.CharField(max_length=200, blank=True)
    #: Public chats have one; it is also the only thing a person can search for
    #: to check the panel is talking about the room they think it is.
    username = models.CharField(max_length=64, blank=True)
    #: `ChatFullInfo.invite_link` — the primary link, read on a refresh.
    invite_link = models.CharField(max_length=280, blank=True)

    #: What the *bot* is in this chat, from `ChatMemberUpdated.new_chat_member`.
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.MEMBER)
    #: `ChatMemberAdministrator`'s booleans as Telegram sent them.
    #:
    #: An owner (`creator`) is stored with every right set instead: Telegram
    #: sends none of the `can_*` fields on that variant because the answer is
    #: "all of them", and a screen reading the object literally would show the
    #: one member who can do everything as able to do nothing.
    rights = models.JSONField(default=dict)

    #: `getChatMemberCount`, and when it was actually read.
    #:
    #: Two columns because the number alone cannot say how old it is, and a
    #: refresh that fails keeps the old one — a count with a date on it is a
    #: fact the reader can judge, an undated one is a claim.
    member_count = models.PositiveIntegerField(null=True, blank=True)
    member_count_at = models.DateTimeField(null=True, blank=True)
    #: `ChatFullInfo.join_by_request` — joining needs an administrator's nod,
    #: which is the only case where the bot lacking `can_invite_users` is worth
    #: saying out loud.
    join_by_request = models.BooleanField(default=False)

    #: When the bot became a member, taken from the update's own `date` rather
    #: than from the clock here: a webhook re-delivered an hour later would
    #: otherwise record the hour, not the event.
    added_at = models.DateTimeField(null=True, blank=True)
    #: Set when the bot left or was removed, and cleared if it is added back.
    left_at = models.DateTimeField(null=True, blank=True)

    #: When Telegram last confirmed any of the above, and why the last attempt
    #: did not. Both survive a failure — see `chats.refresh_chat`.
    refreshed_at = models.DateTimeField(null=True, blank=True)
    refresh_error = models.CharField(max_length=280, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Where the bot still is, first: a chat it was removed from is history
        # and the list is read to find out what is wrong with the live ones.
        #
        # `nulls_first` spelled out, because the default is not the same on both
        # databases this runs on: SQLite sorts NULL first ascending and
        # PostgreSQL sorts it last, so a bare `"left_at"` would put every
        # departed chat at the top of the list on the one machine that has real
        # data on it.
        ordering = [models.F("left_at").asc(nulls_first=True), "title", "chat_id"]
        constraints = [models.UniqueConstraint(fields=["bot", "chat_id"], name="uniq_bot_chat")]
        indexes = [models.Index(fields=["bot", "type"])]

    def __str__(self) -> str:
        return f"{self.title or self.chat_id} ({self.type})"

    @property
    def is_member(self) -> bool:
        """Whether the bot is still in this chat at all."""
        return self.status not in {self.Status.LEFT, self.Status.KICKED}

    @property
    def is_administrator(self) -> bool:
        return self.status in {self.Status.ADMINISTRATOR, self.Status.CREATOR}

    @property
    def module_key(self) -> str:
        """Which of the bot's modules answers in this chat.

        The same derivation `engine.events.IncomingEvent.module_key` makes from
        an update, so "the Guruh module is switched off" can be said on this
        screen about the very chat where it is being noticed.
        """
        return "channels" if self.type == self.Type.CHANNEL else "groups"

    def can(self, right: str) -> bool:
        """Whether Telegram granted the bot one named administrator right."""
        return bool(self.rights.get(right)) if self.is_administrator else False
