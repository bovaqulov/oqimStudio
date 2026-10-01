"""The webhook.

This endpoint has one job and a hard deadline. Telegram waits a few seconds for
an answer; anything slower is recorded on its side as "Read timeout expired",
the update stays pending, and to everyone watching the bot has simply gone
silent. So the handler checks that the request really came from Telegram, gets
the update to a worker, and answers.

When there is no worker to get it to — no broker running, a queue that is down
— the update is handled inside the request instead. That is slower than it
should be, and it is still the right trade: a bot that answers late is a bot,
and a bot that answers never is nothing.

Every one of these detours is written to the bot's own activity log. A webhook
that fails quietly is the state this endpoint used to fail in, and it is
indistinguishable from a bot nobody wrote to.
"""

from __future__ import annotations

import hmac
import json
import logging

from django.conf import settings
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from kombu import exceptions as kombu_exceptions

from apps.bots.models import Bot
from apps.bots.services import log_activity
from apps.engine.tasks import process_update

logger = logging.getLogger(__name__)

SECRET_HEADER = "HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN"

#: Telegram re-delivers a failed update every few seconds. One activity entry
#: per problem per bot in this window is a diagnosis; sixty of them is a wall of
#: noise that hides everything else the bot did.
PROBLEM_LOG_WINDOW_SECONDS = 300


def report_problem(bot: Bot, text: str, icon: str = "warning") -> None:
    """Records a webhook problem on the bot itself, at most once per window."""
    key = f"webhook-problem:{bot.pk}:{text[:60]}"
    if cache.add(key, 1, PROBLEM_LOG_WINDOW_SECONDS):
        log_activity(bot, text[:280], icon)


@csrf_exempt
@require_POST
def webhook(request, token: str):
    """Receives updates for one bot.

    Two independent secrets have to line up. The path carries
    `webhook_token`, which is what identifies the bot at all — so an update can
    be attributed before its body is parsed, and an unknown token never reaches
    a database row that could be probed. The header then carries
    `webhook_secret`, compared in constant time, which is what proves the
    caller is Telegram rather than somebody who learned the URL.

    The path used to carry the bot's id — the same handle printed on the bot's
    Telegram profile — which meant the URL was public and the header was
    carrying the whole load on its own.
    """
    bot = Bot.objects.filter(webhook_token=token).select_related("workspace", "project").first()
    if bot is None:
        # Deliberately the same answer a wrong secret gets below, and no log
        # line naming the token: an endpoint that distinguishes "no such bot"
        # from "wrong secret" is an endpoint that answers questions.
        return JsonResponse({"ok": False, "error": "invalid secret"}, status=401)

    # A blank secret is a refusal, not a skip. This read `if bot.webhook_secret
    # and not compare_digest(...)`, which meant a row with an empty column
    # answered *every* caller who knew the path — the header stopped being
    # checked at all, silently, in the one case where checking mattered most.
    # No such row exists (`webhook_secret` has had `default=new_id` since the
    # initial migration, and the live table has none), so nothing legitimate
    # loses its webhook here; what changes is that a row created around the
    # default — a fixture, an import, a hand-written INSERT — cannot open the
    # door by being incomplete.
    provided = request.META.get(SECRET_HEADER, "")
    if not bot.webhook_secret or not hmac.compare_digest(provided, bot.webhook_secret):
        # Named apart in the log, because the two need different fixes: one is
        # somebody else calling, the other is this bot never having been given
        # a secret, and «maxfiy kalit mos kelmadi» would send whoever reads the
        # activity feed looking for a mismatch that cannot happen.
        if not bot.webhook_secret:
            logger.warning("webhook rejected for %s: no secret configured", bot.id)
            report_problem(bot, "Webhook rad etildi — botda maxfiy kalit yo'q, uni qayta ulang")
        else:
            logger.warning("webhook rejected for %s: bad secret", bot.id)
            report_problem(bot, "Webhook rad etildi — maxfiy kalit mos kelmadi")
        return JsonResponse({"ok": False, "error": "invalid secret"}, status=401)

    try:
        update = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        report_problem(bot, "Webhook o'qib bo'lmadi — noto'g'ri JSON")
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)

    try:
        process_update.delay(bot.id, update)
        return JsonResponse({"ok": True, "queued": True})
    except (kombu_exceptions.OperationalError, OSError) as exc:
        logger.warning("broker unavailable for %s: %s", bot.id, exc)

    if not settings.TELEGRAM_INLINE_FALLBACK:
        # Telegram re-delivers anything it does not get a 2xx for, so the update
        # is not lost — it waits for the queue to come back.
        report_problem(bot, "Navbat ishlamayapti — xabar keyinga qoldirildi")
        return JsonResponse({"ok": False, "error": "queue unavailable"}, status=503)

    report_problem(bot, "Navbat ishlamayapti — xabarlar to'g'ridan-to'g'ri qayta ishlanmoqda")
    try:
        # Imported here rather than at module level: the runtime pulls in the
        # whole engine, and the path that only enqueues should not pay for it.
        from apps.engine.dispatch import dispatch

        result = dispatch(bot, update)
    except Exception as exc:  # noqa: BLE001 - the bot's own log is where this has to end up
        logger.exception("inline dispatch failed for %s", bot.id)
        report_problem(bot, f"Xabarni qayta ishlashda xato: {exc}")
        # 500 asks Telegram to try again, which is the right answer to a failure
        # that may well be temporary.
        return JsonResponse({"ok": False, "error": "dispatch failed"}, status=500)

    return JsonResponse({"ok": True, "queued": False, "handled": result.get("handled", False)})
