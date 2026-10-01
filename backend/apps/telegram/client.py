"""A thin, synchronous wrapper over the Telegram Bot API.

Every method takes the token explicitly through the client instance, because
this backend talks to many bots — a module-level "the" token would be wrong the
moment a workspace connects its second one.

Offline mode (`TELEGRAM_OFFLINE=1`) short-circuits every call and returns a
plausible result instead. The whole runtime — dispatch, flow execution, the
realtime feed — can then be driven end to end from tests or a laptop with no
bot token and no internet.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)


#: `/bot<token>/` inside any URL. Requests puts the full request URL into its
#: exception text, and that path *is* the credential.
_TOKEN_IN_URL = re.compile(r"/bot\d+:[A-Za-z0-9_-]+")


def redact(text: str) -> str:
    """The same text with every bot token blacked out.

    Applied to every message a `TelegramError` carries, because those messages
    travel: into `Bot.webhook_error`, into the activity feed a whole team
    reads, into API responses. One exception printed raw put a live token on
    the bot page (BUG-003), and no later filter can be trusted to remember.
    """
    return _TOKEN_IN_URL.sub("/bot•••", text)


def transport_message(exc: Exception) -> str:
    """A network failure, said the way the activity feed can print it.

    `str(RequestException)` is written for a Python developer — pool names,
    retry counts, the full URL. The reader of a bot page is asking one
    question, "is it Telegram or is it us", so the classes that matter are
    named and the rest collapses into one sentence. The raw exception still
    reaches the server log at the call site.
    """
    if isinstance(exc, requests.Timeout):
        return "Telegram javob bermadi (vaqt tugadi)"
    if isinstance(exc, requests.ConnectionError):
        return "Telegram bilan ulanib bo'lmadi — tarmoq xatosi"
    return f"Tarmoq xatosi: {type(exc).__name__}"


class TelegramError(RuntimeError):
    """A call Telegram refused. `code` is Telegram's own `error_code`."""

    def __init__(self, method: str, message: str, code: int | None = None):
        message = redact(message)
        super().__init__(f"Telegram {method} failed ({code}): {message}")
        self.method = method
        self.message = message
        self.code = code

    @property
    def is_blocked(self) -> bool:
        """403 with this wording is Telegram saying the user blocked the bot."""
        return self.code == 403 and "blocked" in self.message.lower()


#: One HTTP session for the whole worker, not one per send.
#:
#: `requests.post(...)` opens a fresh TCP+TLS connection every call, and a flow
#: that sends three messages before it parks pays for three handshakes to
#: `api.telegram.org` — the largest avoidable slice of the delay between a
#: customer's message and the bot's reply. A pooled session keeps the
#: connection open with HTTP keep-alive, so every send after the first reuses
#: it. Module-level, so it is shared across bots and updates within a worker
#: process and lives as long as the worker does.
#:
#: `max_retries` stays at zero on purpose: a retried `sendMessage` is a message
#: the customer receives twice, and Telegram already re-delivers the update if
#: we never answer the webhook.
_SESSION: requests.Session | None = None
_SESSION_USED_AT = 0.0

#: How long a pooled connection may sit idle before it is thrown away unused.
#:
#: A router or carrier NAT forgets an idle TCP flow after a few minutes without
#: telling either end. The socket still looks open, so urllib3 hands it out,
#: the request is written into nothing, and the send hangs for the full
#: `TELEGRAM_REQUEST_TIMEOUT` before failing. That was the first `/start` after
#: a quiet spell: the run failed with "vaqt tugadi" and the customer got
#: silence, while the very next message — on a fresh connection — worked.
#: Retrying is not the fix (a retried sendMessage may be a duplicate); not
#: reusing a connection that is likely dead is. Sends within one walk are
#: milliseconds apart, so they still share one handshake.
SESSION_IDLE_SECONDS = 30.0


def _session() -> requests.Session:
    global _SESSION, _SESSION_USED_AT
    now = time.monotonic()
    if _SESSION is not None and now - _SESSION_USED_AT > SESSION_IDLE_SECONDS:
        _SESSION.close()
        _SESSION = None
    if _SESSION is None:
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=32, pool_maxsize=64, max_retries=0)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        _SESSION = session
    _SESSION_USED_AT = now
    return _SESSION


class TelegramClient:
    def __init__(self, token: str, *, offline: bool | None = None):
        self.token = token
        self.offline = settings.TELEGRAM_OFFLINE if offline is None else offline
        #: Everything sent while offline, so tests can assert on it.
        self.sent: list[dict[str, Any]] = []

    # -- transport ---------------------------------------------------------

    def call(self, method: str, payload: dict[str, Any] | None = None) -> Any:
        payload = {key: value for key, value in (payload or {}).items() if value is not None}
        if self.offline:
            return self._offline_result(method, payload)

        url = f"{settings.TELEGRAM_API_BASE}/bot{self.token}/{method}"
        try:
            response = _session().post(url, json=payload, timeout=settings.TELEGRAM_REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            # The raw exception is for this log, and only this log.
            logger.warning("telegram %s transport failure: %s", method, exc)
            raise TelegramError(method, transport_message(exc)) from exc

        try:
            data = response.json()
        except ValueError as exc:
            raise TelegramError(method, response.text[:200], response.status_code) from exc

        if not data.get("ok"):
            raise TelegramError(method, data.get("description", "unknown"), data.get("error_code"))
        return data.get("result")

    def _offline_result(self, method: str, payload: dict[str, Any]) -> Any:
        self.sent.append({"method": method, "payload": payload})
        logger.debug("telegram offline %s %s", method, payload)
        if method == "getMe":
            return {"id": 1, "is_bot": True, "first_name": "Offline bot", "username": "offline_bot"}
        if method == "getWebhookInfo":
            return {"url": "", "pending_update_count": 0}
        if method.startswith("send") or method == "copyMessage":
            return {"message_id": len(self.sent), "date": 0, "chat": {"id": payload.get("chat_id")}}
        if method.startswith("editMessage"):
            # The real API answers an edit with the edited Message, and the id
            # in it is the one that was edited rather than a new one. Returning
            # `True` here — which the default below would — made the runtime
            # believe every edit had failed to name a message, so the screen
            # pointer was dropped and the next block sent instead of edited.
            # Nothing but a test would ever have noticed, which is exactly the
            # problem: the whole transition ladder is untestable offline unless
            # this shape is right.
            return {
                "message_id": payload.get("message_id"),
                "date": 0,
                "chat": {"id": payload.get("chat_id")},
                "edited": True,
            }
        if method == "getChat":
            # Enough of a `ChatFullInfo` for the chat registry to be walked end
            # to end on a laptop: an id, a type and a title. Not `True`, which
            # the default below would return and which `chats.refresh_chat`
            # would then read fields off.
            return {"id": payload.get("chat_id"), "type": "supergroup", "title": "Offline chat"}
        if method == "getChatMemberCount":
            return 1
        if method == "getChatAdministrators":
            return []
        if method == "getChatMember":
            # A laptop with no token has no channel to be a member of, and a
            # subscription gate that answers "not subscribed" offline would
            # block every flow that has one from ever being walked through.
            return {"status": "member", "user": {"id": payload.get("user_id")}}
        return True

    # -- identity and wiring ----------------------------------------------

    def get_me(self) -> dict:
        return self.call("getMe")

    def set_webhook(self, url: str, secret_token: str = "", allowed_updates: list[str] | None = None) -> bool:
        return self.call(
            "setWebhook",
            {
                "url": url,
                "secret_token": secret_token or None,
                # Asking for everything the product can route on: business
                # messages and reactions are not in Telegram's default set, and
                # a flow that listens for one would silently never fire.
                "allowed_updates": allowed_updates
                or [
                    "message",
                    "edited_message",
                    "channel_post",
                    "edited_channel_post",
                    "callback_query",
                    "chat_member",
                    "my_chat_member",
                    "chat_join_request",
                    "message_reaction",
                    "pre_checkout_query",
                    "business_connection",
                    "business_message",
                ],
                "drop_pending_updates": False,
            },
        )

    def delete_webhook(self, drop_pending_updates: bool = False) -> bool:
        return self.call("deleteWebhook", {"drop_pending_updates": drop_pending_updates})

    def get_webhook_info(self) -> dict:
        return self.call("getWebhookInfo")

    # -- sending -----------------------------------------------------------
    #
    # There is no `send_photo`/`send_poll` here on purpose: what a block sends
    # is built in `apps.engine.sender.build_call`, which owns the whole
    # contentKind -> method mapping, and calls `call()` with it.

    def answer_pre_checkout_query(self, query_id: str, ok: bool = True, error_message: str = "") -> bool:
        """Telegram's last word before it charges the card.

        The query expires in ten seconds and an unanswered one is a payment
        that silently fails, so this is sent before anything else is decided.
        """
        payload: dict[str, Any] = {"pre_checkout_query_id": query_id, "ok": ok}
        if not ok and error_message:
            payload["error_message"] = error_message
        return self.call("answerPreCheckoutQuery", payload)

    def get_chat(self, chat_id: int | str) -> dict:
        """Everything Telegram will say about one chat — a `ChatFullInfo`.

        The title, the `@username` and the primary invite link all move without
        anybody telling this backend, because a `my_chat_member` update is sent
        when the *bot's* standing changes and not when the room is renamed. This
        is the only way to notice.

        See https://core.telegram.org/bots/api#getchat
        """
        return self.call("getChat", {"chat_id": chat_id})

    def get_chat_member_count(self, chat_id: int | str) -> int:
        """How many people are in that chat.

        Its own method rather than a field of `getChat`: `ChatFullInfo` carries
        no member count at all, which is worth knowing before going looking for
        one.

        See https://core.telegram.org/bots/api#getchatmembercount
        """
        return self.call("getChatMemberCount", {"chat_id": chat_id})

    def get_chat_member(self, chat_id: int | str, user_id: int) -> dict:
        """Whether this person is in that chat, and in what capacity.

        Telegram refuses this for a chat the bot does not administer, which
        raises rather than returning a status — a subscription gate reads that
        refusal as "cannot verify", never as "yes".

        See https://core.telegram.org/bots/api#getchatmember
        """
        return self.call("getChatMember", {"chat_id": chat_id, "user_id": user_id})

    def answer_callback_query(self, callback_query_id: str, text: str = "") -> bool:
        """Clears the spinner on a tapped inline button."""
        return self.call("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text or None})


def client_for(bot) -> TelegramClient:
    """The client for one `bots.Bot` row."""
    return TelegramClient(bot.token)
