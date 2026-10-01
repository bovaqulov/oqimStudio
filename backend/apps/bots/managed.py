"""Creating a bot from inside the panel, through the bot that manages it.

Until Bot API 9.6 a token could only be born in a conversation with @BotFather:
the reader left the product, typed `/newbot`, answered two questions and came
back with something to paste. That version let a bot own other bots, so the
same journey is now a link and a confirmation screen Telegram draws itself.

    panel                       Telegram                    @SelfeBot
      | POST /api/bots/create-request/                          |
      |<-- t.me/newbot/<manager>/<username>?name=<name>         |
      | open ------------------>|                               |
      |                         | user confirms                 |
      |                         | managed_bot update ---------->|
      |                         |            getManagedBotToken |
      | GET  .../create-request/<id>/                           |
      |<-- the bot, connected --------------------------------- |

Two things about this are worth knowing before changing it.

**The link carries nothing back.** A `/start` deep link has a payload; this URL
has only a username and a name, so nothing of ours survives the round trip. The
update names the *person* who created the bot and the bot itself, and that is
all — which is why `ManagedBotRequest` records a Telegram id and why the claim
below matches on it.

**The manager is the login bot.** It is already the one bot that belongs to the
deployment rather than to a tenant, already has a webhook, and already knows
how a Telegram identity maps onto an account here. A second deployment-level
bot would be a second thing to configure and a second thing to get wrong.

Management mode itself is not something this code can switch on: it lives in
the @BotFather Mini App, under the manager bot's own settings, and `getMe`
reports it back as `can_manage_bots`.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.billing.services import refusal_reason
from apps.common.exceptions import ApiError
from apps.telegram.client import TelegramClient, TelegramError

from .models import Bot, ManagedBotRequest
from .services import log_activity, register_webhook, starter_library

logger = logging.getLogger(__name__)

#: How long a request waits for its confirmation. Long enough to read the
#: screen and pick a different username after the first one is taken; short
#: enough that a forgotten tab cannot claim a bot created tomorrow.
REQUEST_TTL = timedelta(minutes=15)


def manager_username() -> str:
    return settings.TELEGRAM_LOGIN_BOT_USERNAME.lstrip("@")


def is_configured() -> bool:
    """Whether a manager bot is named at all. Says nothing about its mode."""
    return bool(settings.TELEGRAM_LOGIN_BOT_TOKEN and manager_username())


def client() -> TelegramClient:
    return TelegramClient(settings.TELEGRAM_LOGIN_BOT_TOKEN)


def can_manage_bots() -> bool:
    """Whether @BotFather has management mode switched on for the manager bot.

    Asked rather than configured: a second copy in the environment would be a
    setting that can disagree with Telegram, and the screen needs the answer
    Telegram would actually give.
    """
    if not is_configured():
        return False
    try:
        return bool(client().get_me().get("can_manage_bots"))
    except TelegramError:
        logger.warning("could not read can_manage_bots for the manager bot", exc_info=True)
        return False


def new_bot_url(*, username: str, name: str = "") -> str:
    """The link that opens Telegram's own bot-creation screen.

    Both parts are suggestions: the screen pre-fills them and lets the reader
    edit either, which is the point — `@sotuv_bot` being taken is something
    only Telegram knows, and it is a better place to find out than a form of
    ours guessing.
    """
    url = f"https://t.me/newbot/{manager_username()}/{username.lstrip('@')}"
    return f"{url}?name={quote(name)}" if name else url


def get_managed_bot_token(telegram_bot_id: int) -> str:
    """The new bot's token, from the manager that owns it."""
    return client().call("getManagedBotToken", {"user_id": telegram_bot_id})


def open_request(*, workspace, project, user, name: str, username: str) -> ManagedBotRequest:
    """Records where a bot should land, and who is about to create it."""
    if not user.telegram_id:
        raise ApiError(
            "telegram_required",
            "Bot yaratish uchun avval Telegram orqali kiring — yangi bot o'sha hisobga biriktiriladi.",
            status_code=400,
        )

    # A person can only be creating one bot at a time, and the newest ask is
    # the one they are looking at. Leaving the older ones open would let either
    # of them claim the update.
    ManagedBotRequest.objects.filter(
        telegram_id=user.telegram_id, status=ManagedBotRequest.Status.PENDING
    ).update(status=ManagedBotRequest.Status.FAILED, error="Yangi so'rov ochildi")
    ManagedBotRequest.objects.filter(expires_at__lt=timezone.now() - REQUEST_TTL).delete()

    return ManagedBotRequest.objects.create(
        workspace=workspace,
        project=project,
        requested_by=user,
        telegram_id=user.telegram_id,
        suggested_name=name,
        suggested_username=username,
        expires_at=timezone.now() + REQUEST_TTL,
    )


def claim(telegram_user_id: int) -> ManagedBotRequest | None:
    """The open request belonging to the person this update is about."""
    return (
        ManagedBotRequest.objects.filter(
            telegram_id=telegram_user_id,
            status=ManagedBotRequest.Status.PENDING,
            expires_at__gte=timezone.now(),
        )
        .order_by("-created_at")
        .first()
    )


@transaction.atomic
def _store(request: ManagedBotRequest, profile: dict, token: str) -> Bot:
    """Writes the created bot into the project the request named.

    Deliberately not `services.connect_bot`: that one starts by asking Telegram
    whose token this is, and here Telegram has just said so in the update that
    carried it. Asking again would be a round trip to learn what we were told.
    """
    username = profile.get("username", "")
    bot_id = (username or str(profile.get("id"))).lower()[:60]
    if Bot.objects.filter(pk=bot_id).exists():
        bot_id = f"{bot_id}-{request.id[:4]}"

    bot = Bot.objects.create(
        id=bot_id,
        workspace=request.workspace,
        project=request.project,
        handle=f"@{username}" if username else str(profile.get("id")),
        status="Faol",
        status_tone="success",
        token=token,
        telegram_id=profile.get("id"),
        username=username,
        connected_by=request.requested_by,
        connected_at=timezone.now(),
        enabled_modules=["dms"],
        # The same standard library a pasted-token bot gets. Two creation paths
        # is two places to forget it, and a bot created inside the panel is the
        # one whose author is least likely to have written `money()` before.
        script_library=starter_library(),
    )
    bot.settings["displayName"] = profile.get("first_name", "") or bot.handle
    bot.save(update_fields=["settings"])

    log_activity(bot, "Bot Telegramda yaratildi va loyihaga qo'shildi", "robot")
    request.bot = bot
    request.status = ManagedBotRequest.Status.READY
    request.save(update_fields=["bot", "status"])
    # Outside the transaction's promise: a network call that fails must not roll
    # back a bot that already exists on Telegram's side.
    transaction.on_commit(lambda: register_webhook(bot))
    return bot


def handle_update(payload: dict) -> bool:
    """A `managed_bot` update: a bot was created, or its token was replaced.

    Returns whether it matched a request of ours. Anything unmatched is not an
    error — somebody may have created a bot through this manager from a link
    that was never ours — so the caller still answers Telegram 200.
    """
    profile = payload.get("bot") or {}
    creator = payload.get("user") or {}
    telegram_bot_id = profile.get("id")
    if not telegram_bot_id or not creator.get("id"):
        return False

    # Nothing to do for a bot already here: the same update shape announces a
    # token replacement, and re-storing it would be a duplicate row.
    if Bot.objects.filter(telegram_id=telegram_bot_id).exists():
        return False

    request = claim(creator["id"])
    if request is None:
        logger.info("managed bot %s arrived with no open request", telegram_bot_id)
        return False

    # `create_request` already refused a workspace that was full, but the last
    # seat can be taken while Telegram is drawing its confirmation screen. This
    # is a webhook, so it is the non-raising half of the split: the reason goes
    # onto the request row, where the screen that is polling it reads it, and
    # Telegram is still answered 200 rather than made to retry forever.
    reason = refusal_reason(request.workspace, "bots")
    if reason:
        request.status = ManagedBotRequest.Status.FAILED
        request.error = reason[:280]
        request.save(update_fields=["status", "error"])
        return False

    try:
        token = get_managed_bot_token(telegram_bot_id)
    except TelegramError as exc:
        request.status = ManagedBotRequest.Status.FAILED
        request.error = f"Tokenni olib bo'lmadi: {exc.message}"
        request.save(update_fields=["status", "error"])
        return False

    _store(request, profile, token)
    return True
