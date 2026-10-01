"""Checking that a payload from Telegram really came from Telegram.

Two of them, with two different signatures: the Login Widget on the web, and a
Mini App's `initData` inside the Telegram client.

The widget hands the browser a small object about the person who tapped it —
id, name, username, photo, `auth_date` — signed with the bot's own token. The
signature is the whole security model: without this check the payload is just
JSON a browser sent, and anyone could claim to be any Telegram account.

See https://core.telegram.org/widgets/login#checking-authorization
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import parse_qsl

#: How old a widget payload may be. Telegram signs `auth_date` for exactly this
#: reason: a captured payload stays valid forever otherwise.
MAX_AGE_SECONDS = 24 * 60 * 60

#: Fields Telegram signs. Anything else in the payload is not part of the hash
#: and must not be fed into the check.
SIGNED_FIELDS = {"auth_date", "first_name", "id", "last_name", "photo_url", "username"}


class TelegramAuthError(Exception):
    """The payload is not something Telegram signed, or is too old to trust."""


def verify_login_payload(payload: dict[str, Any], bot_token: str, *, now: float | None = None) -> dict[str, Any]:
    """Returns the verified account data, or raises `TelegramAuthError`.

    The secret is `sha256(bot_token)` — note it is the *digest of the token*,
    not the token itself, which is what separates this from the Mini App's
    `initData` check (that one keys an HMAC with the literal "WebAppData").
    """
    if not bot_token:
        raise TelegramAuthError("Telegram login uchun bot tokeni sozlanmagan")

    received_hash = str(payload.get("hash") or "")
    if not received_hash:
        raise TelegramAuthError("Imzo yo'q")

    pairs = sorted(f"{key}={payload[key]}" for key in payload if key in SIGNED_FIELDS and payload[key] is not None)
    data_check_string = "\n".join(pairs)
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise TelegramAuthError("Imzo mos kelmadi")

    try:
        auth_date = int(payload.get("auth_date") or 0)
    except (TypeError, ValueError) as exc:
        raise TelegramAuthError("auth_date noto'g'ri") from exc

    age = (now if now is not None else time.time()) - auth_date
    if age > MAX_AGE_SECONDS:
        raise TelegramAuthError("Bu tasdiq eskirgan — qaytadan kiring")

    try:
        telegram_id = int(payload["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TelegramAuthError("Telegram id yo'q") from exc

    return {
        "telegram_id": telegram_id,
        "first_name": str(payload.get("first_name") or ""),
        "last_name": str(payload.get("last_name") or ""),
        "username": str(payload.get("username") or ""),
        "photo_url": str(payload.get("photo_url") or ""),
        "auth_date": auth_date,
    }


#: Telegram signs a Mini App's `initData` with a *different* secret to the login
#: widget's: an HMAC of the bot token keyed with this literal, rather than the
#: token's own digest. Getting the two confused is the classic way to ship a
#: check that always fails — or, worse, one that always passes.
WEBAPP_SECRET_SALT = b"WebAppData"

#: Fields that carry the payload rather than the person. Kept out of the parsed
#: result, but — except for `hash` — still part of what Telegram signed.
WEBAPP_META_FIELDS = {"hash", "signature"}


class TelegramInitDataError(TelegramAuthError):
    """`initData` is not something this bot signed, or is too old to trust."""


def _webapp_hash(data_check_string: str, bot_token: str) -> str:
    secret_key = hmac.new(WEBAPP_SECRET_SALT, bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()


def verify_init_data(init_data: str, bot_token: str, *, now: float | None = None) -> dict[str, Any]:
    """Returns the account behind a Mini App's `window.Telegram.WebApp.initData`.

    `init_data` arrives as a urlencoded query string. Every field except `hash`
    goes into the signed string, sorted by key, one `key=value` per line — and
    the values are the *decoded* ones, so the `user` field is compared as the
    JSON object it is, not as the percent-encoded blob it travelled as.

    Telegram added `signature` (an Ed25519 signature for third parties who do
    not hold the token) after this scheme was published, and clients disagree
    about whether it belongs in the HMAC's input. Both readings are checked
    rather than guessing: one of them is what the client actually sent, and
    accepting either narrows nothing — the HMAC still has to match.

    See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    if not bot_token:
        raise TelegramInitDataError("Telegram kirish uchun bot tokeni sozlanmagan")
    if not init_data:
        raise TelegramInitDataError("initData bo'sh")

    # `keep_blank_values` because Telegram does send empty fields, and dropping
    # them here would change the string it signed.
    fields = {key: value for key, value in parse_qsl(init_data, keep_blank_values=True)}

    received_hash = fields.pop("hash", "")
    if not received_hash:
        raise TelegramInitDataError("Imzo yo'q")

    signature = fields.get("signature")
    candidates = ["\n".join(sorted(f"{key}={value}" for key, value in fields.items()))]
    if signature is not None:
        without = {key: value for key, value in fields.items() if key != "signature"}
        candidates.append("\n".join(sorted(f"{key}={value}" for key, value in without.items())))

    if not any(hmac.compare_digest(_webapp_hash(candidate, bot_token), received_hash) for candidate in candidates):
        raise TelegramInitDataError("Imzo mos kelmadi")

    try:
        auth_date = int(fields.get("auth_date") or 0)
    except (TypeError, ValueError) as exc:
        raise TelegramInitDataError("auth_date noto'g'ri") from exc

    if (now if now is not None else time.time()) - auth_date > MAX_AGE_SECONDS:
        raise TelegramInitDataError("Bu tasdiq eskirgan — ilovani qayta oching")

    try:
        user = json.loads(fields.get("user") or "{}")
    except json.JSONDecodeError as exc:
        raise TelegramInitDataError("Foydalanuvchi ma'lumoti buzilgan") from exc

    try:
        telegram_id = int(user["id"])
    except (KeyError, TypeError, ValueError) as exc:
        # A Mini App opened from an inline button carries no `user` at all —
        # only `chat_instance`. Nothing to sign in as.
        raise TelegramInitDataError("Telegram id yo'q") from exc

    return {
        "telegram_id": telegram_id,
        "first_name": str(user.get("first_name") or ""),
        "last_name": str(user.get("last_name") or ""),
        "username": str(user.get("username") or ""),
        "photo_url": str(user.get("photo_url") or ""),
        "language_code": str(user.get("language_code") or ""),
        "auth_date": auth_date,
        "start_param": fields.get("start_param") or "",
    }
