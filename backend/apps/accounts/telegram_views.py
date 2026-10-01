"""Signing in with Telegram — the widget, the Mini App and the login bot.

Three doors, one account: however the proof arrives (a Login Widget payload, a
Mini App's `initData`, or the login bot's own /start), it names a Telegram id,
and `_user_for_telegram` maps that id onto exactly one `User`.

Kept apart from `views` (email, password, sessions) because the two halves
share nothing but `_session_payload`: different credentials, different failure
modes, different reasons to change.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.contrib.auth import login
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.common.exceptions import ApiError

from . import bot_login
from .models import BOT_LOGIN_TTL, TelegramLoginRequest, User
from .telegram_auth import TelegramAuthError, verify_init_data, verify_login_payload
from .views import (
    AuthPollThrottle,
    AuthThrottle,
    REMEMBER_MAX_AGE,
    WEBHOOK_SECRET_HEADER,
    _session_payload,
)

logger = logging.getLogger(__name__)




def _user_for_telegram(data: dict) -> User:
    """The account behind a Telegram identity, created on first sight.

    An account made this way has no real email address — Telegram does not hand
    one over — so it gets a placeholder that cannot collide with a real inbox,
    and is verified from the start. Somebody who later wants a password can set
    a real address in settings.

    Shared by both ways in: the widget and the bot's own /start prove the same
    thing about the same person, and must land on the same account rather than
    on two.
    """
    user = User.objects.filter(telegram_id=data["telegram_id"]).first()
    display_name = " ".join(part for part in [data["first_name"], data["last_name"]] if part).strip()

    if user is None:
        user = User.objects.create_user(
            email=f"tg{data['telegram_id']}@telegram.local",
            password=None,
            name=display_name or data["username"] or f"Telegram {data['telegram_id']}",
            email_verified=True,
            telegram_id=data["telegram_id"],
            telegram_username=data["username"],
            photo_url=data["photo_url"],
        )
        # No usable password: this account is entered through Telegram, and a
        # blank one must not become a way in.
        user.set_unusable_password()
        user.save(update_fields=["password"])
        return user

    # Names and avatars change on Telegram's side; the account follows — with
    # one exception. An account that typed its own name in settings keeps it
    # (`User.name_is_custom`): the @handle and the picture are facts about a
    # Telegram account and stay Telegram's, but the name is on a form here, and
    # a field that reverts on the next sign-in is a field nobody can use.
    if not user.name_is_custom:
        user.name = display_name or user.name
    user.telegram_username = data["username"] or user.telegram_username
    user.photo_url = data["photo_url"] or user.photo_url
    user.save(update_fields=["name", "telegram_username", "photo_url"])
    return user


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def telegram_login(request):
    """Signs in with the Telegram Login Widget.

    No password and no mailbox: Telegram has already established who this is,
    and the signature on the payload is what proves the browser did not make it
    up (see `telegram_auth.verify_login_payload`).

    An account created this way has no real email address — Telegram does not
    hand one over — so it gets a placeholder that cannot collide with a real
    inbox, and is verified from the start. Somebody who later wants to sign in
    with a password can set a real address in settings.
    """
    try:
        data = verify_login_payload(request.data, settings.TELEGRAM_LOGIN_BOT_TOKEN)
    except TelegramAuthError as exc:
        raise ApiError("invalid_credentials", str(exc), status_code=401) from exc

    user = _user_for_telegram(data)

    login(request, user)
    request.session.set_expiry(REMEMBER_MAX_AGE)
    return Response(_session_payload(request, user))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def telegram_webapp_login(request):
    """Signs in from inside a Telegram Mini App — no email, no password.

    The client already knows who the reader is; `initData` is that claim signed
    with the bot's token, so there is nothing left for them to type. Asking for
    a password here would be asking somebody who is already identified to prove
    it a second time, by hand, on a phone.

    Lands on the same account as the widget and the bot's own /start: all three
    prove the same thing about the same Telegram id.
    """
    init_data = str(request.data.get("initData") or "")
    try:
        data = verify_init_data(init_data, settings.TELEGRAM_LOGIN_BOT_TOKEN)
    except TelegramAuthError as exc:
        raise ApiError("invalid_credentials", str(exc), status_code=401) from exc

    user = _user_for_telegram(data)

    login(request, user)
    # A Mini App is reopened from a chat, not from a bookmark, and the client
    # keeps its own storage — a short session would log them out between visits
    # for no gain.
    request.session.set_expiry(REMEMBER_MAX_AGE)
    payload = _session_payload(request, user)
    # `startapp=...` deep links land here; the interface uses it to open the
    # screen the link named instead of the dashboard.
    payload["startParam"] = data["start_param"]
    return Response(payload)


def _bare_host(value: str) -> str:
    """Just the hostname: no scheme, no port, no path, lowercased."""
    host = value.strip().lower()
    host = host.split("://")[-1]
    return host.split("/")[0].split(":")[0]


#: How long a domain answer is trusted. Short on a refusal so that fixing
#: @BotFather shows up on the next reload rather than in a quarter of an hour;
#: longer on success because a registered domain does not un-register itself.
WIDGET_OK_TTL = 15 * 60
WIDGET_FAIL_TTL = 60
#: The marker Telegram's embed carries when it is willing to render the widget.
WIDGET_MARKER = "tgme_widget_login"


def _widget_domain_registered(username: str, host: str) -> bool:
    """Whether Telegram will actually render the widget on this host.

    Our own settings can only say which domain we *meant* to register. Telegram
    is the one that knows, and when it disagrees it renders "Bot domain
    invalid" inside a cross-origin iframe — text no stylesheet can reach and no
    script on our side can read, sitting in the middle of the sign-in card.
    So the answer is fetched here instead, where a screen can act on it.
    """
    cache_key = f"tg-widget-domain:{username}:{host}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    url = f"https://oauth.telegram.org/embed/{username}"
    try:
        response = requests.get(
            url,
            params={"origin": f"https://{host}", "size": "large"},
            timeout=4,
        )
        registered = response.status_code == 200 and WIDGET_MARKER in response.text
    except requests.RequestException:
        # Telegram unreachable is not "domain wrong". Offering the bot link for
        # one minute is the safe way to be wrong about that.
        logger.warning("telegram widget probe failed for %s", username, exc_info=True)
        registered = False

    cache.set(cache_key, registered, WIDGET_OK_TTL if registered else WIDGET_FAIL_TTL)
    return registered


@api_view(["GET"])
@permission_classes([AllowAny])
def telegram_config(request):
    """Which bot the login widget belongs to, or that there is none.

    The interface asks rather than being told twice: the username lives in the
    backend's environment next to the token that verifies the signature, and a
    second copy in the frontend's environment is a second thing to get wrong.
    """
    username = settings.TELEGRAM_LOGIN_BOT_USERNAME.lstrip("@")
    configured = bool(username and settings.TELEGRAM_LOGIN_BOT_TOKEN)
    domain = _bare_host(settings.TELEGRAM_LOGIN_DOMAIN)
    # The domain Telegram checks is the one the *widget* is rendered on — the
    # panel's, not the API's. The panel asks this question server-side, so by
    # the time it arrives here the request's own host is an internal address;
    # the caller names the public one it is answering on.
    host = _bare_host(request.query_params.get("host") or "") or _bare_host(request.get_host())

    # The widget only signs people in from the domain registered with
    # @BotFather. Served from anywhere else it renders its own English error
    # inside an iframe that cannot be styled or hidden from the outside — so the
    # screens ask here first and show the password form instead.
    if not configured:
        reason = "not_configured"
    elif not domain:
        reason = "domain_not_set"
    elif domain != host:
        reason = "domain_mismatch"
    elif not _widget_domain_registered(username, host):
        # Everything on our side lines up and Telegram still says no — the
        # domain was never registered with @BotFather, or was registered
        # against a different bot.
        reason = "domain_not_registered"
    else:
        reason = ""

    return Response(
        {
            "enabled": not reason,
            "botUsername": username,
            "reason": reason,
            "host": host,
            # The widget needs a registered domain; pressing Start in the
            # bot does not, so the screens can offer that instead of
            # nothing wherever this deployment happens to be served from.
            "botFlow": bot_login.is_configured(),
        }
    )


# -- signing in through the bot ---------------------------------------------
#
# See `bot_login` for why this exists next to the widget: it is the way in that
# does not depend on a domain being registered with @BotFather.


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def telegram_bot_start(request):
    """Opens a login attempt and names the link that completes it."""
    if not bot_login.is_configured():
        raise ApiError("not_configured", "Telegram orqali kirish sozlanmagan.", status_code=400)

    attempt = TelegramLoginRequest.open()
    return Response(
        {
            "nonce": attempt.nonce,
            "url": bot_login.login_url(attempt.nonce),
            "expiresIn": int(BOT_LOGIN_TTL.total_seconds()),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([AuthPollThrottle])
def telegram_bot_status(request):
    """Whether that attempt has been approved — and if so, the session.

    The session is handed out on the first ask and never again: the nonce
    travels through a `t.me` link and a chat, and a second exchange of it would
    be a second way into the same account.
    """
    nonce = request.query_params.get("nonce", "")
    attempt = TelegramLoginRequest.objects.filter(pk=nonce).first()
    if attempt is None:
        return Response({"status": "expired"})
    if attempt.status != "approved":
        return Response({"status": attempt.status})

    # Two polls can arrive together; exactly one of them may claim the attempt.
    claimed = TelegramLoginRequest.objects.filter(pk=nonce, consumed_at__isnull=True).update(
        consumed_at=timezone.now()
    )
    if not claimed:
        return Response({"status": "consumed"})

    user = _user_for_telegram(
        {
            "telegram_id": attempt.telegram_id,
            "first_name": attempt.first_name,
            "last_name": attempt.last_name,
            "username": attempt.username,
            "photo_url": attempt.photo_url,
        }
    )
    login(request, user)
    request.session.set_expiry(REMEMBER_MAX_AGE)
    return Response({"status": "approved", "session": _session_payload(request, user)})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def telegram_bot_webhook(request):
    """The login bot's updates.

    Answers 200 to everything it recognises as Telegram, including updates it
    does nothing with: a non-200 is a redelivery, and redelivering a /start
    that has already been handled helps nobody.
    """
    if not bot_login.secret_matches(request.META.get(WEBHOOK_SECRET_HEADER, "")):
        return Response({"ok": False}, status=status.HTTP_403_FORBIDDEN)

    payload = request.data or {}

    # The same bot signs people in and owns the bots they create from the
    # panel, so its webhook carries both. Imported here rather than at module
    # scope: `apps.bots` reaches back into accounts for the user model, and a
    # top-level import would close that circle at startup.
    if "managed_bot" in payload:
        from apps.bots import managed

        managed.handle_update(payload["managed_bot"])
        return Response({"ok": True})

    message = payload.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    text = (message.get("text") or "").strip()
    if not chat_id or not text.startswith("/start"):
        return Response({"ok": True})

    parts = text.split(maxsplit=1)
    nonce = parts[1].strip() if len(parts) > 1 else ""
    if not nonce:
        bot_login.reply(chat_id, bot_login.PLAIN_START_TEXT)
        return Response({"ok": True})

    attempt = TelegramLoginRequest.objects.filter(pk=nonce).first()
    if attempt is None or attempt.status != "pending":
        bot_login.reply(chat_id, bot_login.STALE_TEXT)
        return Response({"ok": True})

    sender = message.get("from") or {}
    attempt.approve(
        telegram_id=sender.get("id") or chat_id,
        first_name=sender.get("first_name") or "",
        last_name=sender.get("last_name") or "",
        username=sender.get("username") or "",
        photo_url="",
    )
    bot_login.reply(chat_id, bot_login.APPROVED_TEXT)
    return Response({"ok": True})

