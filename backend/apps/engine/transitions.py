"""What happens to the message already on screen when the next one is due.

A flow used to have one answer to that: nothing — every block sent a new
message, so a three-level menu left six bubbles in the chat. The answer is now
a property of the **edge** rather than of either block, because "keep the menu
and send under it" and "replace the menu in place" are two different things to
say about the same pair of blocks, and which one is meant depends on how the
reader got there.

Four of them:

    keep          send a new message, leave the old one alone (what it did before)
    clearButtons  strip the old keyboard, then send — history stays, dead rows do not
    edit          rewrite the old message in place, so the chat does not grow
    delete        take the old message away, then send — for what cannot be edited

The module is deliberately free of I/O. Everything here is a pure function of
two block dicts and what is known about the message on screen, so the editor can
ask the same questions the runtime does and offer only the answers that will
actually work — which is the whole design: the *options* are computed, only the
*pick* belongs to the author.

Two facts from https://core.telegram.org/bots/api (Bot API 10.3) decide the
matrix, and neither is guessable:

- `editMessageMedia` — "Use this method to edit animation, audio, document,
  live photo, photo, or video messages, **or to replace a text or a rich
  message with a media**." A text menu can therefore become a photo card in
  place; this was assumed impossible and is not.
- `editMessageText` — "Use this method to edit text, rich and game messages."
  Media is absent from that list, so the reverse is genuinely impossible: a
  photo can never be edited back down to a plain text message.

`delete` is the one whose availability cannot be settled here at all:
`deleteMessage` refuses anything sent more than 48 hours ago, and neither the
editor nor a pure function knows what time it is. It is always offered and the
clock is read in `runner._deliver`, where the answer can still be acted on.
"""

from __future__ import annotations

from typing import Any

from .sender import content_kind, effective_button_mode

#: Leave the message on screen exactly as it is and send a new one under it.
KEEP = "keep"

#: Leave the message but take its keyboard away, then send. The reader keeps the
#: transcript and loses the ability to tap a menu they have already moved past —
#: which is the half of "delete" that is actually about correctness, without the
#: half that throws away what the bot said.
CLEAR_BUTTONS = "clearButtons"

#: Rewrite the message on screen. The chat does not grow and the screen does not
#: jump, which is the only one of these that a customer reads as one moving
#: interface rather than as a conversation.
EDIT = "edit"

#: Take the old message off the screen entirely, then send. What `edit` is for
#: when `edit` is impossible: a photo cannot be rewritten into text and an
#: invoice cannot be rewritten at all, so the only way to keep those flows from
#: piling up is to remove what came before. The chat does not grow — but the new
#: message lands at the bottom rather than in place, so the screen jumps. That
#: is the whole difference between this and `edit`, and it is why neither can
#: stand in for the other.
DELETE = "delete"

#: Every kind, in the order a reader meets them: least of the old message
#: surviving first. Display order, not degradation order — see `FALLBACK`.
ORDER = (EDIT, DELETE, CLEAR_BUTTONS, KEEP)

KINDS = frozenset(ORDER)

#: Where each kind steps when it cannot be carried out, and `None` at the floor.
#:
#: Not a straight line, which is why this is a map and no longer a tuple. A
#: refused `edit` must not fall through to `delete`: the author picked the
#: transition that keeps the message and quietly destroying it instead is worse
#: than the failure. A refused `delete` must not fall through to `edit` either —
#: it was very likely picked *because* editing was impossible. Both step
#: sideways onto the mildest thing that still helps, and from there to the
#: behaviour the runtime had before any of this existed.
FALLBACK: dict[str, str | None] = {
    EDIT: CLEAR_BUTTONS,
    DELETE: CLEAR_BUTTONS,
    CLEAR_BUTTONS: KEEP,
    KEEP: None,
}

#: How long Telegram lets a bot take a message back.
#:
#: `deleteMessage`: "A message can only be deleted if it was sent less than 48
#: hours ago." Unlike every edit method, which carries no such limit for a
#: message the bot sent itself, this one is a wall — and it is the reason the
#: run has to remember *when* the screen was put up and not only which message
#: it is. A flow woken by a Kutish block two days later cannot tidy up after
#: itself and must not try.
DELETE_WINDOW_HOURS = 48

#: Longest a delete may be held back for. Seconds, and the ceiling is an hour
#: because past that "delete the old message" has stopped being about how a
#: chat reads and the 48-hour wall is closing in behind it.
MAX_DELETE_DELAY = 3600

#: Content kinds `editMessageMedia` can produce, taken from the method's own
#: sentence. `voice` is deliberately absent: there is no `InputMediaVoice`, so a
#: voice message can be sent but never edited into.
EDITABLE_MEDIA = frozenset({"photo", "video", "animation", "document", "audio"})

#: What a message on screen may be edited *from*. Text is the permissive one —
#: it can become text again or any media. Media can only become other media.
#: Everything else (an invoice, an album, a poll, a location, a copied post)
#: cannot be edited at all, in either direction.
_EDITABLE_FROM: dict[str, frozenset[str]] = {
    "text": frozenset({"text"}) | EDITABLE_MEDIA,
    **{kind: EDITABLE_MEDIA for kind in EDITABLE_MEDIA},
}


def can_edit(previous_kind: str, next_kind: str) -> bool:
    """Whether Telegram will let this message become that one."""
    return next_kind in _EDITABLE_FROM.get(previous_kind, frozenset())


def accepts_inline_keyboard(node: dict) -> bool:
    """Whether this block's keyboard can ride on an edited message.

    Every `editMessage…` method types `reply_markup` as `InlineKeyboardMarkup`
    and nothing else. A reply keyboard is not part of a message at all — it is
    chat furniture, and the only way to put one up is to send something — so a
    block that wants one can never be delivered as an edit. A block with no
    keyboard at all passes: there is nothing to attach.
    """
    return effective_button_mode(node) != "reply"


def available(previous_kind: str, previous_inline: bool, node: dict) -> list[str]:
    """The transitions that could work here, best first.

    `previous_kind` and `previous_inline` describe the message currently on
    screen. The editor knows them from the block that sent it; the runtime knows
    them from what it actually sent, which is the more truthful of the two and
    the reason both go through this one function.

    "Could" is the operative word: everything decidable without a network call
    is decided here, and the rest — has the message been deleted, will Telegram
    take this particular edit — is what the ladder in `runner._deliver` is for.
    """
    options = [KEEP]
    if previous_inline:
        options.insert(0, CLEAR_BUTTONS)
    # Deleting asks nothing of either block: any message the bot sent can be
    # taken back, and the one condition — that it went out less than 48 hours
    # ago — is a fact about the clock rather than about the graph. The editor
    # cannot know it and neither can this function, so it is offered here and
    # checked in `runner._deliver` at the moment it matters.
    options.insert(0, DELETE)
    if can_edit(previous_kind, content_kind(node)) and accepts_inline_keyboard(node):
        options.insert(0, EDIT)
    return options


def delete_delay(edge: dict[str, Any] | None) -> int:
    """Seconds to wait before taking the old message away, clamped to sane.

    Zero — the default — deletes before the new message is sent, so the reader
    never sees both. Anything else sends first and removes the old one after,
    which is the only reason to want a delay at all: it lets somebody finish
    reading what is being replaced.
    """
    try:
        seconds = int((edge or {}).get("deleteAfterSeconds") or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(seconds, MAX_DELETE_DELAY))


def default_for(node: dict, previous_inline: bool = False) -> str:
    """What an edge into this block means when nobody has said.

    «Menyu» was the one block that defaulted to replacing the screen before it
    (a menu after a menu being the next page of the same one); it has been
    removed from the product, so every edge now keeps by default and an author
    who wants an edit asks for it on the edge. `previous_inline` is kept in the
    signature because callers still pass it and a later block type may want it.
    """
    return KEEP


def resolve(edge: dict[str, Any] | None, node: dict, previous_inline: bool = False) -> str:
    """The transition to attempt for this edge into this block.

    Three layers, most specific first: what the author set on the line itself,
    then the block's own default for everything wired into it, then
    `default_for`. The middle one exists because a block can be reached from ten
    places and configuring the same intent ten times is how a graph drifts out
    of step with itself.

    An unknown string — a graph written by an older editor, or by hand through
    the API — falls through to the next layer rather than being trusted.
    """
    for candidate in ((edge or {}).get("transition"), node.get("incomingTransition")):
        if candidate in KINDS:
            return candidate
    return default_for(node, previous_inline)
