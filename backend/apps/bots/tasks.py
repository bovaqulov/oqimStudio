"""Background work about bots themselves."""

from __future__ import annotations

import logging

from celery import shared_task

from .models import Bot
from .services import check_webhook, reconcile_webhooks, register_webhook

logger = logging.getLogger(__name__)


@shared_task(name="apps.bots.tasks.check_webhooks")
def check_webhooks() -> int:
    """Hourly: ask Telegram whether each connected bot's webhook is still ours.

    Telegram quietly stops delivering to an endpoint that kept failing, and the
    first sign is usually a customer saying the bot went silent. Checking on a
    schedule turns that into a warning on the bot's own screen.
    """
    checked = 0
    for bot in Bot.objects.exclude(token="").iterator():
        result = check_webhook(bot)
        if not result.get("ok"):
            register_webhook(bot)
        checked += 1
    return checked


@shared_task(name="apps.bots.tasks.register_webhook")
def register_webhook_task(bot_id: str) -> bool:
    bot = Bot.objects.filter(pk=bot_id).first()
    return register_webhook(bot) if bot else False


@shared_task(name="apps.bots.tasks.reconcile_webhooks")
def reconcile_webhooks_task() -> int:
    """Makes Telegram agree with where this backend is, for every bot.

    Runs when a worker boots and from the panel's own button. Sends nothing
    when everything already agrees, so it is safe to run often.
    """
    results = reconcile_webhooks()
    changed = sum(1 for row in results if row["changed"])
    if changed:
        logger.info("re-registered %s webhook(s) of %s", changed, len(results))
    return changed
