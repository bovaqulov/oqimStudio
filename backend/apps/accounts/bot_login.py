"""Signing in by pressing Start in the bot.

The Login Widget is the fast path, but it only works on a domain somebody
registered with @BotFather — which nobody can do from inside the product, and
which stops being true every time a development tunnel restarts. This is the
path with no domain in it:

    panel                      Telegram                     bot
      | POST /telegram/start/                                |
      |----> nonce, t.me/<bot>?start=<nonce> ------------->  |
      |                          | /start <nonce> --------->  |
      |                          |            approve(nonce)  |
      | GET /telegram/status/?nonce=…                        |
      |<---- session ----------------------------------------|

What makes it safe is that the two halves are joined by something only the
person holding the browser *and* the phone can complete: the nonce is
unguessable and short-lived, the update that approves it is authenticated by
Telegram itself, and the session is handed out exactly once.

The webhook's secret is derived from `SECRET_KEY` rather than configured
separately — one fewer thing to set, and it rotates with the deployment's own
secret.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from django.conf import settings

from apps.telegram.client import TelegramClient, TelegramError

logger = logging.getLogger(__name__)

#: What the bot says once the browser can be let in.
APPROVED_TEXT = "✅ Kirish tasdiqlandi. Brauzerdagi oynaga qayting — u o'zi ochiladi."
#: A nonce that has run out, been used, or was never issued here.
STALE_TEXT = "⏳ Havola eskirgan. Saytdagi «Telegram orqali kirish» tugmasini qaytadan bosing."
#: Somebody who opened the bot on their own, without a login link.
PLAIN_START_TEXT = (
    "Salom! Bu bot Oqim Studio'ga kirish uchun ishlatiladi.\n\n"
    "Kirish uchun saytdagi «Telegram orqali kirish» tugmasini bosing — men shu yerda tasdiqlashni so'rayman."
)


def webhook_secret() -> str:
    """The `secret_token` this deployment's login webhook is registered with."""
    digest = hashlib.sha256(f"telegram-login:{settings.SECRET_KEY}".encode()).hexdigest()
    return digest[:48]


def secret_matches(candidate: str) -> bool:
    return hmac.compare_digest(candidate or "", webhook_secret())


def webhook_url() -> str:
    return f"{settings.PUBLIC_BASE_URL}/api/auth/telegram/bot/"


def login_url(nonce: str) -> str:
    """The `t.me` link the panel opens. `start` is Telegram's own deep link."""
    username = settings.TELEGRAM_LOGIN_BOT_USERNAME.lstrip("@")
    return f"https://t.me/{username}?start={nonce}"


def is_configured() -> bool:
    return bool(settings.TELEGRAM_LOGIN_BOT_TOKEN and settings.TELEGRAM_LOGIN_BOT_USERNAME)


def reply(chat_id: int, text: str) -> None:
    """Answers in the chat. A failure here must not fail the webhook.

    Telegram retries an update it did not get a 200 for, and a retried /start
    would be approving a nonce that is already approved — the reply is
    courtesy, the approval is the point.
    """
    try:
        TelegramClient(settings.TELEGRAM_LOGIN_BOT_TOKEN).call(
            "sendMessage", {"chat_id": chat_id, "text": text}
        )
    except TelegramError as exc:
        logger.warning("login bot reply failed: %s", exc)


def install_webhook() -> dict:
    """Registers this deployment's URL with the login bot."""
    client = TelegramClient(settings.TELEGRAM_LOGIN_BOT_TOKEN)
    client.call(
        "setWebhook",
        {
            "url": webhook_url(),
            "secret_token": webhook_secret(),
            # Nothing else is read, and a login bot has no business receiving
            # the rest of somebody's chat. `managed_bot` is here because the
            # same bot manages the ones a workspace creates from the panel —
            # see `apps.bots.managed`; left out, a bot is created on Telegram's
            # side and never arrives.
            "allowed_updates": ["message", "managed_bot"],
            "drop_pending_updates": True,
        },
    )
    return client.call("getWebhookInfo") or {}


def remove_webhook() -> None:
    TelegramClient(settings.TELEGRAM_LOGIN_BOT_TOKEN).call("deleteWebhook", {"drop_pending_updates": True})
