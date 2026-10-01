"""Recording messages, and sending one as a person rather than as a bot.

Three seams write here and nothing else does:

* `engine/dispatch._dispatch` — every incoming update, once, right after the
  contact is known and before anything decides what to do about it. Before a
  trigger is looked for, deliberately: a message nothing claims is exactly the
  one worth keeping.
* `engine/runner._step` — every block the runtime sent, which is already the one
  place a flow's outgoing line is traced.
* `send_reply` below — an operator writing from the panel.

All three then raise one `message.new` on the workspace socket, because to a
chat list they are the same event.

`record_*` never raises. A message that could not be filed is not a reason for a
customer's update to go unanswered, so a failure here is logged and the runtime
carries on; the alternative is a webhook that 500s and a bot Telegram keeps
retrying against a broken table.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db.models import OuterRef, Q, Subquery

from apps.common.exceptions import ApiError
from apps.contacts.models import Contact
from apps.realtime.broadcast import publish, workspace_group
from apps.telegram.client import TelegramError, client_for

from .models import Message

logger = logging.getLogger(__name__)

#: How much of one line is kept. Telegram's own ceiling is 4096 characters for a
#: message and 1024 for a caption; the column is unbounded, this is only a
#: guard against a pathological payload filling the table.
TEXT_LIMIT = 4096


def _record(contact: Contact | None, direction: str, **fields: Any) -> Message | None:
    if contact is None:
        return None
    try:
        message = Message.objects.create(
            workspace_id=contact.workspace_id,
            bot_id=contact.bot_id,
            contact=contact,
            direction=direction,
            text=(fields.pop("text", "") or "")[:TEXT_LIMIT],
            **fields,
        )
    except Exception:  # noqa: BLE001 — see the module docstring
        logger.exception("inbox: could not record a %s message for %s", direction, contact.pk)
        return None

    _announce(contact, message)
    return message


def _announce(contact: Contact, message: Message) -> None:
    """Tells whoever is watching the workspace that a line was added.

    This is the one seam every message already passes through, which is why the
    event is raised here rather than at the three call sites: an operator's
    reply, a customer's message and a block's send are the same event to a chat
    list, and three publishers would have drifted into three shapes of it.

    The payload carries what a screen needs to decide whether it cares —
    which conversation, which bot, which project — and not the message itself.
    A list showing sixty conversations re-reads its own query when one of them
    moves; a payload rich enough to patch the row in place would be a second
    copy of that query, kept in step by hand.

    `publish` never raises and is best-effort by design (see
    `realtime.broadcast`), so nothing here can cost the customer their answer.
    """
    publish(
        workspace_group(contact.workspace_id),
        "message.new",
        {
            "contactId": contact.pk,
            "botId": contact.bot_id,
            "projectId": getattr(contact.bot, "project_id", None),
            "direction": message.direction,
            "kind": message.kind,
            "at": message.created_at.isoformat(),
        },
    )


def record_inbound(contact: Contact | None, *, kind: str = "message", text: str = "", **fields: Any):
    """One message from the customer."""
    return _record(contact, Message.Direction.IN, kind=kind, text=text, **fields)


def record_outbound(contact: Contact | None, *, kind: str = "text", text: str = "", **fields: Any):
    """One message the bot or an operator sent."""
    return _record(contact, Message.Direction.OUT, kind=kind, text=text, **fields)


def conversation_rows(workspace, *, bot_id: str = "", project_id: str = "", query: str = "", limit: int = 60):
    """The chat list: contacts that have said something, newest first.

    One query and not one per row. The last line of each conversation comes back
    as three annotations rather than as a second pass over the contacts, because
    a list of sixty chats would otherwise be sixty-one queries — the shape that
    reads fine on a laptop and falls over on the workspace that actually uses
    this screen.
    """
    latest = Message.objects.filter(contact=OuterRef("pk")).order_by("-created_at", "-id")
    rows = (
        Contact.objects.filter(workspace=workspace, messages__isnull=False)
        .select_related("bot")
        .annotate(
            last_text=Subquery(latest.values("text")[:1]),
            last_kind=Subquery(latest.values("kind")[:1]),
            last_direction=Subquery(latest.values("direction")[:1]),
            last_at=Subquery(latest.values("created_at")[:1]),
        )
        .distinct()
    )
    if project_id:
        rows = rows.filter(bot__project_id=project_id)
    if bot_id:
        rows = rows.filter(bot_id=bot_id)
    if query:
        rows = rows.filter(
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(username__icontains=query)
            | Q(messages__text__icontains=query)
        ).distinct()
    return rows.order_by("-last_at")[:limit]


def send_reply(contact: Contact, text: str, operator) -> Message:
    """An operator's answer, out through the bot and into the thread.

    The row is written only after Telegram has taken the message. A thread that
    shows a line the customer never received is worse than one that shows an
    error: the next person to read it has no way to tell the two apart.
    """
    client = client_for(contact.bot)
    try:
        result = client.call("sendMessage", {"chat_id": contact.chat_id, "text": text})
    except TelegramError as error:
        if error.is_blocked:
            # Telegram will refuse every later send too, and the runtime reads
            # this flag before it tries — so record it here rather than leaving
            # the next operator to discover the same wall.
            Contact.objects.filter(pk=contact.pk).update(is_blocked=True)
            raise ApiError("contact_blocked", "Bu foydalanuvchi botni bloklagan — xabar yetib bormaydi.", status_code=409)
        raise ApiError("telegram_error", f"Telegram xabarni qabul qilmadi: {error.message}", status_code=502)

    message = record_outbound(
        contact,
        kind="text",
        text=text,
        operator=operator,
        telegram_message_id=(result or {}).get("message_id") if isinstance(result, dict) else None,
    )
    if message is None:
        # The send happened; only the bookkeeping failed. Saying "yuborilmadi"
        # would be a lie the customer's phone can disprove.
        raise ApiError("inbox_write_failed", "Xabar yuborildi, lekin suhbatga yozib bo'lmadi.", status_code=500)
    return message
