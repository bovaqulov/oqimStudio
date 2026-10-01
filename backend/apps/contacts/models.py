"""Contacts — the people on the other side of a bot.

One row per Telegram user per bot: the same person writing to two of a
workspace's bots is two contacts, because tags, variables and consent belong to
the conversation they were collected in, not to the account behind it.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.bots.models import Bot
from apps.common.i18n import LANGUAGE_VARIABLE, contact_language
from apps.common.models import new_id
from apps.workspaces.models import Workspace


class Contact(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="contacts")
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="contacts")

    telegram_user_id = models.BigIntegerField()
    #: Where the bot writes back. Differs from `telegram_user_id` in groups and channels.
    chat_id = models.BigIntegerField()
    chat_type = models.CharField(max_length=16, default="private")

    first_name = models.CharField(max_length=120, blank=True)
    last_name = models.CharField(max_length=120, blank=True)
    username = models.CharField(max_length=64, blank=True)
    language_code = models.CharField(max_length=16, blank=True)
    phone = models.CharField(max_length=32, blank=True)

    #: Set when Telegram reports the user blocked the bot — the runtime stops sending.
    is_blocked = models.BooleanField(default=False)
    #: Everything a "Teg / o'zgaruvchi" block wrote, plus answers captured by questions.
    variables = models.JSONField(default=dict)
    #: Where this contact first arrived from, for the analytics breakdown.
    source = models.CharField(max_length=48, blank=True)

    first_seen_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-last_seen_at"]
        constraints = [
            models.UniqueConstraint(fields=["bot", "telegram_user_id"], name="uniq_contact_per_bot"),
        ]
        indexes = [models.Index(fields=["workspace", "last_seen_at"])]

    def __str__(self) -> str:
        return self.display_name

    @property
    def display_name(self) -> str:
        full = f"{self.first_name} {self.last_name}".strip()
        return full or (f"@{self.username}" if self.username else str(self.telegram_user_id))

    @property
    def language(self) -> str:
        """Which of the bot's languages this person is answered in.

        Not a column of its own: what a customer chose is already an ordinary
        variable (`mijoz_tili`), written by the same block that writes every
        other answer and read by the same placeholders — while Telegram's guess
        is already `language_code`. A third column would be a second place for
        the same fact to live, and the two would drift the first time a flow set
        the variable without going through here.
        """
        return contact_language(self)

    def set_language(self, language: str) -> None:
        """Records the language this person picked for themselves.

        Their own choice outranks their phone's setting for good — a Tashkent
        phone set to Russian belonging to somebody who answers in Uzbek is the
        common case, not the odd one.
        """
        self.set_variable(LANGUAGE_VARIABLE, language)

    def touch(self) -> None:
        self.last_seen_at = timezone.now()
        self.save(update_fields=["last_seen_at"])

    def set_variable(self, name: str, value) -> None:
        self.variables[name] = value
        self.save(update_fields=["variables"])

    def tag_names(self) -> list[str]:
        return list(self.tags.values_list("name", flat=True))


class ContactTag(models.Model):
    """A label a flow put on a contact. Its own table so segments can be queried."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="tags")
    name = models.CharField(max_length=64)
    #: The flow that added it, when it was not added by hand.
    added_by_flow_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["contact", "name"], name="uniq_contact_tag")]

    def __str__(self) -> str:
        return self.name
