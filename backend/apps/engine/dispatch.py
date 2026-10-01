"""From "an update arrived" to "a flow ran".

The order here is the whole routing policy:

0. Some updates are not conversation at all — a Business account attaching the
   bot, a `my_chat_member` saying the bot was added to a group or demoted in
   one. Those are state, filed where the panel reads them, and they never reach
   the ladder below.
1. A run that is already waiting on this contact wins. Someone who was asked a
   question is answering it, not starting a new conversation — routing their
   reply to a keyword handler is the single most common way a bot feels broken.
2. Otherwise the first matching trigger opens a new run.
3. Nothing matched: the update is filed to Suhbatlar and nothing is sent. A
   bot answers what its flows cover and says nothing else.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.analytics.services import record_event
from apps.billing.services import plan_allows
from apps.inbox.services import record_inbound
from apps.bots.chats import record_membership
from apps.bots.models import BusinessConnection
from apps.common.models import new_id
from apps.contacts.models import Contact
from apps.notifications.services import warn_about_usage
from apps.engine.models import ProcessedUpdate
from apps.flows.models import FlowRun
from apps.realtime.broadcast import bot_group, buffered_publishing, publish
from apps.telegram.client import TelegramError, client_for

from .events import IncomingEvent, parse_update
from .matching import find_trigger
from .runner import finish, resume_with_reply, routable_buttons, start_run
from .sender import (
    CANCEL_DATA,
    COMMAND_PREFIX,
    LANGUAGE_PREFIX,
    STARS_CURRENCY,
    BACK_DATA,
    BUTTON_PREFIX,
    back_row_label,
    content_kind,
    effective_button_mode,
)

logger = logging.getLogger(__name__)


def _refresh_contact(contact: Contact, event: IncomingEvent) -> None:
    """What one more update teaches us about somebody already on file."""
    contact.first_name = event.first_name or contact.first_name
    contact.last_name = event.last_name or contact.last_name
    contact.username = event.username or contact.username
    # Somebody who switches their phone to Russian is answered in Russian
    # from the next message on — but only until they pick a language for
    # themselves, which `mijoz_tili` records and outranks this.
    contact.language_code = event.language_code or contact.language_code
    # Only a private chat updates the contact's own chat id. Writing the
    # group's id here would leave every later message to this person
    # addressed to a room they happened to post in once; where a *run*
    # answers is the run's business (see `runner._initial_context`).
    if event.chat_type == "private" or not contact.chat_id:
        contact.chat_id = event.reply_to or contact.chat_id
        contact.chat_type = event.chat_type or contact.chat_type
    contact.last_seen_at = timezone.now()
    contact.save(
        update_fields=[
            "first_name",
            "last_name",
            "username",
            "language_code",
            "chat_id",
            "chat_type",
            "last_seen_at",
        ]
    )


def upsert_contact(bot, event: IncomingEvent) -> tuple[Contact | None, bool]:
    """The person behind this update, created on first sight — or not filed at all.

    `None` is not an error and never was: the callers below already carry it
    (`if created and contact`, `if contact and ...`), because an update can
    arrive with nobody identifiable behind it. What is new is the second way to
    get it — a workspace whose plan has no room for another contact.

    That trade is the one `apps.billing.services` writes out. This is a webhook,
    so a refusal cannot be raised: Telegram redelivers anything it is not
    answered 200, and a `PlanLimitExceeded` here would become the same update,
    forever. And it must not silence the bot either — the person writing is the
    one party in this story who cannot know why, and to them a bot that says
    nothing is a broken product rather than a full plan. So the plan costs the
    *filing* and nothing else: no row in Kontaktlar, no thread in Suhbatlar, no
    `newContacts` event — and the flow still matches, and the answer still goes
    out, addressed from the event's own chat id.

    The sharp edge, stated because it is easy to miss: a run with no contact
    has nothing to be waiting *on*, so an unfiled person cannot be asked a
    question and have their answer recognised. A multi-step flow becomes a
    one-step one for them. That is still the better half of the trade — the
    alternative is silence — and it is one more reason the workspace is told
    (`warn_about_usage`) rather than left to find out from a bar on a screen.

    The order of the two queries is the other decision here. `get_or_create`
    cannot say in advance whether it is about to create, so counting before it
    would put a `COUNT(*)` on *every incoming message* of every capped
    workspace. Looking first and counting only on a miss makes a returning
    contact cost exactly what it cost before — one SELECT and one UPDATE — and
    moves the count to once per new person.
    """
    if event.user_id is None or event.chat_id is None:
        return None, False

    contact = Contact.objects.filter(bot=bot, telegram_user_id=event.user_id).first()
    if contact is not None:
        _refresh_contact(contact, event)
        return contact, False

    if not plan_allows(bot.workspace, "contacts"):
        logger.info("contact %s of %s left unfiled: the plan is full", event.user_id, bot.id)
        warn_about_usage(bot.workspace, "contacts")
        return None, False

    try:
        with transaction.atomic():
            contact = Contact.objects.create(
                bot=bot,
                telegram_user_id=event.user_id,
                workspace=bot.workspace,
                chat_id=event.reply_to,
                chat_type=event.chat_type,
                first_name=event.first_name,
                last_name=event.last_name,
                username=event.username,
                language_code=event.language_code,
                source="direct",
            )
    except IntegrityError:
        # The race `get_or_create` used to absorb, absorbed. The chat lock
        # serialises one conversation, not one *person*: the same Telegram user
        # writing in a group and in their own chat is two chat ids and two
        # workers, and `uniq_contact_per_bot` is what stops the second one.
        contact = Contact.objects.filter(bot=bot, telegram_user_id=event.user_id).first()
        if contact is None:
            raise
        _refresh_contact(contact, event)
        return contact, False
    # On the way in as well as at the door. Told only when the cap is already
    # full, a workspace hears about it for the first time from a notice saying
    # customers are being dropped — after the first ones already have been.
    # This is the same throttled call and it costs one cache round trip per new
    # person, which is the cheapest warning in the product.
    warn_about_usage(bot.workspace, "contacts")
    return contact, True


def _handle_status_change(bot, event: IncomingEvent, contact: Contact | None) -> None:
    """Blocks and unblocks are state, not conversation — recorded either way."""
    if contact is None:
        return
    if event.kind == "blocked" and not contact.is_blocked:
        contact.is_blocked = True
        contact.save(update_fields=["is_blocked"])
    elif event.kind == "unblocked" and contact.is_blocked:
        contact.is_blocked = False
        contact.save(update_fields=["is_blocked"])


def _store_business_connection(bot, event: IncomingEvent) -> None:
    connection = event.raw.get("business_connection") or {}
    BusinessConnection.objects.update_or_create(
        connection_id=event.business_connection_id,
        defaults={
            "bot": bot,
            "user_chat_id": connection.get("user_chat_id"),
            "user_name": (connection.get("user") or {}).get("first_name", ""),
            "username": (connection.get("user") or {}).get("username", ""),
            "rights": connection.get("rights") or {},
            "is_enabled": connection.get("is_enabled", True),
        },
    )


def _shared_reply_port(node: dict, event: IncomingEvent) -> str | None:
    """The port a *request row's* answer leaves through.

    A share sent by `request_contact` / `request_location` arrives as a contact
    or a location, not as text, so the label matching below has nothing to hold
    — the button's kind is the only thing that names the branch. First match
    wins; two request rows of the same kind on one keyboard cannot be told
    apart, because Telegram sends the same update for either.
    """
    if effective_button_mode(node) != "reply":
        return None
    wanted = "request_contact" if event.shared_contact else "request_location" if event.shared_location else ""
    if not wanted:
        return None
    for button in routable_buttons(node):
        if button.get("kind") == wanted:
            return f"{BUTTON_PREFIX}{button.get('id', '')}"
    return None


def _reply_keyboard_port(node: dict, text: str) -> str | None:
    """The port a tapped *reply* keyboard row leaves through.

    A reply keyboard is not inline: Telegram sends the row's label back as an
    ordinary message, so the label is the only thing that identifies the branch.
    """
    if effective_button_mode(node) != "reply" or not text:
        return None
    wanted = text.strip().casefold()
    for button in routable_buttons(node):
        if (button.get("label") or "").strip().casefold() == wanted:
            return f"{BUTTON_PREFIX}{button.get('id', '')}"
    return None


def _webapp_port(node: dict) -> str | None:
    """The exit a Mini App's answer leaves the parked block through.

    The Web App row is what opened the app, so its branch is where the app's
    answer belongs — the same argument that makes a tapped keyboard row an
    exit. It cannot be matched by label the way an ordinary reply row is:
    tapping this one opens a page instead of sending its text, and what comes
    back minutes later is a service message that names nothing.

    First match wins. Two Mini App rows on one keyboard cannot be told apart —
    `WebAppData.button_text` does carry the label, but the Bot API says of that
    field, as of `data`, that "a bad client can send arbitrary data" in it, so
    it is not something a branch may be chosen by.
    """
    for button in routable_buttons(node):
        if button.get("kind") == "webapp":
            return f"{BUTTON_PREFIX}{button.get('id', '')}"
    return None


def _reply_port(run: FlowRun, event: IncomingEvent) -> str | None:
    """Which exit this update continues a parked run through, or None to let it
    be routed as a new message.

    A pressed button always belongs to the run that drew it. Typed text belongs
    to a **question** — that block asked for it — or to a reply keyboard whose
    row it names. Anything else is a new conversation: someone who types
    "narx qancha?" instead of tapping a row has not answered the keyboard, and
    swallowing that into an exit the author never connected is how a bot ends
    up ignoring its customers.
    """
    if event.callback_data.startswith(BUTTON_PREFIX):
        return event.callback_data
    node = run.flow.node(run.current_node_id) or {}
    # The block's own way back, before anything a block type has to say about
    # the update: the row is drawn on every kind of keyboard block there is,
    # and on a reply keyboard it arrives as ordinary text — which a question
    # would otherwise swallow as its answer.
    if event.callback_data == BACK_DATA:
        return "back"
    # A Mini App answering the block that opened it. Read here — before the
    # rules about text and about question blocks below — because a
    # `web_app_data` message carries no text at all: a question would have
    # stored the empty string as the customer's answer and walked on.
    #
    # None when the parked block has no Web App row, which is the honest
    # answer: the submission belongs to whatever *did* open the app, and the
    # `webapp` module's own handler is where it goes instead.
    if event.kind == "webapp":
        return _webapp_port(node)
    back_label = back_row_label(node, run.context)
    if back_label and not event.command and event.text.strip().casefold() == back_label.casefold():
        return "back"
    # Money settling is the answer an invoice block was parked for. It arrives
    # as its own update kind rather than as anything the customer typed, so it
    # is read before the rules about text below.
    if content_kind(node) == "invoice":
        if event.kind == "payment":
            return "paid"
        # The way-out row the invoice always carries — see `sender.CANCEL_DATA`.
        return "cancelled" if event.callback_data == CANCEL_DATA else None
    node_type = node.get("type", "")
    # A language leaves through the block's one exit; which row was tapped
    # travels as the answer rather than as the port.
    if node_type == "language":
        return "out" if event.callback_data.startswith(LANGUAGE_PREFIX) else None
    # A command is an instruction, never an answer. Somebody who types /start
    # halfway through a parked run is starting over, and swallowing it into an
    # exit the author never connected is how a bot ends up ignoring its customer.
    if event.command:
        return None
    # A «Savol» asked for exactly this. It is the one block type whose answer is
    # whatever the customer typed rather than a row they tapped, so the text
    # leaves through the block's single exit and `runner._answer_question`
    # decides whether it was an answer at all.
    #
    # The docstring above has claimed this since before the block existed; the
    # branch did not, so a question parked and then let the very answer it was
    # waiting for fall through to «this is a new conversation».
    if node_type == "question":
        return "out"
    return _shared_reply_port(node, event) or _reply_keyboard_port(node, event.text)


def _store_shared_phone(event: IncomingEvent, contact: Contact | None) -> None:
    """Keeps a phone number the customer shared, once.

    It is the answer to a question *and* a fact about the person, and
    `{{mijoz_telefoni}}` reads it from here.
    """
    phone = (event.shared_contact or {}).get("phone_number", "")
    if contact and phone and contact.phone != phone:
        contact.phone = phone[:32]
        contact.save(update_fields=["phone"])


def _close_superseded_runs(contact: Contact, event: IncomingEvent) -> int:
    """Ends runs this update has just walked away from.

    Starting a new conversation while one was parked leaves two runs waiting on
    the same person; the next thing they type would land in whichever the
    ordering happened to pick. The old one is closed and says why.

    Through `runner._finish` and not with a save of its own. This used to write
    the four columns here, which made it the one ending in the product that
    skipped everything an ending does — and once flows grew their own
    `onFlowEnd`, that meant a conversation somebody walked away from was the
    single case where the hook the author wrote never ran. A panel that lists a
    hook the runtime calls at four endings out of five is worse than one that
    lists none: nothing tells the author which ending they are missing.
    """
    stale = list(
        FlowRun.objects.filter(
            contact=contact, status__in=[FlowRun.Status.WAITING, FlowRun.Status.SLEEPING], is_test=False
        )
    )
    for run in stale:
        reason = f"Yangi buyruq bilan to'xtatildi: /{event.command}" if event.command else "Yangi suhbat boshlandi"
        finish(run, FlowRun.Status.DONE, reason)
    return len(stale)


def _acknowledge_callback(bot, event: IncomingEvent) -> None:
    """Clears the spinner on a tapped inline button.

    Telegram leaves a pressed button loading until `answerCallbackQuery`
    arrives, so this happens before any flow is matched — the button has to stop
    spinning whether or not anything answers it.
    """
    if not event.callback_query_id:
        return
    try:
        client_for(bot).answer_callback_query(event.callback_query_id)
    except TelegramError:
        # Purely cosmetic, and the query id expires quickly. Never worth
        # failing the update that carried it.
        logger.debug("answerCallbackQuery failed for %s", bot.id, exc_info=True)


def _rewrite_menu_button(event: IncomingEvent) -> None:
    """Turns a tap on a «Bosh menyu» row into the command it stands for.

    The row is not an exit from any graph — it puts the customer back at
    `/start` (or whichever command the author chose on the Menyu block).
    Rewriting it here, before anything is matched, means every rule downstream
    sees the update it would have seen had the command been typed, and none of
    them need to know the row exists.

    Older graphs can still carry a `cmd:` row minted by the bot's own safety-net
    menu, which is gone. They keep working: the tap says which command to run
    and that is all this ever read.
    """
    if event.kind != "callback" or not event.callback_data.startswith(COMMAND_PREFIX):
        return
    command = event.callback_data[len(COMMAND_PREFIX) :].strip().lstrip("/").lower()
    if not command:
        return
    event.kind = "message"
    event.command = command
    event.text = f"/{command}"
    event.callback_data = ""


def _answer_pre_checkout(bot, event: IncomingEvent) -> dict:
    """Approves the charge Telegram is about to make.

    There is nothing to decide here yet: the invoice was built by this bot from
    the author's own block moments ago, and the goods are a message rather than
    stock that can run out. What matters is that the answer arrives at all.
    """
    query_id = (event.pre_checkout or {}).get("id", "")
    if not query_id:
        return {"handled": False, "reason": "pre_checkout_without_id"}
    try:
        client_for(bot).answer_pre_checkout_query(query_id, ok=True)
    except TelegramError as exc:
        logger.warning("answerPreCheckoutQuery failed for %s: %s", bot.id, exc)
        return {"handled": False, "reason": "pre_checkout_failed"}
    return {"handled": True, "reason": "pre_checkout_ok"}


def _waiting_run(contact: Contact, event: IncomingEvent) -> FlowRun | None:
    """The parked run this update belongs to.

    Newest first, because that is the question most recently asked. A button
    press is the exception: it names the exact row it came from, so the run that
    still has that exit is the one it belongs to — otherwise tapping a keyboard
    from earlier in the conversation would answer a question it never saw.
    """
    parked = list(
        FlowRun.objects.filter(contact=contact, status=FlowRun.Status.WAITING, is_test=False)
        # `contact` too: resuming a run records a "messages" event, which reads
        # the contact's source — one lazy query per answered message without it.
        .select_related("flow", "bot", "workspace", "contact")
        .order_by("-started_at")
    )
    if not parked:
        return None

    if event.callback_data.startswith(BUTTON_PREFIX):
        for run in parked:
            if run.flow.next_node_id(run.current_node_id, event.callback_data):
                return run
    return parked[0]


def claim_update(bot, update_id: int) -> bool:
    """Records this update as ours to handle. False when it already was.

    The check and the record are the same operation on purpose: two workers
    holding the same re-delivered update both ask, and the unique key decides
    which one gets it.
    """
    if not update_id:
        # No id to be idempotent about — better to handle it than to drop it.
        return True
    _, created = ProcessedUpdate.objects.get_or_create(bot=bot, update_id=update_id)
    return created


#: How long one update may hold its chat, and how long the next may wait for
#: it. Holding: a single degraded-but-successful Bot API call may take up to
#: `TELEGRAM_REQUEST_TIMEOUT` (20s) and a walk may make several, so the TTL
#: has to sit above the *worst* legal walk — a TTL of 30 lapsed mid-walk and
#: readmitted the very interleave the lock exists to stop. A crashed holder
#: now costs the chat two minutes, which a redelivery outlives. Waiting stays
#: short: a queue that backs up degrades into Celery retries rather than into
#: a pile of sleeping workers.
CHAT_LOCK_TTL = 120
CHAT_LOCK_WAIT = 20


class ChatBusy(RuntimeError):
    """The conversation is still busy with the previous update."""


@contextmanager
def chat_lock(bot_id: str, chat_id):
    """One update per conversation at a time, across every worker.

    Without it, two updates from the same person land on two Celery workers and
    both resume the same WAITING run at the same node: both store their text
    under that node's variable, both walks send the next question — the
    customer sees it twice — and the whole-column JSON saves of `run.context`
    and `contact.variables` clobber each other with stale dicts. On a real
    stand this shredded an intake's answers across its variables (BUG-005);
    the test suite never sees it because eager Celery is serial by nature.

    A cache lock and not `select_for_update`, because the row to serialise on
    (the contact) may not exist until `upsert_contact` runs inside the very
    section being protected — and SQLite, which the stand runs on, takes no row
    locks at all. `cache.add` is atomic on Redis and on locmem alike.
    """
    if chat_id is None:
        yield
        return
    key = f"engine:chat-lock:{bot_id}:{chat_id}"
    token = new_id()
    try:
        deadline = time.monotonic() + CHAT_LOCK_WAIT
        while not cache.add(key, token, timeout=CHAT_LOCK_TTL):
            if time.monotonic() > deadline:
                # Taking the chat anyway risks exactly the interleave this
                # exists to stop — better to let Celery redeliver into a freed
                # lock.
                raise ChatBusy(f"chat {chat_id} of {bot_id} held past {CHAT_LOCK_WAIT}s")
            time.sleep(0.05)
    except ChatBusy:
        raise
    except Exception:  # noqa: BLE001 — see below
        # The cache is down, which on this deployment means Redis is down —
        # the same Redis the broker runs on, which is exactly when the webhook
        # falls back to processing updates inline. Refusing to answer without
        # the lock would turn a cache outage into a bot that answers nobody;
        # answering without serialisation risks only the interleave, and only
        # while Redis is out. Availability wins that trade.
        logger.warning("chat lock unavailable for %s:%s — proceeding without it", bot_id, chat_id, exc_info=True)
        yield
        return
    try:
        yield
    finally:
        try:
            # Only our own token: deleting after a TTL expiry would free a
            # lock a later holder has already taken.
            if cache.get(key) == token:
                cache.delete(key)
        except Exception:  # noqa: BLE001 — the TTL is the backstop
            logger.warning("chat lock release failed for %s:%s", bot_id, chat_id, exc_info=True)


def dispatch(bot, update: dict) -> dict:
    """Routes one raw Telegram update. Returns what was decided, for the log.

    The whole update's realtime events are batched and sent once at the end
    (see `buffered_publishing`) so none of them sits between the messages the
    customer is being sent.
    """
    event = parse_update(update)
    with chat_lock(bot.id, event.chat_id if event else None), buffered_publishing():
        return _dispatch(bot, update, event)


def _dispatch(bot, update: dict, event: IncomingEvent | None = None) -> dict:
    if event is None:
        event = parse_update(update)
    if event is None:
        return {"handled": False, "reason": "unsupported_update"}

    if not claim_update(bot, event.update_id):
        # A re-delivery. Answering it again would send the customer the same
        # message twice and feed a question an answer it already had.
        logger.info("update %s for %s already handled", event.update_id, bot.id)
        return {"handled": False, "reason": "duplicate"}

    publish(
        bot_group(bot.id),
        "update.received",
        {"botId": bot.id, "kind": event.kind, "text": event.text[:200], "chatId": event.chat_id},
    )

    if event.kind == "business_connection":
        _store_business_connection(bot, event)
        return {"handled": True, "reason": "business_connection"}

    # Somebody added the bot to a group, made it an administrator, took the
    # rights back or threw it out. There is no conversation in any of that —
    # nobody is waiting for an answer and no flow can be started by it — so it
    # is filed to the chat registry and goes no further: no contact, no inbox
    # row, no trigger lookup. `record_membership` swallows its own failures,
    # because a webhook that raises is a webhook Telegram retries forever.
    if event.kind == "membership":
        return record_membership(bot, event.raw.get("my_chat_member") or {})

    # Telegram gives ten seconds to approve a charge, and an unanswered query
    # is a payment that fails with no explanation on either side. Nothing else
    # about this update matters until that answer is out.
    if event.kind == "pre_checkout":
        return _answer_pre_checkout(bot, event)

    contact, created = upsert_contact(bot, event)
    _handle_status_change(bot, event, contact)
    _store_shared_phone(event, contact)
    _acknowledge_callback(bot, event)

    # Filed before anything decides what to do about it, so that the messages
    # nothing claims are kept too — a question the bot did not understand is the
    # line an operator opens the Suhbatlar screen to read. `record_inbound` never
    # raises: a message that could not be filed must not cost the customer their
    # answer.
    record_inbound(
        contact,
        kind=event.kind,
        # A Mini App submission has no text of its own — the service message
        # carries a payload, not a sentence — so an operator reading Suhbatlar
        # sees the payload rather than an empty line.
        text=event.text or event.callback_data or event.web_app_payload,
        telegram_message_id=event.message_id,
        payload={
            "media": sorted(event.media),
            "callbackData": event.callback_data,
            "command": event.command,
            "payment": event.payment,
        },
    )

    counted = {"workspace": bot.workspace, "bot": bot, "contact": contact, "module_key": event.module_key}
    #
    # What this update is worth counting, *decided* here and *filed* below.
    #
    # It used to be filed here, and here nothing yet knows which flow is going
    # to answer — so every one of these rows was written with `flow=None` and
    # the Analytics screen listed the first message of a conversation the main
    # flow handled perfectly under «Oqimga bog'lanmagan». The reader's own
    # `/start`, attributed to nothing.
    #
    # The reading stays where it was, before `_rewrite_menu_button` rewrites a
    # menu tap into a command: a tap has to be counted as a click even though
    # what happens next is a command. Only the write moves.
    pending: list[dict] = []
    if created and contact:
        pending.append({"metric": "newContacts"})
    if event.kind == "callback":
        pending.append({"metric": "clicks"})
    if event.kind == "payment" and event.payment:
        # Telegram sends money in the smallest currency unit — except Stars,
        # which have no subunit, so seven stars arrive as `7` and not `700`.
        # Dividing those by 100 too recorded every Stars sale at a hundredth of
        # what it earned. The rule is `sender.build_call`'s, in reverse: the two
        # ends of one currency's arithmetic have to agree, so if one of them
        # changes the other has to follow.
        currency = event.payment.get("currency", "")
        raw = event.payment.get("total_amount") or 0
        amount = raw if currency == STARS_CURRENCY else raw / 100
        pending.append({"metric": "conversions"})
        pending.append({"metric": "revenue", "value": amount, "currency": currency})

    def file_counters(flow=None) -> None:
        """Writes what was decided above, against the flow that answered."""
        for row in pending:
            record_event(**counted, flow=flow, **row)

    # A menu tap is a command, not an exit from a graph — and it is rewritten
    # after the counters above so the tap is still counted as one.
    _rewrite_menu_button(event)

    # 1. An answer to something that is already waiting for one.
    if contact and not contact.is_blocked:
        waiting = _waiting_run(contact, event)
        port = _reply_port(waiting, event) if waiting else None
        if waiting is not None and port is not None:
            file_counters(waiting.flow)
            resume_with_reply(
                waiting,
                text=event.answer_text,
                port=port,
            )
            return {"handled": True, "reason": "resumed", "runId": waiting.id}

    # 2. A new conversation.
    trigger = find_trigger(bot, event)
    if trigger is None:
        # Nothing in this bot claims the update, and nothing answers it.
        #
        # There used to be a safety net here — an apology plus a menu, on the
        # argument that silence reads as a broken bot. It was configured from
        # one place, the bot's «Javoblar» settings, and that screen is gone: a
        # bot that talks to customers through a setting nobody can reach is
        # worse than one that says only what its flows say. The update is still
        # filed to Suhbatlar by `record_inbound` above, which is where an
        # operator reads the questions the flows did not cover.
        # Attributed to no flow, and that is the truth this time: nothing
        # claimed the update. This is the row «Oqimga bog'lanmagan» is for.
        file_counters()
        return {"handled": False, "reason": "no_trigger"}
    if contact and contact.is_blocked:
        file_counters(trigger.flow)
        return {"handled": False, "reason": "contact_blocked"}

    # Only a command clears the board. Typing something unrelated past a
    # keyboard starts a second conversation and leaves the first one tappable —
    # the row the customer was offered still has to work when they get to it.
    if contact and event.command:
        _close_superseded_runs(contact, event)

    file_counters(trigger.flow)

    # A business reply has to go back out on the same connection it arrived on,
    # so the id travels with the run rather than being looked up again later.
    run = start_run(
        flow=trigger.flow,
        contact=contact,
        event=event,
        entry_node_id=trigger.node_id,
        extra_context={"business_connection_id": event.business_connection_id} if event.is_business else None,
    )

    return {"handled": True, "reason": "started", "runId": run.id, "flowId": trigger.flow_id}
