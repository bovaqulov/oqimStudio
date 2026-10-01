"""The flow runtime: walking a graph on behalf of one contact.

The only walker there is. The editor's test chat drives this same code through
`/api/flows/<id>/test/`, so an author who tested a flow in the canvas has
actually tested the thing Telegram updates go through — a second
implementation in the browser was how a green test chat ended up sitting next
to a broken bot. A test run differs in exactly one way: it sends nothing to
Telegram and is left out of the numbers.

A run is durable. Two blocks park it — a question waits for an answer, a delay
waits for the clock — and both outlive the request that started them, which is
why every step commits before the next one begins.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

import requests
from django.db.models import F
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.analytics.services import record_event
from apps.bots import business as business_module
from apps.bots.models import BusinessConnection
from apps.common.i18n import LANGUAGE_VARIABLE, contact_language, normalise_language
from apps.contacts.models import ContactTag
from apps.flows.models import ENTRY_NODE_TYPES, Flow, FlowRun, FlowRunStep
from apps.inbox.services import record_outbound
from apps.notifications.services import warn_about_usage
from apps.realtime.broadcast import bot_group, buffered_publishing, flow_group, publish

from . import commands as script_commands
from . import studio as studio_api
from . import expressions, hooks
from apps.telegram.client import TelegramClient, TelegramError, client_for

from . import transitions
from .conditions import evaluate_condition
from .validation import check_answer
from .events import IncomingEvent, _read_command
from .sender import (
    BUTTON_PREFIX,
    LANGUAGE_PREFIX,
    STARS_CURRENCY,
    back_row_label,
    build_call,
    build_clear_markup_call,
    build_delete_call,
    build_keyboard,
    content_kind,
    effective_button_mode,
    missing_media,
    language_options,
    render_text,
    send_node,
)
from .safe_http import UnsafeUrlError, read_capped, safe_get

logger = logging.getLogger(__name__)

#: Guard against a graph that loops back on itself forever. The editor warns
#: about cycles; the runtime has to survive one that shipped anyway.
MAX_STEPS = 60

#: How far «Ma'lumot o'qish» scans for a matching row.
#:
#: A linear walk and not a database query, because the column lives inside a
#: JSON blob and there is no index on it — a filter would be the same scan with
#: the limit hidden. The cap is what keeps one badly aimed lookup from reading a
#: year of bookings while a customer waits for a reply.
MAX_TABLE_SCAN = 500

#: Blocks that only mark where a run began — they send nothing.
#:
#: The same set `flows.models.ENTRY_NODE_TYPES` is, and now literally so. Two
#: hand-written copies of six strings is one copy too many: an entry type
#: missing from here reaches `_handle_message` and its card explanation goes out
#: to the customer as a real message, while an ordinary block wrongly added to
#: it records a step and sends nothing at all.
PASSTHROUGH_TYPES = ENTRY_NODE_TYPES


#: `sendMediaGroup` accepts no `reply_markup` at all, so an album's buttons are
#: never rendered and can never be tapped.
BUTTONLESS_CONTENT = {"album"}


def node_buttons(node: dict) -> list[dict]:
    """The keyboard Telegram would actually render for this block.

    Read through `content_kind` rather than off `contentKind` directly, because
    the block's *type* can overrule what that field says — a menu converted out
    of an album Xabar still says "album" there, and reading it literally would
    send the keyboard and then decline to wait for the tap.
    """
    if content_kind(node) in BUTTONLESS_CONTENT:
        return []
    return node.get("buttons") or []


def routable_buttons(node: dict) -> list[dict]:
    """Buttons that continue the flow.

    On a *reply* keyboard every button does: Telegram sends its label back as
    an ordinary message, which is a branch of its own. On an *inline* keyboard
    only a callback button comes back at all — a URL or Web App button opens
    something and returns nothing to route on.

    Same rule as `isRoutableButton` in the editor; the ports the author drew on
    the card are exactly these.
    """
    buttons = node_buttons(node)
    if effective_button_mode(node) == "reply":
        return buttons
    return [button for button in buttons if button.get("kind", "callback") == "callback"]


def button_label(node: dict, port: str, context: dict[str, Any] | None = None) -> str:
    """What the row behind a `btn:` exit says, rendered for this run's language.

    The customer pressed a label; what arrives is a port. On an inline keyboard
    the port is *all* that arrives — `btn:b1` is the text of the update — so
    this is the only place the two can be put back together, and every place
    that shows the tap to a person (the trace an author reads, `{{xabar}}`, a
    «Teg» block copying what was said) needs the label rather than the wire's
    name for it.
    """
    wanted = port[len(BUTTON_PREFIX) :]
    for button in node_buttons(node):
        if str(button.get("id", "")) == wanted:
            return render_text(button.get("label", ""), context or {}).strip()
    return ""


def _step(run: FlowRun, node: dict, actor: str, text: str = "", payload: dict | None = None) -> FlowRunStep:
    """Records one executed block and pushes it to whoever is watching."""
    step = FlowRunStep.objects.create(
        run=run,
        node_id=node.get("id", ""),
        node_type=node.get("type", ""),
        actor=actor,
        text=text[:4000],
        payload=payload or {},
    )
    # The same line, in the conversation it belongs to. This is the one place a
    # flow's outgoing message is already written down, so it is the one place
    # that has to know about Suhbatlar — a hook further down, at the Bot API
    # call, would see a `chat_id` and not a contact.
    #
    # `actor == "bot"` only: what the customer sent was filed by `dispatch` when
    # it arrived, and filing it again here would double every answered question.
    # Test runs never reach a real chat, so they never reach a real thread.
    if actor == "bot" and not run.is_test and run.contact_id:
        record_outbound(
            run.contact,
            kind=step.node_type or "text",
            text=text,
            payload={"nodeId": step.node_id, "flowId": run.flow_id},
        )

    event = {
        "runId": run.id,
        "flowId": run.flow_id,
        "botId": run.bot_id,
        "nodeId": step.node_id,
        "nodeType": step.node_type,
        "actor": actor,
        "text": step.text,
        "at": step.created_at.isoformat(),
    }
    publish(flow_group(run.flow_id), "run.step", event)
    publish(bot_group(run.bot_id), "run.step", event)
    return step


def _fire(
    run: FlowRun, hook: str, *, node: dict | None = None, message: str = "", command: str = ""
) -> script_commands.Directive:
    """Runs one of the flow's own hooks and carries on with whatever it answered.

    Three moments call this — `start_run`, `resume_with_reply` and `_finish` —
    and everything they share lives here, so what a hook may write, what a
    failing one costs and what a missing one costs are one decision each rather
    than three that drift.

    A flow with no script leaves on the first line. Most flows have none, this
    sits on the path of every run, and the cheap way to write it — build the
    context, then ask whether anybody wants it — would put a dictionary and a
    regex behind every conversation the product has.

    What comes back is merged into the run's variables exactly as «Ma'lumotni
    saqlash» merges them, and `{{...}}` reads it back under the same names;
    `hooks.writable` is what refuses a key no placeholder could ever name.

    **Then the other half of the answer.** A hook can also ask for things to be
    done — a message sent, a tag set, a reminder armed — and those arrive as a
    list rather than as effects, because the sandbox they were written in has no
    socket and no database (`engine.commands`). Variables are merged *first* and
    the list is applied second, in that order and not the other one: a script
    that computes a total and then sends it has written the total into the
    context by the time `bot.send("{{jami}} so'm")` renders.

    What comes back from applying it is a `Directive` — where the conversation
    goes now — and it is *returned* rather than acted on. A hook fires outside
    `walk`, so the caller that is about to pick the next block is the one that
    can honour a `flow.goto` without reaching into the loop.

    Nothing here stops the conversation. A hook that throws is recorded the way
    a failed expression is — one system step naming the fault — and the walk
    carries on, because the customer waiting on the next message is not the
    person who can fix the script. A hook that threw asked for nothing: the
    command list is discarded with the process, which is why a script that sends
    three messages and then fails sends none of them.
    """
    # `run.flow.script` and not a query of its own: the flow is on the run and
    # every caller has already touched it.
    if not (run.flow.script or "").strip():
        return script_commands.Directive()

    try:
        outcome = hooks.call(
            hook,
            script=run.flow.script,
            library=getattr(run.flow.bot, "script_library", "") or "",
            ctx=hooks.context_for(run, node=node, message=message, command=command),
            # The flow's tenant rather than the run's. They are the same
            # workspace — see `_count_message` — and only this one is already in
            # memory, which matters because the slot is charged per hook.
            workspace_id=run.flow.workspace_id,
            # Named rather than left out. `studio.*` is closed inside a
            # conversation and a session that says so refuses with the sentence
            # `engine.studio` wrote for it — «faqat boshqaruv rejimida
            # ishlaydi» — instead of the generic "unknown request" a missing
            # session would produce. An author who used the wrong surface has
            # to be told which surface they need.
            studio=studio_api.Studio.for_flow(run.flow),
            # Whose key/value store `store.*` reads. The bot and not the
            # workspace: a bot is what a conversation belongs to, and two bots
            # in one company keeping one queue number between them is the bug
            # that shape would ship with.
            bot_id=run.bot_id,
        )
    except Exception:  # noqa: BLE001 - a hook must not end the run it fires in
        # Not the script failing: `hooks.call` answers that with an outcome.
        # This is the sandbox, the compose or this module going wrong, and one
        # of the callers is `_finish` — a raise from there would turn a run that
        # had just ended into a crashed worker, with the run marked finished in
        # the database and nobody told why the rest never happened.
        logger.exception("flow %s hook %s crashed", run.flow_id, hook)
        return script_commands.Directive()

    # `None` is the file not declaring this hook: no process was started, and a
    # flow with no `onFlowEnd` is not a flow whose `onFlowEnd` failed.
    if outcome is None:
        return script_commands.Directive()

    if not outcome.ok:
        logger.warning("flow %s hook %s: %s", run.flow_id, hook, outcome.error)
        # `node or {}` because `onFlowEnd` has no block to point at — the run is
        # over — and a step with an empty node id is what the trace already
        # shows for anything the runtime says on its own behalf.
        _step(run, node or {}, "system", outcome.error, {"error": outcome.error, "kind": "hook", "hook": hook})
        return script_commands.Directive()

    if outcome.written:
        run.context.update(outcome.written)
        run.save(update_fields=["context"])

    if not outcome.commands:
        return script_commands.Directive()
    try:
        return script_commands.apply(run, outcome.commands, hook=hook, node=node)
    except Exception:  # noqa: BLE001 - same rule as the hook above, one level down
        # `commands.apply` catches each command on its own; this is the module
        # itself going wrong, and `_finish` is one of the callers.
        logger.exception("flow %s hook %s commands crashed", run.flow_id, hook)
        return script_commands.Directive()


def _finish(run: FlowRun, status: str, error: str = "") -> FlowRun:
    run.status = status
    run.error = error[:280]
    run.finished_at = timezone.now()
    run.current_node_id = ""
    run.save(update_fields=["status", "error", "finished_at", "current_node_id"])
    publish(flow_group(run.flow_id), "run.finished", {"runId": run.id, "status": status, "error": run.error})

    # `onFlowEnd`, once, after the run is already written down.
    #
    # After rather than before because a hook is the author's code on a Telegram
    # webhook's clock: a worker killed inside one has to leave a finished run
    # behind it and not a running one that nothing will ever wake.
    #
    # The flag is a plain attribute on the run object, the way `incoming_edge`
    # is, and it is set *before* the hook rather than after. `_finish` is
    # reached from six places and one of them is `walk`'s own `except` — so a
    # hook path that raised inside `_handle_end` would land back here and fire
    # itself a second time. `_fire` swallows that raise as well; between them a
    # run that ends fires this exactly once, whatever the author's script does.
    if not getattr(run, "flow_end_fired", False):
        run.flow_end_fired = True
        _fire(run, "onFlowEnd")
    return run


#: `_finish` under a name another module is allowed to say.
#:
#: `dispatch._close_superseded_runs` is the one ending that does not come from
#: walking a graph — the customer typed a new command and left a parked run
#: behind — and it used to write the four columns itself. That made it the only
#: ending in the product that published nothing and fired no hook. Exported
#: rather than un-underscored so the fifteen call sites in this file keep
#: reading as internal, which is what they are.
finish = _finish


def _park(run: FlowRun, node_id: str, status: str, resume_at=None) -> FlowRun:
    run.status = status
    run.current_node_id = node_id
    run.resume_at = resume_at
    run.save(update_fields=["status", "current_node_id", "resume_at"])
    publish(flow_group(run.flow_id), "run.parked", {"runId": run.id, "status": status, "nodeId": node_id})
    return run


def _hook_route(run: FlowRun, directive, node_id: str) -> tuple[FlowRun | None, str]:
    """What a script's `flow.*` means for the walk that has not started yet.

    Answered here rather than inside `walk`, and that is the whole reason the
    directive is a return value: the three hooks all fire *outside* the loop —
    before the first block, before a parked block acts on a reply, after the
    run is written down — so the caller about to choose a block is the one that
    can be told a different one. Nothing reaches into the loop and the loop
    learns nothing about scripts.

    `(settled, target)`: a run means the conversation is already decided and the
    caller should hand it straight back; a target is the block to walk from, and
    an empty one means the script asked for nothing this caller has to honour.
    """
    op = getattr(directive, "op", "")
    if not op:
        return None, ""

    if op == script_commands.HANDOFF:
        return _park(run, node_id or run.current_node_id, FlowRun.Status.HANDOFF), ""

    if op == script_commands.END:
        return _finish(run, FlowRun.Status.DONE), ""

    if op == script_commands.STOP:
        # The one ending that is not one. The blocks after this do not run, and
        # the conversation is *not* closed: the run parks where it stands, so
        # the customer's next message meets `dispatch` the way it would have
        # anyway — a tap on a keyboard this block sent continues it, and
        # anything else starts a new conversation and supersedes this one,
        # firing `onFlowEnd` on the way past. A `_finish` here would have said
        # "this is over" to a script that deliberately did not say so.
        return _park(run, node_id or run.current_node_id, FlowRun.Status.WAITING), ""

    if op == script_commands.GOTO:
        if run.flow.node(directive.node_id) is None:
            _step(run, {}, "system", f"Skript «{directive.node_id}» blokini topa olmadi")
            return None, ""
        return None, directive.node_id

    if op == script_commands.RESTART:
        entries = run.flow.entry_nodes()
        if not entries:
            _step(run, {}, "system", "Oqimda boshlanish bloki yo'q — qayta boshlanmadi")
            return None, ""
        return None, entries[0]["id"]

    if op == script_commands.CALL:
        target = Flow.objects.filter(pk=directive.flow_id, bot=run.bot).first()
        entry = ""
        if target is not None:
            entry = directive.node_id or (target.entry_nodes()[0]["id"] if target.entry_nodes() else "")
        if target is None or not entry:
            # Named a flow this bot does not own, or one with nowhere to start.
            # Said out loud and walked past, the way `_handle_flowlink` walks
            # past a target that has gone: a conversation that stops dead
            # because somebody deleted a flow last week is worse than one that
            # carries on where it was.
            _step(run, {}, "system", f"Skript «{directive.flow_id}» oqimini ocha olmadi")
            return None, ""
        _finish(run, FlowRun.Status.DONE)
        return start_run(flow=target, contact=run.contact, entry_node_id=entry, is_test=run.is_test), ""

    return None, ""


def start_run(
    *,
    flow: Flow,
    contact=None,
    event: IncomingEvent | None = None,
    entry_node_id: str,
    is_test: bool = False,
    extra_context: dict[str, Any] | None = None,
) -> FlowRun:
    """Opens a run at `entry_node_id` and walks it as far as it will go."""
    context = _initial_context(flow.bot, contact, event)
    # Merged before the first block runs: a business reply has to carry its
    # connection id on the very first send, not from the second one onwards.
    context.update(extra_context or {})
    run = FlowRun.objects.create(
        workspace=flow.workspace,
        flow=flow,
        bot=flow.bot,
        contact=contact,
        current_node_id=entry_node_id,
        is_test=is_test,
        context=context,
    )
    # Test runs are left out of it, the same way they are left out of
    # `record_event` below. This is the number the flow list prints as "N marta
    # ishga tushdi", and counting the author's own rehearsals in it made a flow
    # nobody had used yet look busy: one real conversation and sixteen presses
    # of «Sinash» read as seventeen customers.
    if not is_test:
        Flow.objects.filter(pk=flow.pk).update(runs=F("runs") + 1)
        record_event(flow=flow, contact=contact, metric="conversations")
    publish(
        flow_group(flow.id),
        "run.started",
        {"runId": run.id, "flowId": flow.id, "contactId": contact.id if contact else None, "isTest": is_test},
    )
    # The flow's own `onFlowStart`, between the run existing and the first block
    # running. Here and not inside `walk` because what the hook writes has to be
    # in the context before anything renders — a greeting that says
    # `{{savat}}` is the whole reason an author writes one — and because `walk`
    # is also where a parked run resumes, which is not a start.
    directive = _fire(run, "onFlowStart", node=flow.node(entry_node_id))
    settled, target = _hook_route(run, directive, entry_node_id)
    if settled is not None:
        return settled
    return walk(run, target or entry_node_id)


def _initial_context(bot, contact, event: IncomingEvent | None) -> dict[str, Any]:
    """What `{{...}}` can read.

    The names are the ones the editor's variable menu inserts — the dotted Bot
    API paths in `frontend/src/features/flow-builder/lib/variables.ts`. A
    runtime that invented its own names would render every placeholder an
    author picked from that menu as literal braces.

    A handful of plain keys sit alongside them: the two the intake template
    writes (`mijoz_ismi`, `mijoz_telefoni`), and the internal ones the runtime
    itself reads — `chat_id` (where this run answers) and
    `business_connection_id` (which account it answers on).
    """
    context: dict[str, Any] = {
        "bot.id": bot.telegram_id or "",
        "bot.username": f"@{bot.username}" if bot.username else "",
    }

    if contact:
        context.update(
            {
                "user.id": contact.telegram_user_id,
                "user.first_name": contact.first_name,
                "user.last_name": contact.last_name,
                "user.username": f"@{contact.username}" if contact.username else "",
                "mijoz_ismi": contact.first_name or contact.display_name,
                "mijoz_telefoni": contact.phone,
                "chat_id": contact.chat_id,
            }
        )
        # Whatever a "Teg / o'zgaruvchi" block or a question wrote earlier, and
        # last: a value collected from this person outranks a default.
        context.update(contact.variables or {})

    # Which language this run speaks, read once and carried with it — every
    # string that reaches the customer is resolved against it (see
    # `sender.render_text`). After the contact's variables on purpose:
    # `contact_language` reads `mijoz_tili` out of them, and a language the
    # customer picked for themselves is the one thing allowed to overrule the
    # guess their phone's `language_code` makes.
    context["language"] = contact_language(contact, bot) if contact else bot.main_language
    #: What a block with no text in the chosen language falls back to.
    context["language_fallback"] = bot.main_language

    if event:
        # The run, not the contact, remembers where this conversation is
        # happening: the same person can be answered in a group now and in
        # their private chat an hour later.
        context.update(
            {
                "chat.id": event.reply_to,
                "chat.type": event.chat_type,
                "chat.title": event.chat_title,
                "message.text": event.text,
                "message.id": event.message_id,
                "message.date": timezone.now().strftime("%d.%m.%Y %H:%M"),
                "business.connection_id": event.business_connection_id,
                "chat_id": event.reply_to,
                "buyruq": event.command,
                "media_type": next(iter(sorted(event.media)), ""),
            }
        )
    return context


def _resolve_expressions(run: FlowRun, node: dict) -> None:
    """Works out this block's `{{ funksiya(...) }}` values before anything reads them.

    Here, at the top of the block, rather than inside the renderer: one block is
    one batch, and every renderer that runs afterwards — the step text, the Bot
    API payload, the keyboard's labels — reads the same answers instead of
    starting the sandbox again for each of them.

    A block with no expressions never reaches the sandbox at all, which is what
    keeps every flow written before this feature exactly as fast as it was.

    Failures are recorded and walked past. The block still sends its own text
    with a gap where the value would have been, because the alternative is a
    customer sitting in silence over a script only its author can fix.
    """
    library = getattr(run.flow.bot, "script_library", "") or ""
    problems = expressions.resolve_into(
        run.context,
        node,
        library=library,
        workspace_id=run.flow.workspace_id,
    )
    for problem in problems:
        logger.warning("flow %s node %s expression: %s", run.flow_id, node.get("id"), problem)
        _step(run, node, "system", problem, {"error": problem, "kind": "expression"})


def walk(run: FlowRun, node_id: str | None, incoming_edge: dict | None = None) -> FlowRun:
    """Executes blocks from `node_id` until the run parks or ends.

    `incoming_edge` is the connection this walk starts on, which only a caller
    resuming a parked run can know. It is handed to each block through
    `run.incoming_edge` — a plain attribute, never a column — because what the
    connection now says is what happens to the message already on screen, and
    only `_deliver` at the far end of the call chain needs it. Threading it
    through fifteen handler signatures, all but six of which never deliver
    anything, would have been the alternative.
    """
    flow = run.flow
    steps = 0
    edge = incoming_edge

    while node_id and steps < MAX_STEPS:
        steps += 1
        node = flow.node(node_id)
        if node is None:
            return _finish(run, FlowRun.Status.FAILED, f"Blok topilmadi: {node_id}")

        run.incoming_edge = edge
        _resolve_expressions(run, node)
        try:
            outcome, port = execute(run, node)
        except TelegramError as exc:
            # A blocked bot is not an error in the flow — it is the end of this
            # conversation, and the contact is marked so nothing else is sent.
            if exc.is_blocked and run.contact_id:
                run.contact.is_blocked = True
                run.contact.save(update_fields=["is_blocked"])
                return _finish(run, FlowRun.Status.DONE, "Foydalanuvchi botni bloklagan")
            logger.warning("flow %s node %s failed: %s", flow.id, node_id, exc)
            _step(run, node, "system", f"Xato: {exc.message}", {"error": exc.message})
            return _finish(run, FlowRun.Status.FAILED, exc.message)
        except Exception as exc:  # noqa: BLE001 - one bad block must not kill the worker
            logger.exception("flow %s node %s crashed", flow.id, node_id)
            _step(run, node, "system", f"Xato: {exc}", {"error": str(exc)})
            return _finish(run, FlowRun.Status.FAILED, str(exc))

        if outcome != "continue":
            return run
        edge = flow.edge(node["id"], port)
        node_id = edge.get("to") if edge else None

    if steps >= MAX_STEPS:
        return _finish(run, FlowRun.Status.FAILED, "Juda ko'p qadam — oqimda tsikl bo'lishi mumkin")

    # Walked off the end of the graph. Anything that parked or stopped returned
    # above. A flow ends where its author drew the end of it and the bot says
    # nothing further — the after-flow menu that used to follow every ending was
    # part of the «Javoblar» settings, which are gone.
    return _finish(run, FlowRun.Status.DONE)


def execute(run: FlowRun, node: dict) -> tuple[str, str]:
    """Runs one block. Returns (outcome, port) where outcome is continue/park/stop.

    A type nothing here knows is stepped over, not sent.

    It used to fall back to `_handle_message`, which delivers the block's own
    `text` to the customer — so a block type added to the editor and forgotten
    here mailed its internal label out as a real message ("Suhbat shu blokda
    tugaydi" was one press away from a paying customer). Graphs arrive from
    templates and the API as well as from this editor, and `flows.serializers`
    passes `nodes` through unvalidated by design, so there is no upstream gate
    that would have caught it either.

    Stepping over keeps the forward compatibility that fallback was reaching
    for — an older deployment handed a newer graph still walks it — without
    saying anything to the customer on the way past.
    """
    node_type = node.get("type", "")
    handler = _HANDLERS.get(node_type)
    if handler is None:
        logger.warning("unknown block type %r in flow %s — stepped over", node_type, run.flow_id)
        _step(run, node, "system", f"Noma'lum blok turi «{node_type}» — o'tkazib yuborildi")
        return "continue", "out"
    return handler(run, node)


# ---------------------------------------------------------------------------
# Block handlers
# ---------------------------------------------------------------------------


def _client(run: FlowRun) -> TelegramClient:
    return client_for(run.bot)


def _chat_id(run: FlowRun) -> int | str | None:
    """Where this run answers. The run's own context wins over the contact's
    last-known chat — see `_initial_context`."""
    return run.context.get("chat_id") or (run.contact.chat_id if run.contact_id else None)


def _handle_entry(run: FlowRun, node: dict) -> tuple[str, str]:
    _step(run, node, "system", node.get("title", "") or "Ishga tushdi")
    return "continue", "out"


#: Where the run remembers the message currently on screen.
#:
#: Reserved names, in the shape `_reject_answer`'s `_attempts:` already uses: the
#: context doubles as the `{{...}}` namespace an author writes into, so anything
#: the runtime keeps there has to be un-typeable by accident.
#:
#: Three facts and not one, because all three are needed to decide whether the
#: *next* block can replace this one: which message to address, what kind of
#: message it is (`editMessageText` cannot touch a photo), and whether it has an
#: inline keyboard to take away.
SCREEN_MESSAGE_ID = "_screen_message_id"
SCREEN_KIND = "_screen_kind"
SCREEN_INLINE = "_screen_inline"
#: When the message went out, ISO-8601. Only `delete` reads it, and only because
#: Telegram will not take back anything older than 48 hours. Deliberately *not*
#: refreshed by an edit: the clock runs from the original send, so a screen
#: rewritten forty times is still as old as its first version.
SCREEN_SENT_AT = "_screen_sent_at"

#: Telegram's word for "the message already says exactly this".
#:
#: It arrives as a 400, which is how a refusal arrives, and it is not one: the
#: screen is already correct and there is nothing left to do. A subscription
#: gate re-checked without joining anything hits it every time.
_UNCHANGED = "message is not modified"


def _screen(run: FlowRun) -> tuple[int | None, str, bool]:
    """The message on screen, as the transition matrix wants to hear about it."""
    raw = run.context.get(SCREEN_MESSAGE_ID)
    message_id = raw if isinstance(raw, int) else None
    return message_id, str(run.context.get(SCREEN_KIND) or ""), bool(run.context.get(SCREEN_INLINE))


def _within_delete_window(run: FlowRun) -> bool:
    """Whether Telegram would still let the screen be taken back.

    Checked before the call rather than after the refusal for the delayed case:
    queueing a task that is already doomed costs a worker slot and reports
    nothing to anyone. An unreadable or missing timestamp answers yes — the call
    itself is the authority, and stepping down on a bad clock reading would
    refuse a delete that would have worked.
    """
    stamp = parse_datetime(str(run.context.get(SCREEN_SENT_AT) or ""))
    if stamp is None:
        return True
    return timezone.now() - stamp < timedelta(hours=transitions.DELETE_WINDOW_HOURS)


def _record_screen(run: FlowRun, node: dict, result: Any, message_id: int | None = None) -> None:
    """Remembers what is now on screen, or forgets when nothing addressable is.

    `message_id` is passed in only after an edit, where the id is the one that
    was already there rather than anything the answer carries.

    An album forgets deliberately: `sendMediaGroup` answers with a *list* of
    messages, so there is no single message for a later block to replace, and a
    pointer at one of several would edit an arbitrary third of a gallery.
    """
    edited = message_id is not None
    if message_id is None:
        message_id = result.get("message_id") if isinstance(result, dict) else None
    if not isinstance(message_id, int):
        for key in (SCREEN_MESSAGE_ID, SCREEN_KIND, SCREEN_INLINE, SCREEN_SENT_AT):
            run.context.pop(key, None)
    else:
        run.context[SCREEN_MESSAGE_ID] = message_id
        run.context[SCREEN_KIND] = content_kind(node)
        run.context[SCREEN_INLINE] = bool((build_keyboard(node, run.context) or {}).get("inline_keyboard"))
        # An edit does not restart the delete clock — see [[SCREEN_SENT_AT]].
        if not edited:
            run.context[SCREEN_SENT_AT] = timezone.now().isoformat()
    run.save(update_fields=["context"])


def _may_reply_on(run: FlowRun, connection_id: str) -> bool:
    """Whether this bot still holds `can_reply` on the account it is answering on.

    Read per delivery rather than cached on the run: `business_connection`
    arrives again whenever the owner edits the connection, so a right taken
    away mid-conversation is a thing that happens between two blocks of one
    flow. An unknown connection reads as allowed — the row is written by
    `dispatch._store_business_connection` and a message that arrived without
    one is a shape this cannot judge, so it is left to Telegram.
    """
    row = BusinessConnection.objects.filter(connection_id=connection_id).first()
    if row is None:
        return True
    return row.is_enabled and business_module.granted(row, business_module.REPLY_RIGHT)


def _deliver(run: FlowRun, node: dict) -> dict:
    """Sends the block — or, for a test run, renders exactly what it would send.

    A test started from the editor must never reach a real chat, and it must
    still show the author the message they are testing. Both come from building
    the Bot API payload either way and only handing it to Telegram when the run
    is a real one.

    What the connection into this block asked for is attempted first, and every
    way it can fail steps one rung down `transitions.LADDER` rather than
    stopping. The floor of that ladder is an ordinary send, which is what this
    function did before there was a ladder — so the worst outcome of the whole
    feature is the behaviour it replaced, and never silence. That is the single
    property worth protecting here: a customer who taps a button and gets
    nothing back cannot tell a bug from a dead bot.
    """
    chat_id = _chat_id(run)
    business = run.context.get("business_connection_id", "")
    token = _provider_token(run, node)

    if business and not run.is_test and not _may_reply_on(run, business):
        # The account owner connected the bot and withheld `can_reply`.
        #
        # Telegram's own words for the right (`core.telegram.org/bots/features`,
        # "Business Bots"): "The Business Bot rights control actions such as
        # replying (`can_reply`)…", and "The account owner can specify which
        # chats your bot can access". So this is not our setting to change and
        # not a fault in the flow — it is a permission somebody deliberately did
        # not grant.
        #
        # Refused here rather than at the socket because the failure is worth a
        # sentence. Sending anyway gets a Bot API error whose text names no
        # account and no right, the run ends FAILED, and the author reads
        # "Telegram xatosi" on a flow that is correct. `bots.business_problems`
        # already prints the same finding on the bot's own screen; this makes
        # the trace agree with it.
        #
        # Raised rather than finished in place. This function has nine callers
        # and every one of them writes the block's «bot» step out of what it
        # returns, so a run finished behind their backs was finished and then
        # walked on: the step said the bot had spoken, the next block ran, and
        # `walk` fell off the end of the graph into `_finish(DONE)` — which
        # wrote over both the status and the sentence this guard exists to
        # leave. The trace then read DONE with no error, which is the exact
        # outcome the comment above says it is here to prevent.
        #
        # `TelegramError` and not a sentinel because `walk` already turns a
        # refused call into precisely the wanted outcome — a system step
        # carrying the reason, then FAILED — and this *is* a refused call. The
        # only difference from the socket's version is that it was legible one
        # step earlier, which is the whole point. The method named is the call
        # that was not made, so the log line says which one.
        method, _ = build_call(node, chat_id or 0, run.context, business, token)
        raise TelegramError(method, business_module.CANNOT_REPLY)
    # A block that carries no file cannot be sent, and a test run is where that
    # has to be said: nothing goes to Telegram there, so an unfinished media
    # block used to come back as an ordinary caption bubble and the trace ended
    # "Suhbat yakunlandi" — the editor reporting a working conversation for a
    # block the Bot API would refuse. Raised the same way the business-rights
    # refusal above is, so `walk` writes the reason as a system step and marks
    # the run FAILED, which is what actually happens in a real chat.
    unsendable = missing_media(node)
    if unsendable:
        method, _ = build_call(node, chat_id or 0, run.context, business, token)
        raise TelegramError(method, unsendable)

    screen_id, screen_kind, screen_inline = _screen(run)
    wanted = transitions.resolve(getattr(run, "incoming_edge", None), node, screen_inline)

    if run.is_test or chat_id is None:
        method, payload = build_call(node, chat_id or 0, run.context, business, token)
        return {"method": method, "payload": payload, "preview": True, "transition": wanted}

    client = _client(run)
    # Nothing on screen to keep, clear or rewrite — the first block of a run,
    # or one whose predecessor was an album. Every transition means the same
    # thing then, and it is the cheapest one.
    if screen_id is None:
        wanted = transitions.KEEP

    if wanted == transitions.DELETE and screen_id is not None:
        delay = transitions.delete_delay(getattr(run, "incoming_edge", None))
        if not _within_delete_window(run):
            logger.info("run %s: screen is past the 48h delete window, stepping down", run.id)
            wanted = transitions.FALLBACK[transitions.DELETE]
        elif delay:
            # Held back: the replacement goes out first and the old message is
            # taken away behind it, which is the only reason to want a delay —
            # it leaves the reader time to finish what is being replaced.
            from .tasks import delete_message  # local: tasks imports this module

            sent = send_node(client, node, chat_id, run.context, business, token)
            delete_message.apply_async(args=[run.bot_id, chat_id, screen_id], countdown=delay)
            _record_screen(run, node, sent.get("result"))
            return {**sent, "transition": transitions.DELETE, "deleteAfterSeconds": delay}
        else:
            # Immediate: gone before the replacement arrives, so the reader
            # never sees the two of them stacked.
            method, payload = build_delete_call(chat_id, screen_id)
            try:
                client.call(method, payload)
            except TelegramError as exc:
                if exc.is_blocked:
                    raise
                logger.info("delete refused for run %s, stepping down: %s", run.id, exc.message)
                wanted = transitions.FALLBACK[transitions.DELETE]
            else:
                sent = send_node(client, node, chat_id, run.context, business, token)
                _record_screen(run, node, sent.get("result"))
                return {**sent, "transition": transitions.DELETE}

    if wanted == transitions.EDIT:
        if transitions.can_edit(screen_kind, content_kind(node)) and transitions.accepts_inline_keyboard(node):
            method, payload = build_call(node, chat_id, run.context, business, token, edit_message_id=screen_id)
            try:
                result = client.call(method, payload)
            except TelegramError as exc:
                # A block is the end of the conversation, not a rung: `walk`
                # marks the contact and stops, and retrying the send below
                # would only earn the same 403.
                if exc.is_blocked:
                    raise
                if _UNCHANGED in exc.message.lower():
                    return {"method": method, "payload": payload, "result": True, "transition": transitions.EDIT}
                logger.info("edit refused for run %s, stepping down: %s", run.id, exc.message)
                wanted = transitions.FALLBACK[transitions.EDIT]
            else:
                _record_screen(run, node, result, message_id=screen_id)
                return {"method": method, "payload": payload, "result": result, "transition": transitions.EDIT}
        else:
            wanted = transitions.FALLBACK[transitions.EDIT]

    if wanted == transitions.CLEAR_BUTTONS and screen_inline and screen_id is not None:
        method, payload = build_clear_markup_call(chat_id, screen_id, business)
        try:
            client.call(method, payload)
        except TelegramError as exc:
            if exc.is_blocked:
                raise
            # Cosmetic on its own: the message below still goes out, and the
            # only loss is that an old keyboard stays tappable.
            logger.info("could not clear the old keyboard for run %s: %s", run.id, exc.message)

    sent = send_node(client, node, chat_id, run.context, business, token)
    _record_screen(run, node, sent.get("result"))
    return {**sent, "transition": wanted}


def _provider_token(run: FlowRun, node: dict) -> str:
    """The merchant token an invoice block bills through.

    Stars need none, and the block names the provider it was configured with —
    so the lookup is by that id rather than "whatever is connected", which
    would silently charge through the wrong account when a bot has two.
    """
    if content_kind(node) != "invoice":
        return ""
    invoice = node.get("invoice") or {}
    if (invoice.get("currency") or "") == STARS_CURRENCY:
        return ""
    connections = run.bot.payment_connections.all()
    wanted = invoice.get("providerId") or ""
    for connection in connections:
        if connection.provider_id == wanted and connection.token:
            return connection.token
    # No provider named, or the one named is gone: the single connected
    # provider is the only unambiguous answer, and none is better than a guess.
    usable = [connection for connection in connections if connection.token]
    return usable[0].token if len(usable) == 1 else ""


def _count_message(run: FlowRun) -> None:
    """One message the bot sent, counted — and the plan's ceiling watched.

    The counting was nine identical lines scattered through the handlers below,
    which was fine while counting was all that happened. It is not any more:
    `messages` is the one declared limit this product deliberately never
    refuses on (`apps.billing.services`, and the note in `apps.billing.tests`
    beside it), so the only thing standing between an overrun and nobody
    knowing is a warning — and a warning needs somewhere to be raised from.
    Nine places is nowhere.

    Nothing here can refuse and nothing here can raise. The send already
    happened; by the time this line runs the customer has the message, and the
    only question left is whether anyone is told. `warn_about_usage` swallows
    its own failures and throttles its own cost for exactly that reason.
    """
    record_event(flow=run.flow, contact=run.contact, metric="messages")
    # `run.flow.workspace` and not `run.workspace`. They are the same tenant —
    # a run is created with its flow's — and only one of them is already in
    # memory: `record_event` above resolves the workspace out of the flow, so
    # reading it here costs nothing, while `run.workspace` would be a second
    # SELECT behind every message the product sends.
    warn_about_usage(run.flow.workspace, "messages")


def _handle_message(run: FlowRun, node: dict) -> tuple[str, str]:
    sent = _deliver(run, node)
    _step(run, node, "bot", render_text(node.get("text", ""), run.context), sent)
    if not run.is_test:
        _count_message(run)

    # An invoice parks whether or not it has buttons of its own: what it is
    # waiting for is the payment, and that leaves through "paid".
    if content_kind(node) == "invoice":
        _park(run, node["id"], FlowRun.Status.WAITING)
        return "park", ""

    # A keyboard parks the run: the next thing that happens is a tap, and the
    # edge it leaves through is the button's own. The back row counts as one of
    # those taps even though it is not one of the author's buttons — a block
    # whose only row is «Orqaga» sent the row and walked straight on, so the
    # tap landed on a finished run and fell to the fallback.
    #
    # An album is the exception that has to be spelled out: `sendMediaGroup`
    # takes no `reply_markup` at all, so nothing on it can be tapped.
    # `routable_buttons` already reads the content kind and answers with an
    # empty list; the back row is asked for separately, and parking on a row
    # that was never sent left the block after the album unreachable.
    keyboarded = content_kind(node) not in BUTTONLESS_CONTENT
    if routable_buttons(node) or (keyboarded and back_row_label(node, run.context)):
        _park(run, node["id"], FlowRun.Status.WAITING)
        return "park", ""
    return "continue", "out"


def _handle_question(run: FlowRun, node: dict) -> tuple[str, str]:
    _step(run, node, "bot", render_text(node.get("text", ""), run.context), _deliver(run, node))
    if not run.is_test:
        _count_message(run)
    _park(run, node["id"], FlowRun.Status.WAITING)
    return "park", ""


def _handle_condition(run: FlowRun, node: dict) -> tuple[str, str]:
    result = evaluate_condition(node.get("condition") or {}, run)
    verdict = "ha" if result else "yo'q"
    _step(run, node, "system", f"Shart: {verdict}", {"result": result})
    return "continue", "yes" if result else "no"


def _handle_delay(run: FlowRun, node: dict) -> tuple[str, str]:
    from .tasks import resume_run  # local: tasks imports this module

    minutes = int(node.get("minutes") or 0)
    resume_at = timezone.now() + timedelta(minutes=minutes)
    _step(run, node, "system", f"{minutes} daqiqa kutilmoqda")
    _park(run, node["id"], FlowRun.Status.SLEEPING, resume_at=resume_at)
    try:
        # Countdown rather than eta: a worker whose clock differs from the web
        # process still waits the interval the author asked for.
        resume_run.apply_async(args=[run.id], countdown=max(minutes, 0) * 60)
    except Exception:  # noqa: BLE001 - a broker hiccup must not strand the run
        # The run is already parked with `resume_at`, so `resume_due_runs`
        # picks it up on its next sweep. Failing here instead would mark a
        # perfectly good conversation as failed and never continue it.
        logger.warning("could not schedule wake-up for run %s", run.id, exc_info=True)
    return "park", ""


def _handle_tag(run: FlowRun, node: dict) -> tuple[str, str]:
    action = node.get("tagAction") or "add"
    name = node.get("tagName") or ""
    contact = run.contact

    if not name:
        _step(run, node, "system", "Teg nomi ko'rsatilmagan")
        return "continue", "out"

    if action == "set_variable":
        # The run always learns the value, contact or no contact: a test run has
        # nobody attached, and skipping this is why its messages used to come
        # out with `{{mijoz_ismi}}` still in them while the real bot was fine.
        value = render_text(node.get("tagValue", ""), run.context)
        run.context[name] = value
        run.save(update_fields=["context"])
        if contact:
            contact.set_variable(name, value)
        _step(run, node, "system", f"{name} = {value}")
        return "continue", "out"

    # Tags are a fact about a person, so they need one.
    if contact:
        if action == "add":
            ContactTag.objects.get_or_create(contact=contact, name=name, defaults={"added_by_flow_id": run.flow_id})
        else:
            ContactTag.objects.filter(contact=contact, name=name).delete()

    _step(run, node, "system", f"{action}: {name}")
    return "continue", "out"


#: Member statuses that count as subscribed. "left" and "kicked" plainly do
#: not, and neither does "restricted": Telegram uses it both for a member who
#: has been silenced and for one who is no longer in the chat at all, and the
#: two are told apart by a flag that is absent as often as it is present.
SUBSCRIBED_STATUSES = {"creator", "administrator", "member"}


def _handle_language(run: FlowRun, node: dict) -> tuple[str, str]:
    """Asks which language to answer in, and waits for the tap.

    The bot's own list has the last word over the block's (see
    `sender.language_options`), and the bot is only reachable from here - which
    is why the narrowing happens on the way to the send rather than inside the
    keyboard builder, which is handed a block and never a bot.
    """
    enabled = run.bot.languages.get("enabled") or [run.bot.main_language]
    return _handle_question(run, {**node, "language": {"options": language_options(node, enabled)}})


def _handle_followup(run: FlowRun, node: dict) -> tuple[str, str]:
    """Arms a reminder and walks straight on.

    That is the whole block, and the whole difference from Kutish: nothing is
    parked, so the rest of the flow runs now and the message only goes out
    later - and only if the customer has said nothing in the meantime. A flow
    that had to stand still for an hour to be able to nudge somebody could
    never nudge them about the thing it was going to say next.
    """
    from .tasks import send_followup

    minutes = max(int(node.get("minutes") or 0), 0)
    # The watermark the reminder is judged against: anything this person does
    # after this instant is a reply, and a reply calls the reminder off.
    armed_at = timezone.now()
    _step(
        run,
        node,
        "system",
        f"{minutes} daqiqadan keyin eslatma",
        {"minutes": minutes, "armedAt": armed_at.isoformat()},
    )
    if run.is_test:
        # A test run has nobody to remind, and showing that the reminder was
        # armed is the whole of what the editor can honestly show.
        return "continue", "out"

    try:
        send_followup.apply_async(args=[run.id, node["id"], armed_at.isoformat()], countdown=minutes * 60)
    except Exception:  # noqa: BLE001 - a broker hiccup must not fail the conversation
        # Unlike Kutish there is no parked run for a sweep to find later, so a
        # reminder lost here is lost. The conversation itself is untouched,
        # which is exactly why this must not be raised.
        logger.warning("could not schedule follow-up for run %s", run.id, exc_info=True)
        _step(run, node, "system", "Eslatmani rejalashtirib bo'lmadi")
    return "continue", "out"


def deliver_followup(run: FlowRun, node_id: str, armed_at: datetime | None) -> str:
    """Sends a reminder, unless the customer has been in touch since it was armed.

    Nothing here waits on the run: the flow moved on the moment the block was
    reached and by now may well have finished. What decides whether the message
    goes out is the person - `last_seen_at` moves on every update they send, a
    typed message and a tapped button alike, so somebody who has been in touch
    has answered, whether or not they answered *this*.
    """
    node = run.flow.node(node_id) or _reminder_node(run, node_id)
    if node is None:
        # A script's reminder that has been cancelled, or replaced by a later
        # one with the same key, arrives here as well — nothing is wrong and
        # nothing is worth a line in the trace, which is why the two are told
        # apart before the sentence about a missing block is reached.
        return "cancelled" if node_id.startswith(script_commands.QUEUE_NODE_PREFIX) else "missing_node"
    contact = run.contact if run.contact_id else None
    if contact is None or contact.is_blocked:
        return "no_contact"
    if armed_at and contact.last_seen_at and contact.last_seen_at > armed_at:
        _step(run, node, "system", "Mijoz javob berdi - eslatma yuborilmadi")
        return "answered"

    text = render_text(node.get("text", ""), run.context)
    if not text.strip():
        return "empty"
    chat_id = _chat_id(run)
    if chat_id is None:
        return "no_chat"

    try:
        sent = send_node(
            _client(run), node, chat_id, run.context, run.context.get("business_connection_id", "") or ""
        )
    except TelegramError as exc:
        if exc.is_blocked:
            contact.is_blocked = True
            contact.save(update_fields=["is_blocked"])
        _step(run, node, "system", f"Eslatma yuborilmadi: {exc.message}", {"error": exc.message})
        return "failed"

    _step(run, node, "bot", text, sent)
    _record_screen(run, node, sent.get("result"))
    _count_message(run)
    return "sent"


def _reminder_node(run: FlowRun, node_id: str) -> dict | None:
    """A block for a reminder a script armed, which no canvas has one for.

    `queue.remind` rides `tasks.send_followup` rather than a scheduler of its
    own — one scheduler is enough, and a second Celery task would have needed a
    second answer for every question this one has already answered (a busy
    chat, a run that finished, a worker that died). What it cannot ride is the
    block: the text lives on the run, so it is turned back into the one shape
    `deliver_followup` and the sender both speak.
    """
    entry = script_commands.pending_reminder(run, node_id)
    if entry is None:
        return None
    return {
        "id": run.current_node_id or "",
        "type": "message",
        "contentKind": "text",
        "text": str(entry.get("text") or ""),
        "buttons": entry.get("buttons") or [],
    }


def _handle_tableread(run: FlowRun, node: dict) -> tuple[str, str]:
    """Finds one row and puts its columns into the run's variables.

    Branches rather than continues. A price list with no row for the code the
    customer typed is not a failure — it is the other half of the conversation,
    and an author who has to write a Shart underneath every lookup to ask "did
    that work" is an author the block is not helping.

    The row lands under a prefix, so `{{qator.narx}}` and `{{qator.kod}}` both
    read — the same dotted walk `{{http.status}}` already uses. One block, one
    row: a query returning many is a report, and a report is not something a
    chat message can carry.
    """
    from apps.tables.models import Table

    config = node.get("tableRead") or {}
    handle = (config.get("handle") or "").strip()
    into = (config.get("into") or "qator").strip() or "qator"
    if not handle:
        _step(run, node, "system", "Ma'lumot tanlanmagan — o'qilmadi")
        return "continue", "no"

    table = Table.objects.filter(workspace_id=run.workspace_id, handle=handle).first()
    if table is None:
        _step(run, node, "system", f"«{handle}» ma'lumoti topilmadi")
        return "continue", "no"

    column = (config.get("column") or "").strip()
    wanted = render_text(config.get("value", ""), run.context).strip()

    row = None
    if not column:
        # No column named: the newest row. That is the useful default for a
        # table a flow writes into — "what did we just record" — and it means a
        # freshly configured block does something rather than nothing.
        row = table.rows.first()
    else:
        # Compared as text, and case-insensitively: the value on one side came
        # from a customer typing into Telegram and the other from a column that
        # may hold a number. `str` on both is the only comparison that does not
        # need the author to know which.
        for candidate in table.rows.all()[:MAX_TABLE_SCAN]:
            cell = (candidate.data or {}).get(column)
            if cell is not None and str(cell).strip().lower() == wanted.lower():
                row = candidate
                break

    if row is None:
        _step(run, node, "system", f"«{handle}»: qator topilmadi ({column or 'oxirgi'})")
        return "continue", "no"

    # References become what they name. A cell holding another row's id is the
    # right thing to store and the wrong thing to say to a customer.
    from apps.tables.services import readable_rows

    run.context[into] = readable_rows(table, [row.data or {}])[0]
    run.save(update_fields=["context"])
    _step(run, node, "system", f"«{table.name}» dan qator o'qildi → {into}", {"data": row.data})
    return "continue", "yes"


def _handle_tablerow(run: FlowRun, node: dict) -> tuple[str, str]:
    """Appends one row to a table and walks on.

    The other half of `{{ table("navbat") }}`. A flow could already *read* a
    table and could not put anything in one, so a booking flow's answers lived
    on the contact — visible one person at a time and never as the list the
    owner actually wants.

    Every value goes through `render_text` like any other field, so `{{ism}}`
    and `{{ money(jami) }}` both work here and mean exactly what they mean
    everywhere else. The typing and the unknown-key rule come from
    `tables.services.clean_row_data` rather than being written again — the API,
    the incoming webhook and this block are three doors into one table, and
    three copies of "what a number column accepts" is how they start disagreeing.

    Nothing here raises. A table that was renamed, a block nobody finished, a
    value that will not fit a number column: each is a system step the author
    can read and a conversation that carries on, because the customer waiting
    on the next message is not the person who can fix it.
    """
    from apps.common.exceptions import ApiError
    from apps.tables.models import Table, TableRow
    from apps.tables.services import clean_row_data

    config = node.get("tableWrite") or {}
    handle = (config.get("handle") or "").strip()
    if not handle:
        _step(run, node, "system", "Ma'lumot tanlanmagan — qator yozilmadi")
        return "continue", "out"

    table = Table.objects.filter(workspace_id=run.workspace_id, handle=handle).first()
    if table is None:
        _step(run, node, "system", f"«{handle}» ma'lumoti topilmadi — qator yozilmadi")
        return "continue", "out"

    raw = {key: render_text(value, run.context) for key, value in (config.get("values") or {}).items()}
    try:
        data = clean_row_data(table, raw)
    except ApiError as exc:
        # `.detail`, not `.message`: ApiError extends DRF's APIException and
        # keeps the sentence there. Reading a field it does not have raised
        # inside the very handler written to stop a bad value ending the
        # conversation — the run came out FAILED for a typo in a price.
        reason = str(exc.detail)
        _step(run, node, "system", f"Ma'lumotga yozilmadi: {reason}", {"error": reason})
        return "continue", "out"

    TableRow.objects.create(table=table, data=data)
    _step(run, node, "system", f"«{table.name}» ma'lumotiga qator qo'shildi", {"table": table.handle, "data": data})
    return "continue", "out"


def _handle_ai(run: FlowRun, node: dict) -> tuple[str, str]:
    """The AI block.

    Integration point: `config.ai` holds the model, grounding and fallback the
    author picked, and this is where a provider call goes. Until one is wired
    in, the block sends its configured fallback — which is exactly what it is
    supposed to do when a model cannot answer, so the flow behaves the same way
    on both sides of that change.
    """
    config = node.get("ai") or {}
    text = config.get("fallbackText") or node.get("text", "")
    if text:
        sent = _deliver(run, {**node, "contentKind": "text", "text": text})
        _step(run, node, "bot", render_text(text, run.context), sent)
        if not run.is_test:
            _count_message(run)

    if config.get("fallbackAction") == "handoff" and config.get("handoffOnLowConfidence"):
        return _handle_human(run, node)
    return "continue", "out"


def _handle_http(run: FlowRun, node: dict) -> tuple[str, str]:
    """Calls an external service and puts the answer in the run's context."""
    url = render_text(node.get("text", ""), run.context).strip()
    if not url.startswith("http"):
        _step(run, node, "system", "HTTP manzili noto'g'ri", {"url": url})
        return "continue", "out"

    try:
        response = safe_get(url)
    except UnsafeUrlError as exc:
        # The URL points inside the network — the metadata endpoint, loopback,
        # a private range. The block does nothing and says why, rather than
        # letting the server make a request a tenant should not be able to ask
        # for. See `safe_http`.
        _step(run, node, "system", f"HTTP rad etildi: {exc}", {"url": url, "error": str(exc)})
        return "continue", "out"
    except requests.RequestException as exc:
        # A third party being down is not a reason to drop the conversation;
        # the flow continues with whatever the next block can do without it.
        _step(run, node, "system", f"HTTP xato: {exc}", {"url": url, "error": str(exc)})
        return "continue", "out"

    raw = read_capped(response)
    try:
        body: Any = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        body = raw.decode("utf-8", "replace")[:500]
    run.context["http"] = body
    run.save(update_fields=["context"])
    _step(run, node, "system", f"HTTP {response.status_code}", {"url": url, "status": response.status_code})
    return "continue", "out"


def _handle_human(run: FlowRun, node: dict) -> tuple[str, str]:
    from apps.notifications.services import notify

    _step(run, node, "system", f"Operatorga uzatildi — {node.get('text', '')}")
    if not run.is_test:
        record_event(flow=run.flow, contact=run.contact, metric="handoffs")
        notify(
            workspace=run.workspace,
            kind="handoff",
            title="Operator kerak",
            text=f"{run.contact.display_name if run.contact_id else 'Mijoz'} · {run.flow.name}",
            href=f"/flows/{run.flow_id}",
            icon="headset",
        )
    _park(run, node["id"], FlowRun.Status.HANDOFF)
    return "park", ""


def _handle_flowlink(run: FlowRun, node: dict) -> tuple[str, str]:
    """Hands the contact to another flow, at the block the author picked."""
    target_id = node.get("target")
    target = Flow.objects.filter(pk=target_id, bot=run.bot).first() if target_id else None
    _step(run, node, "system", f"O'tish: {node.get('text', '')}", {"target": target_id})

    if target is None:
        return "continue", "out"

    entry = node.get("targetNodeId") or (target.entry_nodes()[0]["id"] if target.entry_nodes() else None)
    if entry is None:
        return "continue", "out"

    _finish(run, FlowRun.Status.DONE)
    start_run(flow=target, contact=run.contact, entry_node_id=entry, is_test=run.is_test)
    return "stop", ""


def _handle_end(run: FlowRun, node: dict) -> tuple[str, str]:
    """The author's own full stop.

    Exactly the ending `walk` already gives a flow that runs out of blocks —
    finished as DONE, and nothing said after it — and deliberately not an
    ending of its own. There used to be an after-flow menu here, configured
    from the bot's «Javoblar» settings; that screen and the module behind it
    are gone, and what a customer meets after the last block is now whatever
    their next message meets: `dispatch.find_trigger` looks for a flow that
    claims it, and where none does the bot says nothing and `record_inbound`
    puts the message in Suhbatlar for an operator to answer.

    Ending the same way the graph running out ends is the point of that. A
    block that said something extra would make one bot behave two ways
    depending on whether the author drew the ending or let the flow run off the
    end, which is the sort of difference nobody can see on a canvas.

    "stop" rather than "continue" so `walk` does not go looking for an exit: the
    run is already finished, and a stale `out` edge left on the block by an
    older save must not be followed either. The editor draws no such port (see
    `node-definitions.ts`), but a graph can arrive from somewhere the editor
    never saw it.
    """
    _step(run, node, "system", "Suhbat yakunlandi")
    _finish(run, FlowRun.Status.DONE)
    return "stop", ""


_HANDLERS = {
    **{node_type: _handle_entry for node_type in PASSTHROUGH_TYPES},
    "message": _handle_message,
    # Ask, wait, keep. The one thing a bot does that nothing else here did: a
    # «Xabar» block sends and walks straight on, so «ism va familiyangizni
    # yozing» was followed immediately by the block meant to store the answer,
    # which read `{{message.text}}` and found the *previous* message in it. A
    # real contact ended up with `mijoz_ismi = "Shifokorga yozilish"` — the
    # label of the button they had pressed a moment earlier — and nothing
    # anywhere said so.
    "question": _handle_question,
    # A language picker is a Savol whose answer is a tap: `_handle_language`
    # builds the keyboard from the block's own options and then delegates the
    # send-then-park to `_handle_question`.
    "language": _handle_language,
    "followup": _handle_followup,
    "condition": _handle_condition,
    "delay": _handle_delay,
    "tag": _handle_tag,
    "tablerow": _handle_tablerow,
    "tableread": _handle_tableread,
    "ai": _handle_ai,
    "http": _handle_http,
    "flowlink": _handle_flowlink,
    "end": _handle_end,
}


# ---------------------------------------------------------------------------
# Continuing a parked run
# ---------------------------------------------------------------------------


#: How many times a question re-asks before the conversation goes to a person,
#: when the block does not say. Three is enough for a typo and a second
#: thought; more is an argument with a robot, which nobody wins.
MAX_ANSWER_ATTEMPTS = 3


def _still_answerable(node: dict, context: dict[str, Any]) -> bool:
    """Whether the block the customer is looking at has any other way out.

    A keyboard is still on their screen after a tap. If one of its rows leads
    nowhere, the rows beside it are not thereby broken — so the run belongs on
    the block that drew them, not in the ground.
    """
    keyboarded = content_kind(node) not in BUTTONLESS_CONTENT
    return bool(routable_buttons(node)) or bool(keyboarded and back_row_label(node, context))


def _continue_from(run: FlowRun, node: dict, port: str) -> FlowRun:
    """Leaves a parked block through `port`, or ends the run where nothing is wired.

    The unconnected exit is not an error: an author drew what they meant the
    conversation to do, and everything they did not draw is where it ends.

    But *where it ends* has to mean the conversation and not the keyboard. This
    used to finish the run on any unwired exit, and on a block with two buttons
    that was a trap with no way out of it. Observed, in this order, from one
    real chat:

        10:33:26  btn:…780058   ← the second button, wired to nothing → run DONE
        10:33:42  btn:…299545   ← the first button, wired to n4
        10:35:12  btn:…299545   ← again
        10:41:29  btn:…299545   ← again

    Every one of those last three arrived, and every one of them was dropped:
    the run they belonged to was already finished, so `_waiting_run` found
    nothing, `find_trigger` has no trigger for a callback, and the bot went
    silent — not for that one row, but for the whole message, permanently. The
    owner read it as "inline buttons stopped working". One tap on a row the
    author had not got round to wiring cost the customer the entire
    conversation, and nothing anywhere said so.

    So a block whose keyboard is still on the customer's screen stays parked:
    the tap did nothing, which is the honest answer to a row that leads
    nowhere, and every other row on that message still works. A block with no
    keyboard left has genuinely run out of conversation and still ends here —
    that is the case the original rule was written for, and a customer parked
    forever on a block nothing can continue is the failure it was preventing.

    Parking is safe against the run swallowing what comes next: `_reply_port`
    refuses a command outright, and refuses typed text unless the block asked
    for it, so «/start» and «/ariza» still open a fresh conversation.

    A test run parks either way — there the run *is* the harness, and the
    tester needs to try the second branch without replaying the flow.
    """
    edge = run.flow.edge(node["id"], port)
    next_id = edge.get("to") if edge else None
    if next_id is None:
        _step(run, node, "system", "Bu javob uchun davomi ulanmagan")
        if run.is_test or _still_answerable(node, run.context):
            return _park(run, node["id"], FlowRun.Status.WAITING)
        return _finish(run, FlowRun.Status.DONE)

    run.status = FlowRun.Status.RUNNING
    run.save(update_fields=["status"])
    return walk(run, next_id, edge)


def _tapped_choice(node_type: str, text: str) -> str | None:
    """The value behind a language callback, or None for anything else.

    The block has one exit, so what the tap has to carry is the answer and not
    the port. Stripping the prefix here is what keeps `lang:uz` out of
    `{{message.text}}` and out of the trace the author reads.
    """
    prefix = {"language": LANGUAGE_PREFIX}.get(node_type)
    if not prefix or not text.startswith(prefix):
        return None
    return text[len(prefix) :]


def _store_language(run: FlowRun, node: dict, code: str) -> None:
    """Writes the chosen language under the one name the rest of the product reads.

    `mijoz_tili` is an ordinary contact variable (see `apps.common.i18n`), not
    a column of this block's own — which is why picking a language here and
    setting it from a "Teg" block are the same act as far as everything
    downstream is concerned.
    """
    language = normalise_language(code, fallback="")
    if not language:
        _step(run, node, "system", f"Noma'lum til: {code}")
        return
    run.context[LANGUAGE_VARIABLE] = language
    # The rest of *this* run answers in the new language too. Without this the
    # customer picks Russian and the very next block — the one thanking them
    # for picking it — arrives in Uzbek.
    run.context["language"] = language
    run.save(update_fields=["context"])
    if run.contact_id:
        run.contact.set_language(language)
    _step(run, node, "system", f"{LANGUAGE_VARIABLE} = {language}")


def resume_with_reply(
    run: FlowRun, *, text: str = "", port: str = "out", extra_context: dict[str, Any] | None = None
) -> FlowRun:
    """Continues a waiting run with what the contact just did.

    `extra_context` is what the update itself brought that the run could not
    have known when it parked — answers that arrive with the message that
    continues the run rather than the one that started it, which
    `_initial_context` never sees because it only runs at the top of a run.
    Merged before the first block executes, for the same reason `start_run`
    merges its own: the very next block may render what it carries.

    Nothing populates it today. It is kept because the seam is the awkward one
    to add back under pressure, and because the shape is right: a resume is the
    only moment at which a parked run can be handed anything.
    """
    run.incoming_edge = None
    if extra_context:
        run.context.update(extra_context)
        run.save(update_fields=["context"])
    node = run.flow.node(run.current_node_id)
    if node is None:
        return _finish(run, FlowRun.Status.FAILED, "Kutilayotgan blok topilmadi")

    node_type = node.get("type", "")

    # What the customer just said, before the block that was waiting for it gets
    # to act on it. Once, above every branch below rather than inside them: a
    # tap, a typed answer and the way back are all the same event to a hook —
    # the customer said something — and a hook that fired on three of the five
    # ways out of this function would be a hook nobody could reason about.
    #
    # `said` and not `text`, for the reason spelled out at the button branch
    # further down: an inline tap arrives carrying `btn:b1`, which is the wire's
    # name for the port and not a word anybody chose, and a language row arrives
    # as `lang:uz`. Both are unwrapped by the branches below before anything
    # else in the product reads them, so both are unwrapped before the hook
    # does: `ctx.message.text` is what a person typed or pressed.
    #
    # The command is parsed rather than passed in because nothing passes one:
    # `dispatch._reply_port` refuses a command as an answer, so on the live path
    # this is always empty — but the studio's test chat hands `resume_with_reply`
    # whatever the author typed into it, «/stop» included.
    said = _tapped_choice(node_type, text) or text
    if port.startswith(BUTTON_PREFIX) and (not text or text == port):
        said = button_label(node, port, run.context) or text
    directive = _fire(run, "onUserMessage", node=node, message=said, command=_read_command(said))

    # A script that named a block outranks the exit the customer's tap would
    # have taken. Read before «Orqaga» and before the button branches, because
    # every one of those decides where the conversation goes and only one of
    # them can win — and the one an author wrote in code is the one they wrote
    # most recently. What the customer said is still recorded and still becomes
    # `{{xabar}}`: the reply happened whatever the script then did with it.
    settled, target = _hook_route(run, directive, node["id"])
    if settled is not None:
        return settled
    if target:
        _step(run, node, "user", said or text or port)
        if said:
            run.context["message.text"] = said
            run.context["xabar"] = said
        run.status = FlowRun.Status.RUNNING
        run.save(update_fields=["context", "status"])
        return walk(run, target)

    # «Orqaga» is the one thing a parked block can be told that is not about
    # the block at all — it is the way off it — so it is read before every rule
    # below, each of which takes `text` for what the customer meant to say.
    # Both shapes of the row arrive here (`dispatch._reply_port`): the inline
    # tap carrying `port:back`, and the reply row arriving as its label typed
    # out, which on the wire is an answer like any other. Falling through cost
    # a question both ways round — the label failed the phone check, so the
    # block re-asked and the row that was the only way out of it was the one
    # thing that could not be used; and where it passed the check it was
    # written to `saveAnswerAs` and onto the contact, which is how somebody
    # ends up named «Orqaga».
    #
    # The step records the row and not `text`: an author reading the trace
    # wants the words the customer saw, not `port:back`, which is the wire's
    # name for the tap.
    if port == "back":
        _step(run, node, "user", back_row_label(node, run.context) or text)
        return _continue_from(run, node, "back")

    # One of the author's own buttons, and read here for the same reason
    # «Orqaga» is: it is a branch off the block rather than an answer to it.
    # Falling through cost a question both ways round — an inline tap arrives
    # carrying `btn:b1`, so the block checked *that* against its answer type,
    # stored it under `saveAnswerAs` and wrote it onto the contact; a reply-
    # keyboard tap arrives as the row's own label, which passes for an answer
    # and is not one either, because the author drew a branch from that button
    # and wired it somewhere.
    if port.startswith(BUTTON_PREFIX):
        label = button_label(node, port, run.context)
        # What the customer actually said by pressing it. Neither shape of the
        # tap carries words anybody chose — `btn:b1` is the wire's name for the
        # port, and a reply row only reads its own label back — so the label
        # stands for both and one press leaves one trace whatever keyboard it
        # was on.
        #
        # A share row is the exception, and the reason this is not simply the
        # label: a tapped `request_contact` hands over a phone number and a
        # `request_location` a place. That *is* something the customer gave, and
        # a flow thanking them with `{{xabar}}` has to be able to say it back.
        wire = not text or text == port or text.strip().casefold() == label.casefold()
        said = label if wire else text
        _step(run, node, "user", said or text or port)
        if said:
            run.context["message.text"] = said
            run.context["xabar"] = said
            run.save(update_fields=["context"])
        return _continue_from(run, node, port)

    choice = _tapped_choice(node_type, text)
    if choice is not None:
        text = choice

    _step(run, node, "user", text or port)

    # `{{message.text}}` is *this* message from here on. Without this it stayed
    # whatever started the run — so a "Teg" block copying the answer out of it
    # saved "/start", and the thank-you greeted the customer by that.
    if text:
        run.context["message.text"] = text
        run.context["xabar"] = text
        run.save(update_fields=["context"])

    if node_type == "language" and text:
        _store_language(run, node, text)

    if node_type == "question":
        return _answer_question(run, node, text)

    return _continue_from(run, node, port)


#: Where the count of unusable answers to the current question lives.
#:
#: On the run and not on the node, because a node is a piece of the flow's
#: stored graph and this is a fact about one conversation. Cleared the moment
#: the question is answered, so the next «Savol» starts from nothing.
#:
#: One underscore and not two. `FlowRun.save` strips every `__`-prefixed key on
#: the way to the database — that prefix is reserved for a single block's
#: scratch, `__expressions` above all — so a counter named that way was written,
#: silently dropped, and read back as zero on the next message: the question
#: re-asked for ever and never reached a person. `_screen_message_id` beside it
#: is the convention this follows.
ANSWER_ATTEMPTS_KEY = "_answer_attempts"


def _answer_question(run: FlowRun, node: dict, text: str) -> FlowRun:
    """Keeps the answer to a «Savol» block, or asks again.

    The check is `validation.check_answer`, which is forgiving about form and
    strict about substance: three ways of typing the same phone number are the
    same number, and «salom» is not one of them. What is stored is the
    normalised value rather than what the keyboard produced, so a flow reading
    `{{mijoz_telefoni}}` gets one shape however it was typed.

    An answer that does not pass is not the end of anything. The block says
    what was wrong and stays parked, up to `retryLimit` times — after that the
    conversation goes to a person, because a fourth «men tushunmadim» is an
    argument with a robot and nobody wins one.
    """
    answer_type = node.get("answerType") or "text"
    checked = check_answer(answer_type, text, node.get("pattern") or "")

    if not checked.ok:
        attempts = int(run.context.get(ANSWER_ATTEMPTS_KEY) or 0) + 1
        limit = int(node.get("retryLimit") or MAX_ANSWER_ATTEMPTS)
        run.context[ANSWER_ATTEMPTS_KEY] = attempts
        run.save(update_fields=["context"])
        if attempts >= limit:
            run.context.pop(ANSWER_ATTEMPTS_KEY, None)
            run.save(update_fields=["context"])
            return _handle_handoff_after_question(run, node)
        # The author's own wording where they wrote one; otherwise the checker's,
        # which always names an example of what would be accepted.
        message = (node.get("errorText") or "").strip() or checked.message
        _step(run, node, "system", message)
        _deliver(run, {**node, "text": message})
        return _park(run, node["id"], FlowRun.Status.WAITING)

    name = (node.get("saveAnswerAs") or node.get("tagName") or "").strip()
    # `message.text` too, and with the normalised value: everything downstream
    # that reads the answer — a thank-you message, a «Jadvalga yozish» block,
    # a script — reads it from there.
    run.context["message.text"] = checked.value
    run.context["xabar"] = checked.value
    if name:
        run.context[name] = checked.value
        if run.contact:
            run.contact.set_variable(name, checked.value)
        _step(run, node, "system", f"{name} = {checked.value}")
    run.context.pop(ANSWER_ATTEMPTS_KEY, None)
    run.save(update_fields=["context"])
    return _continue_from(run, node, "out")


def _handle_handoff_after_question(run: FlowRun, node: dict) -> FlowRun:
    """Gives up on a question and asks for a person."""
    from apps.notifications.services import notify

    _step(run, node, "system", "Javob tushunilmadi — operatorga uzatildi")
    if not run.is_test:
        record_event(flow=run.flow, contact=run.contact, metric="handoffs")
        notify(
            workspace=run.workspace,
            kind="handoff",
            title="Operator kerak",
            text=f"{run.contact.display_name if run.contact_id else 'Mijoz'} · {run.flow.name}",
            href=f"/flows/{run.flow_id}",
            icon="headset",
        )
    return _park(run, node["id"], FlowRun.Status.HANDOFF)


def resume_after_delay(run: FlowRun) -> FlowRun:
    """Wakes a sleeping run and continues out of its delay block.

    Its own batch of realtime events: a delay wake walks blocks and sends
    messages the same way an update does, so its publishes are held and flushed
    together rather than one between each send.
    """
    with buffered_publishing():
        return _resume_after_delay(run)


def _resume_after_delay(run: FlowRun) -> FlowRun:
    if run.status != FlowRun.Status.SLEEPING:
        return run
    node = run.flow.node(run.current_node_id)
    if node is None:
        return _finish(run, FlowRun.Status.FAILED, "Kutish bloki topilmadi")

    run.status = FlowRun.Status.RUNNING
    run.resume_at = None
    run.save(update_fields=["status", "resume_at"])
    return walk(run, run.flow.next_node_id(node["id"], "out"))
