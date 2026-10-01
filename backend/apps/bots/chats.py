"""Which groups and channels a bot is in, and what it may do there.

Two writers, and they answer different questions. `record_membership` is fed by
the `my_chat_member` webhook and is the only one that runs by itself: Telegram
announces every change to the bot's own standing, so the registry stays current
without anybody opening a screen. `refresh_chat` is the button, and it exists
because the update says nothing about the room — a group renamed, made public
or grown by two hundred people sends no `my_chat_member` at all.

**What a failed refresh does is the decision worth reading.** Telegram is the
authority for every column here and it is also the part of this system most
likely to be unreachable — a timeout, a rate limit, a network that dropped for
four seconds. Writing back what a failed call returned would empty the row: no
title, no rights, no members. So a failure writes exactly one column,
`refresh_error`, and leaves the rest standing with `refreshed_at` unmoved. A
count that says «2 soat oldin tekshirilgan» is a fact somebody can judge; a
screen that empties itself because one call timed out is a screen that has just
told its reader their bot was thrown out of a group it is still in.

The one refusal that *is* information is 403. Telegram answers that to a bot
asking about a chat it is not in, and it is the plainest statement available
that the membership ended — so it is written down as a departure rather than as
an error. Everything else Telegram refuses (a rate limit, "chat not found" from
a chat that is merely migrating) keeps the row it has.
"""

from __future__ import annotations

import logging
from datetime import datetime
from datetime import timezone as dt_timezone

from django.utils import timezone

from apps.telegram.client import TelegramError, client_for

from .models import PAUSED_NOTE, Bot, BotChat
from .services import log_activity

logger = logging.getLogger(__name__)

#: The chat types this registry is about. A `my_chat_member` on a private chat
#: is the block/unblock signal and belongs to the contact, not here.
TRACKED_TYPES = {BotChat.Type.GROUP, BotChat.Type.SUPERGROUP, BotChat.Type.CHANNEL}

#: Every administrator right `ChatMemberAdministrator` publishes.
#:
#: Used for one thing: filling in an owner's rights. Telegram sends none of
#: these on `ChatMemberOwner` because the answer is "all of them", so a row
#: written from that object literally shows the one member who can do anything
#: as able to do nothing. What is stored for every *other* status is whatever
#: `can_*` keys the object actually carried, so a right added to the Bot API
#: after this list was written still reaches the panel.
ADMIN_RIGHTS = (
    "can_manage_chat",
    "can_delete_messages",
    "can_manage_video_chats",
    "can_restrict_members",
    "can_promote_members",
    "can_change_info",
    "can_invite_users",
    "can_post_stories",
    "can_edit_stories",
    "can_delete_stories",
    "can_post_messages",
    "can_edit_messages",
    "can_pin_messages",
    "can_manage_topics",
)

#: Statuses that mean the bot is no longer in the chat.
GONE = {BotChat.Status.LEFT, BotChat.Status.KICKED}


def _rights_of(member: dict) -> dict:
    if member.get("status") == BotChat.Status.CREATOR:
        return {name: True for name in ADMIN_RIGHTS}
    return {key: bool(value) for key, value in member.items() if key.startswith("can_")}


def _when(unix: object) -> datetime | None:
    """The update's own `date`, not the clock here.

    A webhook re-delivered an hour after the fact would otherwise record the
    hour it arrived as the moment the bot was added.
    """
    if not isinstance(unix, (int, float)) or not unix:
        return None
    try:
        return datetime.fromtimestamp(unix, tz=dt_timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _transition(old: str, new: str) -> str:
    """What just happened, in the terms the activity feed says it in."""
    if new in GONE:
        return "removed"
    if old in GONE or not old:
        return "added"
    was_admin = old in {BotChat.Status.ADMINISTRATOR, BotChat.Status.CREATOR}
    is_admin = new in {BotChat.Status.ADMINISTRATOR, BotChat.Status.CREATOR}
    if is_admin and not was_admin:
        return "promoted"
    if was_admin and not is_admin:
        return "demoted"
    return "updated"


#: One line per transition, and the icon beside it. The chat's name is filled
#: in; the sentence says what a person would say happened.
_ACTIVITY = {
    "added": ("«{title}» ga qo'shildi", "users-three"),
    "promoted": ("«{title}» da administrator qilindi", "seal-check"),
    "demoted": ("«{title}» da administratorlikdan olindi", "warning"),
    "removed": ("«{title}» dan chiqarildi", "warning"),
}


def record_membership(bot: Bot, update: dict) -> dict:
    """Files one `my_chat_member` about a group or channel. Never raises.

    Returns what was decided, for the dispatch log. Called from the update path,
    where a raised exception is a webhook that answers 500 and an update
    Telegram re-delivers for as long as the bug lives — so the whole of it is
    inside one `except`, and a registry that missed a change is repaired by the
    refresh button.
    """
    try:
        return _record_membership(bot, update)
    except Exception:  # noqa: BLE001 — see the docstring
        logger.exception("could not record my_chat_member for %s", bot.id)
        return {"handled": False, "reason": "membership_failed"}


def _record_membership(bot: Bot, update: dict) -> dict:
    chat = update.get("chat") or {}
    chat_type = chat.get("type") or ""
    chat_id = chat.get("id")
    if chat_id is None or chat_type not in TRACKED_TYPES:
        return {"handled": False, "reason": "membership_untracked"}

    new_member = update.get("new_chat_member") or {}
    status = new_member.get("status") or ""
    if status not in BotChat.Status.values:
        # An enumeration only Telegram may extend. A status nobody here knows
        # is better left unwritten than mapped onto the nearest one — "member"
        # standing in for something restrictive is a screen saying the bot is
        # fine when it is not.
        return {"handled": False, "reason": "membership_unknown_status"}

    happened_at = _when(update.get("date")) or timezone.now()
    row = BotChat.objects.filter(bot=bot, chat_id=chat_id).first()
    previous = row.status if row else ""
    action = _transition(previous, status)

    fields = {
        "type": chat_type,
        "title": chat.get("title") or "",
        "username": chat.get("username") or "",
        "status": status,
        "rights": _rights_of(new_member),
    }
    if action == "removed":
        fields["left_at"] = happened_at
    elif action == "added":
        # Re-added after a removal: the departure is history and the row has to
        # stop reading as one, or the list keeps the chat at the bottom under
        # its «chiqarildi» label while the bot is answering in it.
        fields["left_at"] = None
        fields["added_at"] = (row.added_at if row and row.added_at else None) or happened_at

    if row is None:
        row = BotChat.objects.create(bot=bot, chat_id=chat_id, **fields)
    else:
        for name, value in fields.items():
            setattr(row, name, value)
        row.save(update_fields=[*fields, "updated_at"])

    sentence, icon = _ACTIVITY.get(action, ("", ""))
    if sentence:
        # The bot's own feed rather than a second one: "somebody added this bot
        # to a group" belongs beside "the token was rotated" — both are things
        # done *to* the bot from outside, and one feed is what the overview
        # panel already reads.
        log_activity(bot, sentence.format(title=row.title or chat_id)[:280], icon)

    return {"handled": True, "reason": f"membership_{action}", "chatId": chat_id}


def refresh_chat(chat: BotChat) -> BotChat:
    """Asks Telegram about one chat and writes down what it says.

    Three calls, and each is allowed to fail on its own: `getChat` for the room,
    `getChatMemberCount` for its size, `getChatMember` for what the bot is in
    it. A count Telegram declined to give — it refuses one in a chat where the
    bot is not an administrator — must not cost the title that came back fine
    one call earlier.

    See https://core.telegram.org/bots/api#getchat
    """
    client = client_for(chat.bot)
    written: set[str] = set()

    try:
        info = client.get_chat(chat.chat_id)
    except TelegramError as exc:
        return _record_refusal(chat, exc)

    if isinstance(info, dict):
        chat.type = info.get("type") or chat.type
        chat.title = info.get("title") or chat.title
        chat.username = info.get("username") or ""
        chat.invite_link = (info.get("invite_link") or "")[:280]
        chat.join_by_request = bool(info.get("join_by_request"))
        written |= {"type", "title", "username", "invite_link", "join_by_request"}

    try:
        count = client.get_chat_member_count(chat.chat_id)
    except TelegramError as exc:
        # Kept, not zeroed. "How many people are in there" is the number the
        # panel is read for, and a bot that has just been demoted loses the
        # right to ask it — which would turn a demotion into a group that reads
        # as empty.
        logger.info("getChatMemberCount refused for %s: %s", chat.chat_id, exc)
    else:
        if isinstance(count, int):
            chat.member_count = count
            chat.member_count_at = timezone.now()
            written |= {"member_count", "member_count_at"}

    bot_id = _bot_telegram_id(chat.bot, client)
    if bot_id:
        try:
            member = client.get_chat_member(chat.chat_id, bot_id)
        except TelegramError as exc:
            logger.info("getChatMember refused for %s: %s", chat.chat_id, exc)
        else:
            status = (member or {}).get("status")
            if status in BotChat.Status.values:
                chat.status = status
                chat.rights = _rights_of(member)
                chat.left_at = timezone.now() if status in GONE else None
                written |= {"status", "rights", "left_at"}

    chat.refresh_error = ""
    chat.refreshed_at = timezone.now()
    chat.save(update_fields=[*written, "refresh_error", "refreshed_at", "updated_at"])
    return chat


def _record_refusal(chat: BotChat, exc: TelegramError) -> BotChat:
    """A refusal, written down without taking the row down with it.

    403 is the exception, and it is the one refusal that carries a fact:
    Telegram answers it to a bot asking about a chat it is not in. Recording
    that as an error would leave the panel showing a bot as an administrator of
    a group that removed it while the webhook was down — which is precisely the
    state this screen exists to catch.
    """
    written = ["refresh_error", "refreshed_at", "updated_at"]
    if exc.code == 403:
        chat.status = BotChat.Status.KICKED
        chat.rights = {}
        chat.left_at = chat.left_at or timezone.now()
        chat.refresh_error = ""
        written += ["status", "rights", "left_at"]
    else:
        chat.refresh_error = exc.message[:280]
        logger.info("getChat refused for %s: %s", chat.chat_id, exc)

    chat.refreshed_at = timezone.now()
    chat.save(update_fields=written)
    return chat


def _bot_telegram_id(bot: Bot, client) -> int | None:
    """The bot's own Telegram id, asked for once if it was never stored.

    `getChatMember` needs a user id and a bot connected before that column
    existed has none. Asking `getMe` costs one call the first time and never
    again; the alternative is a refresh that silently skips the one fact the
    whole screen is about.
    """
    if bot.telegram_id:
        return bot.telegram_id
    try:
        profile = client.get_me()
    except TelegramError:
        return None
    telegram_id = (profile or {}).get("id")
    if not isinstance(telegram_id, int):
        return None
    bot.telegram_id = telegram_id
    bot.save(update_fields=["telegram_id", "updated_at"])
    return telegram_id


# ---------------------------------------------------------------------------
# What is wrong here
# ---------------------------------------------------------------------------
#
# The only question anybody opens this screen with is «botim nega bu guruhda
# ishlamayapti», so the answer is computed here rather than assembled out of
# flags by whichever screen happens to render the row. A `danger` finding means
# the bot does nothing at all in that chat; a `warning` means one named thing
# will not work.


def chat_problems(chat: BotChat, bot: Bot) -> list[dict]:
    """Everything standing between this bot and working in this chat."""
    if not chat.is_member:
        return [
            {
                "code": "removed",
                "tone": "danger",
                "message": "Bot bu yerdan chiqarilgan. Qayta qo'shing va admin qiling.",
            }
        ]

    found: list[dict] = []
    channel = chat.type == BotChat.Type.CHANNEL

    if bot.is_paused:
        # Before the module, and instead of it. `module_enabled` answers False
        # for everything while the bot is stopped, so without this every chat
        # would report «bo'limi o'chirilgan» about a switch the reader can see
        # is still on — the panel blaming the wrong control for a state the
        # reader themselves chose.
        found.append({"code": "bot_paused", "tone": "danger", "message": PAUSED_NOTE})
    elif not bot.module_enabled(chat.module_key):
        # First of the per-surface causes, because it is the one that is
        # entirely ours: every right can be in place and the dispatcher still
        # never looks for a flow.
        found.append(
            {
                "code": "module_off",
                "tone": "danger",
                "message": (
                    "Botning «Kanal» bo'limi o'chirilgan — kanal postlariga javob bermaydi."
                    if channel
                    else "Botning «Guruh» bo'limi o'chirilgan — guruh xabarlariga javob bermaydi."
                ),
            }
        )

    if chat.status == BotChat.Status.RESTRICTED:
        found.append(
            {
                "code": "restricted",
                "tone": "danger",
                "message": "Bot bu guruhda cheklangan — xabar yubora olmaydi.",
            }
        )
    elif not chat.is_administrator:
        found.append(
            {
                "code": "not_admin",
                "tone": "danger",
                "message": (
                    "Bot kanalda administrator emas — post joylay olmaydi va postlarni ko'rmaydi."
                    if channel
                    # Privacy mode: a plain member bot is delivered commands and
                    # replies to itself and nothing else, so a keyword flow in
                    # such a group never fires and nothing says why.
                    else "Bot guruhda administrator emas — oddiy xabarlarni ko'rmaydi, faqat buyruqlarni oladi."
                ),
            }
        )
    elif channel and not chat.can("can_post_messages"):
        found.append(
            {
                "code": "cannot_post",
                "tone": "danger",
                "message": "Botga «Post joylash» huquqi berilmagan — kanalga hech nima yubora olmaydi.",
            }
        )
    elif not channel and not chat.can("can_delete_messages"):
        found.append(
            {
                "code": "cannot_delete",
                "tone": "warning",
                "message": "Botda «Xabarlarni o'chirish» huquqi yo'q — spam filtri ishlamaydi.",
            }
        )

    # Only where Telegram has said approval is switched on: a warning about a
    # right nothing in this chat needs is noise, and noise is how a real finding
    # gets skipped.
    if chat.join_by_request and chat.is_administrator and not chat.can("can_invite_users"):
        found.append(
            {
                "code": "cannot_approve",
                "tone": "warning",
                "message": "Botda «A'zo qo'shish» huquqi yo'q — qo'shilish so'rovlarini tasdiqlay olmaydi.",
            }
        )

    if chat.refresh_error:
        # Last, and a warning: it says the *panel* is out of date, not that the
        # bot is broken — and everything above it was read from Telegram before
        # the failure, so it still stands.
        found.append(
            {
                "code": "stale",
                "tone": "warning",
                "message": f"Telegramdan ma'lumot olinmadi: {chat.refresh_error}",
            }
        )
    return found
