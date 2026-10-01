"""What the runtime remembers between updates.

The flow's own state lives on `flows.FlowRun`. What is here is the one fact
that belongs to the *delivery* rather than to the conversation: which updates
have already been handled.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.bots.models import Bot


class ProcessedUpdate(models.Model):
    """One Telegram update, recorded so it is never run twice.

    Telegram re-delivers anything it did not get a prompt 2xx for — a slow
    webhook, a restart mid-request, a network blip — and a second delivery of
    the same message would answer the customer twice and, worse, feed the same
    answer into a question all over again. The unique key is what makes the
    webhook idempotent; the timestamp is what lets old rows be swept.
    """

    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="processed_updates")
    update_id = models.BigIntegerField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["bot", "update_id"], name="uniq_update_per_bot")]
        indexes = [models.Index(fields=["created_at"])]

    def __str__(self) -> str:
        return f"{self.bot_id}:{self.update_id}"
