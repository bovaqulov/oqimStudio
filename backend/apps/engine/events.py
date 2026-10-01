"""One normalised shape for every kind of Telegram update.

The Bot API delivers a dozen differently-shaped objects that all mean "someone
did something in a chat". Matching a trigger against each of those shapes
directly would put Telegram's schema into every rule; instead an update is read
once, here, into an `IncomingEvent` that says what happened in the vocabulary
the editor uses.

See https://core.telegram.org/bots/api#update
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Message keys that mean the message carries this content type.
MEDIA_FIELDS = {
    "photo": "photo",
    "video": "video",
    "audio": "audio",
    "voice": "voice",
    "document": "document",
    "location": "location",
    "contact": "contact",
}


@dataclass
class IncomingEvent:
    """What arrived, in the terms a trigger is written in."""

    update_id: int = 0
    #: "message", "callback", "join", "leave", "join_request", "channel_post",
    #: "reaction", "payment", "pre_checkout", "webapp", "blocked", "unblocked",
    #: "business_connection", "membership"
    kind: str = "message"
    chat_id: int | None = None
    chat_type: str = "private"
    chat_title: str = ""
    message_id: int | None = None
    #: Where an answer has to be sent, when that is not the chat the update
    #: happened in. A join request arrives on the group but is answered in the
    #: applicant's private chat (Telegram hands that id over as `user_chat_id`).
    reply_chat_id: int | None = None

    user_id: int | None = None
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    language_code: str = ""

    text: str = ""
    #: The command without its slash, when the message starts with one.
    command: str = ""
    callback_data: str = ""
    callback_query_id: str = ""
    #: Content types present on the message, e.g. {"photo"}.
    media: set[str] = field(default_factory=set)
    #: Set on Business updates — which connected account this belongs to.
    business_connection_id: str = ""
    payment: dict[str, Any] = field(default_factory=dict)
    #: Telegram's last word before it charges the card. It expires in ten
    #: seconds and has to be answered or the payment simply fails — see
    #: `dispatch._answer_pre_checkout`.
    pre_checkout: dict[str, Any] = field(default_factory=dict)
    web_app_data: dict[str, Any] = field(default_factory=dict)
    #: What a one-tap share sent back — the answer to a question whose
    #: `answerType` is "contact" or "location". Neither carries any text.
    shared_contact: dict[str, Any] = field(default_factory=dict)
    shared_location: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def is_business(self) -> bool:
        return bool(self.business_connection_id)

    @property
    def reply_to(self) -> int | None:
        """The chat this event's answer goes to."""
        return self.reply_chat_id or self.chat_id

    @property
    def answer_text(self) -> str:
        """What this update says, as an answer to a question.

        A shared phone number or place arrives with no text at all, so reading
        `text` alone would store an empty answer for the two `answerType`s the
        editor offers besides typing.
        """
        if self.text:
            return self.text
        if self.shared_contact:
            return self.shared_contact.get("phone_number", "")
        if self.shared_location:
            return f"{self.shared_location.get('latitude', '')},{self.shared_location.get('longitude', '')}"
        return ""

    @property
    def web_app_payload(self) -> str:
        """The string the Mini App handed to `sendData`, verbatim.

        Named rather than read inline everywhere, because every reader of it
        has to be reminded of the same thing: it is client input. The Bot API
        says so outright — "a bad client can send arbitrary data in this
        field" — so nothing may treat it as an answer without checking it
        against something this server wrote.
        """
        return str(self.web_app_data.get("data") or "")

    @property
    def module_key(self) -> str:
        """Which of the five surfaces this update belongs to.

        Derived from the update, not configured: a message from a connected
        Business account is a business message wherever it was sent from, and a
        channel post can only ever be a channel event.
        """
        if self.is_business:
            return "business"
        if self.kind == "channel_post" or self.chat_type == "channel":
            return "channels"
        if self.chat_type in {"group", "supergroup"}:
            return "groups"
        if self.kind == "webapp":
            return "webapp"
        return "dms"


def _read_user(user: dict | None) -> dict[str, Any]:
    user = user or {}
    return {
        "user_id": user.get("id"),
        "first_name": user.get("first_name", "") or "",
        "last_name": user.get("last_name", "") or "",
        "username": user.get("username", "") or "",
        "language_code": user.get("language_code", "") or "",
    }


def _read_command(text: str) -> str:
    """"/menu@my_bot arg" -> "menu". Empty when the text is not a command."""
    if not text.startswith("/"):
        return ""
    head = text.split(maxsplit=1)[0][1:]
    return head.split("@", 1)[0].lower()


def _media_of(message: dict) -> set[str]:
    return {kind for kind, key in MEDIA_FIELDS.items() if message.get(key)}


def parse_update(update: dict) -> IncomingEvent | None:
    """Reads one Telegram update. Returns None for updates nothing can be routed on."""
    event = IncomingEvent(update_id=update.get("update_id", 0), raw=update)

    business_message = update.get("business_message")
    message = update.get("message") or business_message or update.get("edited_message")
    channel_post = update.get("channel_post") or update.get("edited_channel_post")
    callback = update.get("callback_query")
    join_request = update.get("chat_join_request")
    reaction = update.get("message_reaction")
    my_chat_member = update.get("my_chat_member")
    business_connection = update.get("business_connection")
    pre_checkout = update.get("pre_checkout_query")

    if business_message:
        event.business_connection_id = business_message.get("business_connection_id", "")

    if pre_checkout:
        # There is no chat on this update — Telegram is asking the bot, not the
        # customer. It is answered and never routed to a flow.
        event.kind = "pre_checkout"
        event.pre_checkout = pre_checkout
        event.__dict__.update(_read_user(pre_checkout.get("from")))
        event.chat_id = event.user_id
        event.text = pre_checkout.get("invoice_payload", "") or ""
        return event

    if business_connection:
        event.kind = "business_connection"
        event.business_connection_id = business_connection.get("id", "")
        event.__dict__.update(_read_user(business_connection.get("user")))
        event.chat_id = business_connection.get("user_chat_id")
        return event

    if message:
        chat = message.get("chat", {})
        event.kind = "message"
        event.chat_id = chat.get("id")
        event.chat_type = chat.get("type", "private")
        event.chat_title = chat.get("title", "") or ""
        event.message_id = message.get("message_id")
        event.__dict__.update(_read_user(message.get("from")))
        event.text = message.get("text") or message.get("caption") or ""
        event.command = _read_command(event.text)
        event.media = _media_of(message)
        event.shared_contact = message.get("contact") or {}
        event.shared_location = message.get("location") or {}

        if message.get("new_chat_members"):
            event.kind = "join"
        elif message.get("left_chat_member"):
            event.kind = "leave"
        elif message.get("successful_payment"):
            event.kind = "payment"
            event.payment = message["successful_payment"]
        elif message.get("web_app_data"):
            event.kind = "webapp"
            event.web_app_data = message["web_app_data"]
        return event

    if channel_post:
        chat = channel_post.get("chat", {})
        event.kind = "channel_post"
        event.chat_id = chat.get("id")
        event.chat_type = chat.get("type", "channel")
        event.chat_title = chat.get("title", "") or ""
        event.message_id = channel_post.get("message_id")
        event.text = channel_post.get("text") or channel_post.get("caption") or ""
        event.media = _media_of(channel_post)
        return event

    if callback:
        chat = (callback.get("message") or {}).get("chat", {})
        event.kind = "callback"
        event.chat_id = chat.get("id")
        event.chat_type = chat.get("type", "private")
        event.message_id = (callback.get("message") or {}).get("message_id")
        event.__dict__.update(_read_user(callback.get("from")))
        event.callback_data = callback.get("data", "") or ""
        event.callback_query_id = callback.get("id", "") or ""
        event.text = event.callback_data
        return event

    if join_request:
        chat = join_request.get("chat", {})
        event.kind = "join_request"
        event.chat_id = chat.get("id")
        event.chat_type = chat.get("type", "supergroup")
        event.chat_title = chat.get("title", "") or ""
        # Bot API 6.5+: the private chat with the applicant. Without it the bot
        # has nowhere to answer — a join request is not sent in a chat the bot
        # may write to.
        event.reply_chat_id = join_request.get("user_chat_id")
        event.__dict__.update(_read_user(join_request.get("from")))
        return event

    if reaction:
        chat = reaction.get("chat", {})
        event.kind = "reaction"
        event.chat_id = chat.get("id")
        event.chat_type = chat.get("type", "private")
        event.message_id = reaction.get("message_id")
        event.__dict__.update(_read_user(reaction.get("user")))
        return event

    if my_chat_member:
        # One update, two entirely different subjects. In a private chat it is
        # the customer: "kicked" is somebody blocking the bot and "member"
        # again is them unblocking it. Anywhere else it is the bot's own
        # standing in a room — added, promoted, demoted, thrown out — which
        # nothing but this update ever announces.
        status = (my_chat_member.get("new_chat_member") or {}).get("status", "")
        chat = my_chat_member.get("chat", {})
        chat_type = chat.get("type", "")
        if chat_type == "private":
            if status not in {"kicked", "member"}:
                return None
            event.kind = "blocked" if status == "kicked" else "unblocked"
            event.chat_id = chat.get("id")
            event.__dict__.update(_read_user(my_chat_member.get("from")))
            return event
        if chat_type in {"group", "supergroup", "channel"}:
            event.kind = "membership"
            event.chat_id = chat.get("id")
            event.chat_type = chat_type
            event.chat_title = chat.get("title", "") or ""
            # Who did it. A group's own screen says "Aziza added the bot", and
            # the panel has no other way to know which of forty administrators
            # that was.
            event.__dict__.update(_read_user(my_chat_member.get("from")))
            return event
        return None

    return None
