"""Connecting a bot, and keeping its webhook true.

"Connected" means three things at once: the token is valid, Telegram knows
where to deliver this bot's updates, and the workspace has a row saying so.
They are done together here so a half-connected bot is not a state the rest of
the code has to know about.
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from datetime import datetime
from datetime import timezone as dt_timezone

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common.exceptions import ApiError
from apps.common.models import new_id
from apps.realtime.broadcast import publish, workspace_group
from apps.telegram.client import TelegramClient, TelegramError, client_for

from .models import Bot, BotActivity

logger = logging.getLogger(__name__)


def webhook_url_for(bot: Bot) -> str:
    """Where Telegram should POST this bot's updates.

    One URL per bot rather than one shared endpoint: the path identifies the
    bot, so an update can be routed before its body is even parsed, and
    revoking one bot's webhook cannot touch another's.

    The path carries `webhook_token`, not the bot id. The id is the handle
    customers use to find the bot — public by construction — so a URL built
    from it was a public URL, and the header secret was the only thing left
    guarding it. Now a caller has to know both, and neither can be derived from
    the other or from anything visible outside this database.
    """
    return f"{settings.PUBLIC_BASE_URL}/api/telegram/webhook/{bot.webhook_token}/"


#: How a line that has happened more than once says so, and how that is read
#: back off it. The count lives in the sentence because the sentence is the
#: whole of what the feed shows.
REPEAT_SUFFIX = " · {count} marta"
_REPEAT = re.compile(r" · (\d+) marta$")

#: Room for the suffix inside `BotActivity.text`'s 280.
ACTIVITY_TEXT_LIMIT = 240


def _without_repeat(text: str) -> tuple[str, int]:
    """A stored line split back into its sentence and how many times it happened."""
    match = _REPEAT.search(text)
    return (text[: match.start()], int(match.group(1))) if match else (text, 1)


def log_activity(bot: Bot, text: str, icon: str = "robot") -> BotActivity:
    """One line in the bot's feed — or, if it is the same line again, a count on the last one.

    `reconcile_webhooks` runs when a worker boots and every hour after that, and
    a bot Telegram will never accept fails on every pass. This database held
    1811 identical "Webhook ulanmadi: Unauthorized" rows against one demo bot:
    the panel shows the last eight, so its whole feed was one sentence repeated,
    and the home screen's was too. Collapsing keeps everything the repeats
    actually carried — what happened, how often, and when it last did — in the
    one line a reader can take in.
    """
    text = text[:ACTIVITY_TEXT_LIMIT]
    latest = bot.activity.first()
    if latest is not None and latest.icon == icon and _without_repeat(latest.text)[0] == text:
        count = _without_repeat(latest.text)[1] + 1
        latest.text = f"{text}{REPEAT_SUFFIX.format(count=count)}"
        # The feed is ordered by this, and a condition that is still failing
        # belongs where it last failed rather than where it began.
        latest.created_at = timezone.now()
        latest.save(update_fields=["text", "created_at"])
        entry = latest
    else:
        entry = BotActivity.objects.create(bot=bot, text=text, icon=icon)

    publish(
        workspace_group(bot.workspace_id),
        "bot.activity",
        {"botId": bot.id, "text": entry.text, "icon": icon, "when": entry.created_at.isoformat()},
    )
    return entry


#: Telegram's refusals, in the language the panel is written in.
#:
#: `exc.message` is Telegram's own English — "Unauthorized", "Not Found" — and
#: pasting it after an Uzbek half-sentence produced "Telegram tokenni qabul
#: qilmadi: Unauthorized", which tells somebody holding a mistyped token
#: nothing they can act on. The mapping is by `error_code`, not by wording,
#: because the wording is Telegram's to change and the code is not.
TOKEN_REFUSALS = {
    401: "Bu token noto'g'ri yoki bekor qilingan. @BotFather'da /mybots → API Token orqali yangisini oling.",
    404: "Bunday token topilmadi — nusxa ko'chirishda bir qismi tushib qolgan bo'lishi mumkin.",
    429: "Telegram so'rovlarni vaqtincha cheklab qo'ydi. Bir daqiqadan so'ng qayta urinib ko'ring.",
}
UNKNOWN_TOKEN_REFUSAL = "Telegram bu tokenni qabul qilmadi. Tokenni @BotFather'dan qayta nusxalab ko'ring."

#: Why `setWebhook` was refused, said the way the panel says everything else.
#:
#: The feed used to print Telegram's own English behind an Uzbek half-sentence
#: — "Webhook ulanmadi: Too Many Requests: retry after 1", "Webhook ulanmadi:
#: Unauthorized" — which is two languages in one line and, worse, tells the
#: reader nothing they can do. Keyed by `error_code` for the same reason
#: `TOKEN_REFUSALS` is: the wording belongs to Telegram, the code does not.
WEBHOOK_REFUSALS = {
    401: "Token qabul qilinmadi — bot o'chirilgan yoki tokeni almashtirilgan. @BotFather'dan yangisini oling.",
    404: "Telegram bu tokenni topmadi — token to'liq nusxalanmagan bo'lishi mumkin.",
    429: "Telegram so'rovlarni vaqtincha cheklab qo'ydi — biroz kutib qayta urinamiz.",
}

#: A 400 is Telegram objecting to the address itself, and which objection it is
#: only shows in the wording. Matched on the fragment that carries the meaning,
#: with a sentence naming the thing to look at.
WEBHOOK_ADDRESS_REFUSALS = [
    ("failed to resolve host", "Publik manzil topilmadi — tunnel yoki domen o'zgargan bo'lishi mumkin."),
    ("name or service not known", "Publik manzil topilmadi — tunnel yoki domen o'zgargan bo'lishi mumkin."),
    ("https", "Webhook faqat HTTPS manzilda ishlaydi — publik manzilni tekshiring."),
    ("port", "Telegram bu portga ulana olmaydi — 443, 80, 88 yoki 8443 bo'lishi kerak."),
    ("invalid webhook url", "Webhook manzili noto'g'ri — publik manzil sozlamasini tekshiring."),
    ("bad webhook", "Telegram bu webhook manzilini qabul qilmadi — publik manzilni tekshiring."),
]

UNKNOWN_WEBHOOK_REFUSAL = "Webhook ulanmadi — Telegram so'rovni qabul qilmadi. Birozdan so'ng qayta urinamiz."

#: What Telegram's `last_error_message` means, which is a different question
#: from why a registration was refused: here the webhook exists and the
#: delivery to it failed, so every sentence points at our own side.
WEBHOOK_DELIVERY_PROBLEMS = [
    ("wrong response from the webhook", "Server Telegramga noto'g'ri javob qaytardi — qayta ishga tushayotgan bo'lishi mumkin."),
    ("failed to resolve host", "Telegram publik manzilni topa olmadi — manzil o'zgargan bo'lishi mumkin."),
    ("connection refused", "Telegram publik manzilga ulana olmadi — server javob bermayapti."),
    ("timeout", "Server javob bermadi — so'rov vaqti tugadi."),
    ("ssl", "Sertifikat bilan muammo — HTTPS sozlamasini tekshiring."),
]

UNKNOWN_DELIVERY_PROBLEM = "Telegram so'nggi xabarni yetkaza olmadi — publik manzil ishlayotganini tekshiring."

#: Telegram is posting somewhere else. Said without the host: a quick tunnel
#: hands out a new name on every reconnect, so the name itself is noise, and
#: the address Telegram actually holds is a field of its own on the same
#: screen. It was also a full URL once, `webhook_token` included.
WEBHOOK_DRIFTED = "Telegram boshqa manzilga xabar yuboryapti — webhook yangilanishi kerak."
WEBHOOK_UNSET = "Telegramda webhook o'rnatilmagan — bot xabarlarni olmayapti."


def webhook_refusal(exc: TelegramError) -> str:
    """Why `setWebhook` failed, in Uzbek."""
    # No code at all is a transport failure, and `transport_message` has
    # already written that one in the language the feed is in.
    if exc.code is None:
        return exc.message
    if exc.code in WEBHOOK_REFUSALS:
        return WEBHOOK_REFUSALS[exc.code]
    lowered = exc.message.lower()
    for fragment, sentence in WEBHOOK_ADDRESS_REFUSALS:
        if fragment in lowered:
            return sentence
    return UNKNOWN_WEBHOOK_REFUSAL


def delivery_problem(message: str) -> str:
    """What Telegram's last delivery error means for the person reading the bot's page."""
    lowered = message.lower()
    for fragment, sentence in WEBHOOK_DELIVERY_PROBLEMS:
        if fragment in lowered:
            return sentence
    return UNKNOWN_DELIVERY_PROBLEM


def verify_token(token: str) -> dict:
    """Asks Telegram who this token belongs to. The only proof a token is real.

    In offline mode there is no Telegram to ask, so the answer is a canned one —
    which means *any* string gets in. `connect_bot` marks such a bot unverified
    rather than pretending, because a screen that says "Faol · Webhook ulandi"
    about a token nobody checked is worse than no screen at all.
    """
    try:
        return TelegramClient(token).get_me()
    except TelegramError as exc:
        raise ApiError(
            "invalid_token",
            TOKEN_REFUSALS.get(exc.code, UNKNOWN_TOKEN_REFUSAL),
            field="token",
        ) from exc


#: The standard library, as shipped. Beside the sandbox that runs it, because
#: the two are one thing: `engine/script/stdlib.js` is written against the six
#: boundaries in that folder and nothing else in the product may assume it.
STARTER_LIBRARY = Path(__file__).resolve().parent.parent / "engine" / "script" / "stdlib.js"


def starter_library() -> str:
    """The standard library a new bot starts with.

    A copy, taken at the moment the bot is connected, and not a file read on
    every run. Two reasons, and they point the same way. The author owns this
    file — `money()` formats som because most of them sell in som, and the one
    who does not has to be able to change it — so it has to be a thing they
    can edit rather than a thing the product keeps overwriting. And a bot that
    has worked for a year must not change behaviour because the shipped library
    did: every `{{ ifoda }}` in every flow calls into this text, and improving
    `parseDateUz` for new bots is not a reason to re-interpret an old bot's
    appointment times overnight.

    Read here rather than at import time so a checkout with the file missing —
    a partial deploy, a stripped image — connects a bot with an empty library
    instead of refusing to connect one at all. An empty library is the state
    every bot was in before this existed; a bot nobody can add is not.
    """
    try:
        return STARTER_LIBRARY.read_text(encoding="utf-8")
    except OSError:
        logger.warning("standart kutubxona o'qilmadi: %s", STARTER_LIBRARY)
        return ""


@transaction.atomic
def connect_bot(*, workspace, project, token: str, user, kind: str = Bot.Kind.BOT) -> Bot:
    """Validates a token with Telegram and stores the bot behind it."""
    profile = verify_token(token)
    username = profile.get("username", "")

    if Bot.objects.filter(workspace=workspace, telegram_id=profile.get("id")).exists():
        raise ApiError("bot_exists", "Bu bot allaqachon ulangan", field="token")

    # A readable primary key: the bot's own @username is what every screen and
    # every webhook path shows, so it is the key rather than a surrogate.
    bot_id = (username or str(profile.get("id"))).lower()[:60] or new_id()
    if Bot.objects.filter(pk=bot_id).exists():
        bot_id = f"{bot_id}-{new_id()[:4]}"

    # Nothing was actually checked when Telegram was never asked, and the bot
    # says so on every screen that reads its status.
    unverified = settings.TELEGRAM_OFFLINE
    bot = Bot.objects.create(
        id=bot_id,
        workspace=workspace,
        project=project,
        handle=f"@{username}" if username else str(profile.get("id")),
        kind=kind,
        status="Sozlanmoqda" if unverified else "Faol",
        status_tone="warning" if unverified else "success",
        token=token,
        telegram_id=profile.get("id"),
        username=username,
        connected_by=user,
        connected_at=timezone.now(),
        enabled_modules=["dms"],
        script_library=starter_library(),
    )
    bot.settings["displayName"] = profile.get("first_name", "") or bot.handle
    bot.save(update_fields=["settings"])

    log_activity(bot, "Bot loyihaga qo'shildi", "robot")
    if unverified:
        log_activity(bot, "Offline rejim — token Telegramda tekshirilmadi", "warning")
    # The webhook is registered outside the transaction's promise: a network
    # call that fails must not roll back a bot the user can retry from.
    transaction.on_commit(lambda: register_webhook(bot))
    return bot


def webhook_is_current(bot: Bot) -> bool:
    """Whether the address Telegram was given still matches where we live now."""
    return bool(bot.webhook_url) and bot.webhook_url == webhook_url_for(bot)


def ensure_webhook_current(bot: Bot) -> bool:
    """Re-registers the webhook when the public address has moved.

    A tunnel handed out a new name, a deployment moved domain: whatever the
    reason, Telegram is still posting to the old one and the bot has gone quiet
    for a reason nobody can see from the outside. Cheap because it does nothing
    at all in the normal case.
    """
    if webhook_is_current(bot) and not bot.webhook_error:
        return True
    return register_webhook(bot)


#: The longest wait a rate-limited `setWebhook` is worth sitting through. A
#: person is watching a bot page while this runs, so a wait longer than a few
#: seconds is better spent by the next scheduled pass than by the request.
MAX_RETRY_AFTER = 3.0

#: Telegram puts the wait in the refusal's text — "Too Many Requests: retry
#: after 1". It is also in the response's `parameters.retry_after`, which
#: `TelegramClient` does not keep; reading it out of the sentence is the price
#: of that, and the sentence is Telegram's own format.
_RETRY_AFTER = re.compile(r"retry after (\d+)")


def _retry_after(exc: TelegramError) -> float | None:
    """How long Telegram asked us to wait, when that is what it refused for."""
    if exc.code != 429:
        return None
    match = _RETRY_AFTER.search(exc.message.lower())
    return float(match.group(1)) if match else None


def _set_webhook(bot: Bot, url: str) -> None:
    """`setWebhook`, waiting once when Telegram says "not yet".

    A 429 here carries the number of seconds to hold off for, and ignoring it
    is why this bot's feed has sixty-eight "Too Many Requests: retry after 1"
    lines in it: every caller came back on its own schedule and was refused
    again. One wait of a second turns most of those into a webhook that is
    actually registered.
    """
    try:
        client_for(bot).set_webhook(url, secret_token=bot.webhook_secret)
    except TelegramError as exc:
        wait = _retry_after(exc)
        if wait is None or wait > MAX_RETRY_AFTER:
            raise
        logger.info("setWebhook rate-limited for %s, waiting %ss", bot.id, wait)
        time.sleep(wait)
        client_for(bot).set_webhook(url, secret_token=bot.webhook_secret)


def register_webhook(bot: Bot) -> bool:
    """Points Telegram at this backend for `bot`. Records the failure rather than raising."""
    url = webhook_url_for(bot)
    try:
        _set_webhook(bot, url)
    except TelegramError as exc:
        refusal = webhook_refusal(exc)
        bot.webhook_error = refusal[:280]
        bot.webhook_checked_at = timezone.now()
        bot.save(update_fields=["webhook_error", "webhook_checked_at"])
        log_activity(bot, f"Webhook ulanmadi. {refusal}", "warning")
        # Telegram's own wording stays here, where a developer is the reader.
        logger.warning("setWebhook failed for %s: %s", bot.id, exc)
        return False

    bot.webhook_url = url
    bot.webhook_error = ""
    bot.webhook_checked_at = timezone.now()
    bot.save(update_fields=["webhook_url", "webhook_error", "webhook_checked_at"])
    log_activity(bot, "Webhook ulandi", "plugs-connected")
    return True


def unregister_webhook(bot: Bot) -> bool:
    try:
        client_for(bot).delete_webhook()
    except TelegramError as exc:
        logger.warning("deleteWebhook failed for %s: %s", bot.id, exc)
        return False
    bot.webhook_url = ""
    bot.save(update_fields=["webhook_url"])
    log_activity(bot, "Webhook uzildi", "plugs")
    return True


#: How long the reachability probe waits for our own public address to answer.
#: Short on purpose: somebody is watching a button spin while it runs, and an
#: address slower than this is already too slow for Telegram's own deadline.
WEBHOOK_PROBE_TIMEOUT = 6.0

#: What a probe that never ran looks like. Distinct from a failed one — see
#: `probe_webhook_endpoint`.
UNPROBED = {"checked": False, "reachable": False, "status": None, "error": ""}


def probe_webhook_endpoint(url: str) -> dict:
    """Asks whether anything actually answers at `url`.

    Comparing two strings proves Telegram and this backend agree on where
    updates should go. It proves nothing about whether something is listening
    there — and a dead tunnel, a container that never came up or a DNS name
    that stopped resolving all leave the two strings matching and the bot
    silent. That gap is what this closes.

    *Any* HTTP answer counts as reachable, a 405 and a 401 included: the
    webhook endpoint takes POSTs carrying Telegram's secret header and nothing
    else, so refusing this request is what a healthy endpoint does. Only a
    connection that never got an answer at all — refused, unresolved, timed
    out — is a failure.
    """
    if not url:
        return {**UNPROBED, "checked": True, "error": "Webhook manzili yo'q"}
    if settings.TELEGRAM_OFFLINE:
        # Offline mode means nothing leaves this machine. Reporting
        # "unreachable" about an address nobody dialled would be the same kind
        # of lie this whole check exists to remove.
        return dict(UNPROBED)

    try:
        response = requests.head(url, timeout=WEBHOOK_PROBE_TIMEOUT, allow_redirects=True)
    except requests.RequestException:
        try:
            # A front that mishandles HEAD would otherwise read as a dead
            # address; GET is the same question asked the ordinary way.
            response = requests.get(url, timeout=WEBHOOK_PROBE_TIMEOUT, allow_redirects=True)
        except requests.RequestException as exc:
            logger.info("webhook probe failed for %s: %s", url, exc)
            return {"checked": True, "reachable": False, "status": None, "error": str(exc)[:200]}
    return {"checked": True, "reachable": True, "status": response.status_code, "error": ""}


def webhook_snapshot(bot: Bot, *, ok: bool, info: dict, probe: bool, error: str = "") -> dict:
    """One shape for every answer `check_webhook` can give.

    The panel decides "hammasi joyida" from four separate facts — where
    Telegram is posting, its last delivery error, how many updates it is
    holding, and whether the address answers at all. They travel named and
    apart so the screen can say *which* one failed, instead of collapsing them
    into a boolean that only ever explains itself as "muammo bor".
    """
    # The address we would register today, not the stored one: dialling where
    # Telegram was pointed last year answers a question nobody asked.
    expected = webhook_url_for(bot)
    return {
        "ok": ok,
        "url": expected,
        "actualUrl": bot.webhook_actual_url,
        "error": error or bot.webhook_error,
        "lastErrorAt": bot.webhook_last_error_at.isoformat() if bot.webhook_last_error_at else None,
        "pending": bot.webhook_pending_updates,
        "checkedAt": bot.webhook_checked_at.isoformat() if bot.webhook_checked_at else None,
        "probe": probe_webhook_endpoint(expected) if probe else dict(UNPROBED),
        "info": info,
    }


def check_webhook(bot: Bot, *, probe: bool = False) -> dict:
    """Reads back what Telegram thinks the webhook is.

    Telegram drops a webhook whose endpoint kept failing, and the first anyone
    hears of it is a bot that stopped answering — so the answer is stored on the
    bot and shown on its screen.

    `probe` adds the other half of the question: Telegram's answer is about its
    own records, and it will happily report a URL that has not answered in
    days. The unattended callers leave it off — they run for every bot on a
    schedule, and re-pointing a webhook is not the same job as testing an
    address — so it is on where a person asked and is waiting for the answer.
    """
    try:
        info = client_for(bot).get_webhook_info()
    except TelegramError as exc:
        refusal = webhook_refusal(exc)
        bot.webhook_error = refusal[:280]
        bot.webhook_checked_at = timezone.now()
        bot.save(update_fields=["webhook_error", "webhook_checked_at"])
        logger.warning("getWebhookInfo failed for %s: %s", bot.id, exc)
        return webhook_snapshot(bot, ok=False, info={}, probe=probe, error=refusal)

    expected = webhook_url_for(bot)
    actual = info.get("url") or ""
    reported = info.get("last_error_message", "")
    # Two different states, and only the first of them is an incident: Telegram
    # tried to deliver and could not, versus Telegram is pointed somewhere
    # else. The second is what a moved public address looks like, and
    # `reconcile_webhook` fixes it in the same pass.
    failed_delivery = delivery_problem(reported) if reported else ""
    error = failed_delivery
    if not error and actual != expected:
        error = WEBHOOK_DRIFTED if actual else WEBHOOK_UNSET

    last_error_date = info.get("last_error_date")
    bot.webhook_actual_url = actual[:200]
    bot.webhook_error = error[:280]
    bot.webhook_last_error_at = (
        datetime.fromtimestamp(last_error_date, tz=dt_timezone.utc) if last_error_date else None
    )
    bot.webhook_pending_updates = int(info.get("pending_update_count") or 0)
    bot.webhook_checked_at = timezone.now()
    bot.save(
        update_fields=[
            "webhook_actual_url",
            "webhook_error",
            "webhook_last_error_at",
            "webhook_pending_updates",
            "webhook_checked_at",
        ]
    )

    # Only a real delivery failure reaches the feed. An address that moved is
    # this product's own routine — a quick tunnel renames itself on every
    # reconnect — and it was writing four "Telegram boshqa manzilga
    # yuboryapti: …" warnings for every reconnect, about something the very
    # next line of `reconcile_webhook` puts right. What the feed keeps of that
    # is "Webhook ulandi", which is the part that happened.
    if failed_delivery:
        log_activity(bot, failed_delivery, "warning")
        logger.warning("telegram could not deliver to %s: %s", bot.id, reported)
    return webhook_snapshot(bot, ok=not error, info=info, probe=probe)


def reconcile_webhook(bot: Bot) -> dict:
    """Makes Telegram agree with where this backend actually is.

    Asks Telegram first rather than trusting our own column: the two ways a
    webhook goes wrong are the public address moving under us, and somebody
    pointing the bot elsewhere by hand — and only Telegram knows about the
    second one. Nothing is sent when the two already agree.
    """
    before = check_webhook(bot)
    if before.get("ok"):
        return {"botId": bot.id, "handle": bot.handle, "changed": False, "ok": True}

    fixed = register_webhook(bot)
    if fixed:
        check_webhook(bot)
    return {
        "botId": bot.id,
        "handle": bot.handle,
        "changed": fixed,
        "ok": fixed and not bot.webhook_error,
        "error": bot.webhook_error,
    }


def reconcile_webhooks(workspace=None) -> list[dict]:
    """Every connected bot, in one pass. Used on boot, on a schedule, and by hand."""
    bots = Bot.objects.exclude(token="")
    if workspace is not None:
        bots = bots.filter(workspace=workspace)
    return [reconcile_webhook(bot) for bot in bots.iterator()]
