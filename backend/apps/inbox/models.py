"""Suhbatlar — every message that crossed a bot, in either direction.

There is no `Conversation` model, on purpose. `Contact` already is one row per
Telegram user per bot, which is exactly what a chat is: the same person writing
to two of a workspace's bots is two chats, because that is what they are on the
phone as well. So a conversation is a contact, and this is the messages in it.

Why the rows exist at all. Before them the only text kept anywhere was
`FlowRunStep`, which is the trace of a *flow* — so a message that matched no
trigger left nothing behind at all (`dispatch` returns `no_trigger` and stops).
That is the message an operator most needs to read: somebody wrote something
the bot did not understand, and nobody could see it afterwards.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.bots.models import Bot
from apps.common.models import new_id
from apps.contacts.models import Contact
from apps.workspaces.models import Workspace


class Message(models.Model):
    class Direction(models.TextChoices):
        IN = "in", "Kelgan"
        OUT = "out", "Ketgan"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    #: Denormalised from `contact` so the conversation list filters one table.
    #: Same reasoning as `Contact` holding both — a tenant filter is on every
    #: read there is, and it does not get to be a join.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="messages")
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="messages")
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="messages")

    direction = models.CharField(max_length=4, choices=Direction.choices)
    #: What arrived or was sent: the event kind for an incoming update
    #: ("message", "callback", "payment"…), the content kind for an outgoing one
    #: ("text", "photo", "invoice"…). A chat row that carries no text — a photo,
    #: a tap — is rendered from this.
    kind = models.CharField(max_length=24, default="text")
    text = models.TextField(blank=True)
    #: Null on everything the runtime sent; the operator who wrote it otherwise.
    #: That is the whole difference between "the bot answered" and "somebody did".
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_messages",
    )
    #: Telegram's own id, when there is one — an outgoing send returns it and an
    #: incoming update carries it. Kept so a later edit or delete can find it.
    telegram_message_id = models.BigIntegerField(null=True, blank=True)
    #: Anything structured behind the line: the media types, the callback data,
    #: the payment, the Bot API payload that was sent.
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        #: Oldest first — a thread is read downwards, and the list asks for the
        #: newest explicitly.
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["contact", "created_at"]),
            models.Index(fields=["workspace", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.contact_id} · {self.direction} · {self.text[:32]}"
