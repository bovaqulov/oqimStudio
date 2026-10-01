"""What a Telegram Business account let this bot do — and what it did not.

The account owner attaches the bot in their own Telegram, under Settings →
Business → Chatbots, and ticks what it may do there. Telegram sends that
decision once, on the `business_connection` update, and
`engine.dispatch._store_business_connection` writes it down. **Nothing in this
product has ever read it back.** A bot connected to an account that withheld
«Javob yozish» goes on trying to send; Telegram refuses each call; the flow
dies with an API error that names no switch and points at no screen, because
the switch is in somebody else's app.

So this module is the reading half, and it is deliberately only that. No Bot
API method lets a bot grant itself a right or un-suspend its own connection —
`account.updateConnectedBot` is a *client* method, called by the owner — so
every finding here is a report, never a control. That is the same rule
`chats.chat_problems` follows for a group, and the findings have the same
shape for the same reason: the join of "what Telegram granted" with "what this
workspace switched on" is one rule, and a second copy of it in the browser is
how an account comes to read as healthy on one screen and broken on another.

**The field names are the Bot API's, not MTProto's.** They describe the same
fourteen rights and they are not the same words: what arrives on a webhook is
`can_reply`, `can_view_gifts_and_stars`, `can_convert_gifts_to_stars`; the
client method's flags are `reply`, `view_gifts`, `sell_gifts`. The panel's
catalogue was written from the second list and joined against the first, so
every connection in the product rendered as «0/14 huquq» however much the owner
had granted. `apps/bots/tests.py` pins the two lists against each other.
"""

from __future__ import annotations

from .models import PAUSED_NOTE, Bot, BusinessConnection

#: Every field of Telegram's `BusinessBotRights`, exactly as the Bot API spells
#: them — https://core.telegram.org/bots/api#businessbotrights.
#:
#: Held here rather than only in the frontend catalogue so the two can be
#: checked against each other: the catalogue carries the owner-facing wording,
#: which is the half that is allowed to change.
BUSINESS_RIGHT_FIELDS = (
    "can_reply",
    "can_read_messages",
    "can_delete_sent_messages",
    "can_delete_all_messages",
    "can_edit_name",
    "can_edit_bio",
    "can_edit_profile_photo",
    "can_edit_username",
    "can_change_gift_settings",
    "can_view_gifts_and_stars",
    "can_convert_gifts_to_stars",
    "can_transfer_and_upgrade_gifts",
    "can_transfer_stars",
    "can_manage_stories",
)

#: The one right without which nothing this product does on a Business account
#: works. Telegram: *"True, if the bot can send and edit messages in the private
#: chats that had incoming messages in the last 24 hours."*
REPLY_RIGHT = "can_reply"

#: What a run's trace says when it stops for this.
#:
#: The same fault the panel prints as `cannot_reply`, written for the other
#: reader: `business_problems` is read by somebody looking at the bot and can
#: spend two sentences on where the switch is, while this lands in
#: `FlowRun.error` beside a flow that is not at fault. Named here so the two
#: cannot come to describe different things.
CANNOT_REPLY = "Akkaunt egasi «Javob yozish» huquqini bermagan — bu akkauntda xabar yuborib bo'lmaydi"


def granted(connection: BusinessConnection, right: str) -> bool:
    """Whether Telegram reported one named right as granted.

    `rights` is optional on `BusinessConnection`, and a connection stored
    before this module existed may have `{}`. Absent reads as not granted,
    which is the safe direction: the panel says a right is missing and somebody
    checks, rather than the bot claiming a permission it does not have.
    """
    return (connection.rights or {}).get(right) is True


def business_problems(connection: BusinessConnection, bot: Bot) -> list[dict]:
    """Everything standing between this bot and working on this account.

    Ordered by cause, the way `chat_problems` is: what this workspace switched
    off first, because it is the only part anybody here can change; then what
    the account owner switched off; then the individual rights.

    `danger` means nothing works on this account at all. `warning` means one
    named thing does not.
    """
    found: list[dict] = []

    if bot.is_paused:
        # Before the module, and instead of it — `module_enabled` answers False
        # for every surface while the bot is stopped, so reporting the module
        # here would blame a switch the reader can see is still on.
        found.append({"code": "bot_paused", "tone": "danger", "message": PAUSED_NOTE})
    elif not bot.module_enabled("business"):
        found.append(
            {
                "code": "module_off",
                "tone": "danger",
                "message": (
                    "Botning «Business» bo'limi o'chirilgan — akkauntga kelgan xabarlarga javob bermaydi. "
                    "Yuqoridagi ro'yxatdan yoqing."
                ),
            }
        )

    if not connection.is_enabled:
        # The owner switched the bot off without detaching it. Listing the
        # rights of a bot that is not running at all answers a question nobody
        # has yet, so this returns rather than adding to the pile.
        found.append(
            {
                "code": "suspended",
                "tone": "danger",
                "message": (
                    "Akkaunt egasi botni vaqtincha o'chirib qo'ygan. Telegramda: Sozlamalar → Business → "
                    "Chatbots → botni qayta yoqing."
                ),
            }
        )
        return found

    if not granted(connection, REPLY_RIGHT):
        found.append(
            {
                "code": "cannot_reply",
                "tone": "danger",
                "message": (
                    "Akkaunt egasi botga «Javob yozish» huquqini bermagan — bot bu akkauntda hech qanday xabar "
                    "yubora olmaydi. Telegramda: Sozlamalar → Business → Chatbots → shu botga ruxsat bering."
                ),
            }
        )

    if not granted(connection, "can_read_messages"):
        # A warning and not a failure: the bot still receives and answers. What
        # it cannot do is clear the unread badge, so the owner's own Telegram
        # keeps showing chats the bot has already dealt with.
        found.append(
            {
                "code": "cannot_mark_read",
                "tone": "warning",
                "message": (
                    "Botda «O'qilgan deb belgilash» huquqi yo'q — bot javob bergan suhbatlar sizning "
                    "Telegramingizda o'qilmagan bo'lib turaveradi."
                ),
            }
        )

    return found
