"""Background work for the runtime.

Everything a webhook triggers happens here rather than in the request: Telegram
retries an update it did not get a fast 200 for, so the HTTP handler's only job
is to accept the update and hand it on.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.bots.models import Bot
from apps.flows.models import FlowRun

from .dispatch import ChatBusy, chat_lock, dispatch
from .runner import deliver_followup, resume_after_delay

logger = logging.getLogger(__name__)


@shared_task(name="apps.engine.tasks.process_update", bind=True, max_retries=3, default_retry_delay=10)
def process_update(self, bot_id: str, update: dict) -> dict:
    """Routes one Telegram update. Retries transient failures, drops unknown bots."""
    bot = Bot.objects.filter(pk=bot_id).select_related("workspace", "project").first()
    if bot is None:
        logger.warning("update for unknown bot %s", bot_id)
        return {"handled": False, "reason": "unknown_bot"}
    try:
        return dispatch(bot, update)
    except Exception as exc:  # noqa: BLE001 - a retry is better than a lost message
        logger.exception("dispatch failed for bot %s", bot_id)
        raise self.retry(exc=exc) from exc


@shared_task(name="apps.engine.tasks.resume_run")
def resume_run(run_id: str) -> str:
    """Wakes one run parked on a "Kutish" block.

    Under the same per-chat lock a live update takes: a wake firing in the
    same instant the customer types `/start` had two workers walking the same
    conversation — one of them a run `_close_superseded_runs` had already
    ended. A busy chat is simply left asleep: the run keeps `resume_at`, and
    the minute sweep re-queues it into a freed lock.
    """
    run = FlowRun.objects.filter(pk=run_id).select_related("flow", "bot", "contact", "workspace").first()
    if run is None or run.status != FlowRun.Status.SLEEPING:
        return "skipped"
    try:
        with chat_lock(run.bot_id, run.contact.chat_id if run.contact_id else None):
            run.refresh_from_db()
            if run.status != FlowRun.Status.SLEEPING:
                # Closed or resumed while this task waited for the chat.
                return "skipped"
            resume_after_delay(run)
    except ChatBusy:
        logger.info("chat busy — run %s stays asleep for the sweep", run_id)
        return "busy"
    return run.status


@shared_task(name="apps.engine.tasks.send_followup")
def send_followup(run_id: str, node_id: str, armed_at: str = "") -> str:
    """The reminder a "Kechiktirilgan eslatma" block armed.

    Nothing here waits on the run, and the run may well have finished: the
    block let the flow walk straight past it, which is the whole point of it.
    `armed_at` is the instant the reminder was set, and the only thing that
    calls it off is the customer having been in touch since.
    """
    run = FlowRun.objects.filter(pk=run_id).select_related("flow", "bot", "contact", "workspace").first()
    if run is None:
        return "skipped"
    try:
        with chat_lock(run.bot_id, run.contact.chat_id if run.contact_id else None):
            return deliver_followup(run, node_id, parse_datetime(armed_at) if armed_at else None)
    except ChatBusy:
        # Mid-conversation is the wrong moment for a reminder anyway. Unlike a
        # sleeping run this has no sweep behind it, so it re-queues itself.
        send_followup.apply_async(args=[run_id, node_id, armed_at], countdown=15)
        return "busy"


@shared_task(name="apps.engine.tasks.delete_message")
def delete_message(bot_id: str, chat_id: int | str, message_id: int) -> str:
    """Takes a message away some seconds after the one replacing it went out.

    Its own task because the delay is the point: an immediate delete happens
    inline, before the new message is sent, so the reader never sees both. A
    held-back one is the opposite — the new message goes first and this catches
    up — which is what an author reaches for when the message being replaced is
    worth finishing.

    Failure is logged and swallowed. By the time this runs the replacement is
    already on screen, so the worst case is one extra message left in the chat;
    raising would retry a call that will keep being refused for the same reason
    (the 48-hour wall, or a reader who deleted it first).
    """
    bot = Bot.objects.filter(pk=bot_id).first()
    if bot is None or not bot.token:
        return "no_bot"
    from apps.telegram.client import TelegramError, client_for

    from .sender import build_delete_call

    method, payload = build_delete_call(chat_id, message_id)
    try:
        client_for(bot).call(method, payload)
    except TelegramError as exc:
        logger.info("delayed delete of %s in %s failed: %s", message_id, chat_id, exc.message)
        return "failed"
    return "deleted"


@shared_task(name="apps.engine.tasks.resume_due_runs")
def resume_due_runs() -> int:
    """Safety net for wake-ups that were lost with their worker.

    The countdown task is the normal path; this is the minute-by-minute sweep
    that means a broker restart costs a late message rather than a dead run.
    """
    due = FlowRun.objects.filter(
        status=FlowRun.Status.SLEEPING, resume_at__isnull=False, resume_at__lte=timezone.now()
    ).values_list("id", flat=True)
    count = 0
    for run_id in list(due):
        resume_run.delay(run_id)
        count += 1
    return count


@shared_task(name="apps.engine.tasks.forget_old_updates")
def forget_old_updates(days: int = 2) -> int:
    """Drops the delivery record for updates Telegram has long stopped retrying."""
    from .models import ProcessedUpdate

    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = ProcessedUpdate.objects.filter(created_at__lt=cutoff).delete()
    return deleted
