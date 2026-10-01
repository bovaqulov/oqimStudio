"""What a workspace has used this month, against what its plan allows.

The plan's `limits` are the source of *both* halves: `usage_report` draws the
gauge from them and `check_plan_allows` refuses on them, so a workspace can
never be told it is at 60% by one screen and blocked by the next call. A limit
that is `null` — or a key the plan never declared — is not capped.

Enforcement is deliberately split in two. `check_plan_allows` raises, and is
what an API call somebody is waiting on should use: they asked for something,
they get told why they cannot have it. `plan_allows` only answers true or
false, for the runtime — a webhook that raised would be retried by Telegram
forever, and a bot that stops answering because a counter is full is a worse
failure than a contact that goes unfiled. `apps.engine.dispatch` is where that
sentence is literally true: a full `contacts` cap costs the filing and not the
answer.

One limit fits neither half, and it is worth naming rather than leaving to be
rediscovered. `messages` is counted *after* a send that has already left the
machine, so by the time the number moves there is nothing left to refuse, and
refusing earlier would be the quiet bot again. It is therefore never refused at
all — what stands in its place is
`apps.notifications.services.warn_about_usage`, which tells the workspace once
when the limit is nearly gone and once when it is past, and stops nothing. The
note beside `UNGUARDED` in `apps.billing.tests` is where that is held to.

That telling is not only `messages`' any more. Every other limit was silent
until it refused: a workspace could sit at `1 / 1 bot` and `5 / 5 oqim` with
«Tarif chegarasi» switched on and an empty bell, because the two call sites
that warned were both in the runtime and both about one key. `check_plan_allows`
now says the same thing on the way past — it is the one place every countable
create already goes through, and it is holding the count the sentence needs.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.analytics.models import Event, Metric
from apps.bots.models import Bot
from apps.common.exceptions import ApiError
from apps.contacts.models import Contact
from apps.flows.models import Flow

from .models import Plan

WINDOW_DAYS = 30

#: The block types the AI limit counts. Matches `features/flow-builder/node-registry.ts`.
#:
#: What the AI-block plan limit counts. «AI agent» was the other member until
#: it was removed from the palette; «AI javob» is the block that answers with a
#: model and the one this key caps.
AI_NODE_TYPES = frozenset({"ai"})


class PlanLimitExceeded(ApiError):
    """The plan does not cover this.

    402 rather than 403: nothing is wrong with the caller's permissions, the
    answer is "this costs more than you pay".
    """

    def __init__(self, message: str, field: str | None = None):
        super().__init__("plan_limit", message, field=field, status_code=402)


def _messages_used(workspace) -> int:
    since = timezone.now() - timedelta(days=WINDOW_DAYS)
    return Event.objects.filter(workspace=workspace, metric=Metric.MESSAGE, occurred_at__gte=since).count()


def ai_blocks_in(nodes) -> int:
    """How many AI blocks one graph carries."""
    return sum(1 for node in nodes or [] if isinstance(node, dict) and node.get("type") in AI_NODE_TYPES)


def ai_blocks_used(workspace, *, excluding_flow_id: str | None = None) -> int:
    """AI blocks the workspace is actually running.

    Counted from the graphs rather than stored: the editor rewrites `nodes`
    wholesale on every save, so a counter kept beside them would drift.

    Only *enabled* flows count. A paused flow costs nothing — nobody's message
    reaches it — and counting drafts made the limit unescapable: a workspace
    that had drawn two AI blocks could not switch on anything ever again,
    including flows with no AI block in them at all.
    """
    rows = Flow.objects.filter(workspace=workspace, enabled=True)
    if excluding_flow_id:
        rows = rows.exclude(pk=excluding_flow_id)
    return sum(ai_blocks_in(nodes) for nodes in rows.values_list("nodes", flat=True))


def scripts_used(workspace, *, excluding_flow_id: str | None = None) -> int:
    """Flows the workspace is running that carry their own JavaScript.

    Counted off `Flow.script` for the same reason `ai_blocks_used` is counted
    off `nodes`: the file is rewritten wholesale by the panel that saves it, so
    a number kept beside it would be a second copy that drifts.

    Enabled only, and the argument is the AI block's word for word. A paused
    flow's hooks never fire, so it costs nothing; counting the drafts too would
    mean a workspace that once wrote a script could never switch anything on
    again, including flows with no code in them at all.
    """
    rows = Flow.objects.filter(workspace=workspace, enabled=True).exclude(script="")
    if excluding_flow_id:
        rows = rows.exclude(pk=excluding_flow_id)
    return rows.count()


#: Every capped resource: how it reads, how it is counted, the noun a refusal is
#: written with, and what a full bar actually costs. The keys are the plan's
#: `limits` keys and the frontend's `UsageMetric.key` — one vocabulary for the
#: gauge and the guard.
#:
#: `whenFull` is the sentence under a bar that has reached its ceiling, and it
#: is per resource because the consequence is. Every meter printed one line —
#: "Limit to'ldi — yangi so'rovlar rad etilyapti" — which names nothing the
#: reader owns: «so'rov» is what their *customers* send, so a full `bots` bar
#: read as "your bot has stopped answering people" when what had actually
#: happened was that a second bot could not be connected. Written out per key,
#: each one names the thing that stops, and `notifications.services` says the
#: same sentence in the bell rather than composing a second one.
RESOURCES: dict[str, dict] = {
    "messages": {
        "label": "Yuborilgan xabar",
        "noun": "xabarlar",
        "hint": f"So'nggi {WINDOW_DAYS} kun ichida bot yuborgan xabarlar",
        "count": _messages_used,
        # The one key nothing refuses — so the sentence has to say that, or a
        # workspace over its message count reads its bots as stopped.
        "whenFull": "Limit oshib ketdi — hisobda qolyapti, hech narsa to'xtamadi",
    },
    "bots": {
        "label": "Botlar",
        "noun": "botlar",
        "hint": "Ish maydoniga ulangan botlar",
        "count": lambda workspace: Bot.objects.filter(workspace=workspace).count(),
        "whenFull": "Limit to'ldi — yangi bot qo'sha olmaysiz",
    },
    "flows": {
        "label": "Oqimlar",
        "noun": "oqimlar",
        "hint": "Yaratilgan oqimlar soni",
        "count": lambda workspace: Flow.objects.filter(workspace=workspace).count(),
        # Drafts included, because the count is: this is every row, not every
        # running one, and the refusal on «Yangi oqim» reads the same number.
        "whenFull": "Limit to'ldi — yangi oqim yarata olmaysiz",
    },
    "contacts": {
        "label": "Kontaktlar",
        "noun": "kontaktlar",
        "hint": "Bot bilan yozishgan foydalanuvchilar",
        "count": lambda workspace: Contact.objects.filter(workspace=workspace).count(),
        # Refused, but not at anybody who asked: `engine.dispatch` stops filing
        # the people writing in. The bot still answers them, which is the half
        # a reader would otherwise assume had broken.
        "whenFull": "Limit to'ldi — yangi mijozlar saqlanmayapti, bot javob berishda davom etmoqda",
    },
    "members": {
        "label": "Jamoa a'zolari",
        "noun": "jamoa a'zolari",
        "hint": "Ish maydonidagi odamlar — yuborilgan taklif ham o'rin egallaydi",
        # Invitations included, which is the whole of what makes this cap real.
        # Counted on acceptance instead, a seat is only taken by somebody who
        # answered their mail: a workspace could hold twenty invitations open
        # and read `2 / 2` throughout, and the refusal — when one finally
        # arrived — would arrive at the invitee, the one person in the story
        # who can neither raise the plan nor free a seat.
        #
        # Both halves of a promised seat are visible and reversible: the
        # pending row is on the team screen, and removing it (DELETE
        # `/api/members/<id>/`) hands the seat back.
        "count": lambda workspace: workspace.memberships.count(),
        "whenFull": "Limit to'ldi — jamoaga yangi a'zo qo'sha olmaysiz",
    },
    "aiBlocks": {
        "label": "AI bloklari",
        "noun": "AI bloklari",
        "hint": "Oqimlarda ishlatilgan AI bloklari",
        "count": ai_blocks_used,
        # Refused where it is spent — switching a flow on — and not at the
        # canvas, so the sentence names that moment and not «AI javob bloki
        # qo'sha olmaysiz», which the editor is free to allow in a draft.
        "whenFull": "Limit to'ldi — AI bloki bor oqimni yoqa olmaysiz",
    },
    "scripts": {
        "label": "Kodli oqimlar",
        "noun": "oqim skriptlari",
        "hint": "O'z JavaScript kodi bilan ishlayotgan oqimlar",
        "count": scripts_used,
        "whenFull": "Limit to'ldi — kodi bor oqimni yoqa olmaysiz",
    },
}


def plan_for(workspace) -> Plan | None:
    """The price list row this workspace is on, or None when it is on none."""
    subscription = getattr(workspace, "subscription", None)
    if subscription is not None:
        return subscription.plan
    # A tenant can carry a plan key without a subscription row — a trial, or a
    # workspace made before billing existed. The price list still applies.
    return Plan.objects.filter(pk=workspace.plan_key).first()


def plan_limit(workspace, resource: str) -> int | None:
    """What the plan allows of `resource`. None means it does not cap it."""
    if resource not in RESOURCES:
        # A typo'd resource would otherwise read as "uncapped" and quietly
        # switch the whole check off.
        raise ValueError(f"unknown plan resource: {resource}")
    plan = plan_for(workspace)
    return (plan.limits or {}).get(resource) if plan else None


def current_usage(workspace, resource: str) -> int:
    return RESOURCES[resource]["count"](workspace)


def plan_allows(workspace, resource: str, *, adding: int = 1, current: int | None = None) -> bool:
    """Whether `adding` more of `resource` still fits under the plan's cap.

    `current` is counted when it is not given; callers that already know it —
    or that mean something narrower than "everything in the workspace" — pass
    their own number.
    """
    limit = plan_limit(workspace, resource)
    if limit is None:
        return True
    if current is None:
        current = current_usage(workspace, resource)
    return current + adding <= limit


def limit_message(workspace, resource: str, *, total: int, limit: int) -> str:
    """Why the answer is no, written for the person who asked."""
    plan = plan_for(workspace)
    name = plan.name if plan else "Joriy"
    noun = RESOURCES[resource]["noun"]
    # Two ways out, both named: the reader can pay for the plan that covers it,
    # or take the thing out. A message that offers only the first reads as a
    # sales pitch standing between somebody and their own work.
    if limit == 0:
        return (
            f"{name} tarifida {noun} yo'q ({total} ta ishlatilmoqda). "
            f"{noun.capitalize()}ni oqimdan olib tashlang yoki tarifni oshiring."
        )
    return (
        f"{name} tarifida {noun} soni {limit} tadan oshmasligi kerak "
        f"(bu amaldan keyin {total} ta bo'ladi). Ortiqchasini olib tashlang yoki tarifni oshiring."
    )


def lock_reason(workspace, resource: str, *, used: int | None = None, limit: int | None = None) -> str:
    """Why the plan will refuse the *next* one of these. Empty when it will not.

    A second sentence beside `limit_message`, for the other moment. That one is
    written for somebody who has already pressed something and is owed the
    reason it did not happen; this one is written on a control nobody has
    pressed yet — a palette row, a disabled button — where "(1 ta
    ishlatilmoqda)" would be counting a thing the reader has not done.

    Both name the plan and the resource, and a test in `apps.billing.tests`
    holds them to that, because a lock that says one thing and a refusal that
    says another is the failure the lock exists to prevent.

    It names where the answer is changed, for the same reason `warn_about_usage`
    carries an `href`: a refusal that does not say where to go leaves the reader
    to search the product for the screen that would have told them.
    """
    if limit is None:
        limit = plan_limit(workspace, resource)
    if limit is None:
        return ""
    if used is None:
        used = current_usage(workspace, resource)
    if used + 1 <= limit:
        return ""
    plan = plan_for(workspace)
    name = plan.name if plan else "Joriy"
    noun = RESOURCES[resource]["noun"]
    where = "Tarifni oshirish: To'lov → Tariflar."
    if limit == 0:
        return f"{name} tarifida {noun} yo'q. {where}"
    # "{limit} ta {noun}" would read «1 ta botlar»: after a numeral the noun is
    # singular in Uzbek, and every noun in `RESOURCES` is plural because the
    # rest of the sentences want it that way. `limit_message` sidesteps the same
    # trap with the same word, so the two read alike.
    return f"{name} tarifida {noun} soni {limit} ta — hammasi ishlatilgan. {where}"


def check_plan_allows(
    workspace,
    resource: str,
    *,
    adding: int = 1,
    current: int | None = None,
    field: str | None = None,
) -> None:
    """Raises `PlanLimitExceeded` when the plan does not cover this.

    Called before the write, never after: a 402 that arrives once the row is
    already saved is a refusal nobody honoured.

    It is also where the workspace hears about the limit. Every countable
    create passes through here holding the number the sentence needs, so one
    call covers `bots`, `flows`, `members` and the rest — all of which used to
    fill up in silence, because the only two places that warned were in the
    runtime and both were about `messages`. Deliberately *before* the raise: a
    refusal is the loudest moment a limit has, and it is the one a reader is
    most likely to want a record of afterwards.
    """
    limit = plan_limit(workspace, resource)
    if limit is None:
        return
    if current is None:
        current = current_usage(workspace, resource)
    total = current + adding
    _warn(workspace, resource, used=total, limit=limit)
    if total > limit:
        raise PlanLimitExceeded(limit_message(workspace, resource, total=total, limit=limit), field=field)


def _warn(workspace, resource: str, *, used: int, limit: int) -> None:
    """Tells the workspace where this limit stands. Never raises, never blocks.

    Imported here rather than at the top of the module: `notifications.services`
    reads this one for the plan, the noun and the count, so the two would not
    import at all the other way round. And the direction is right — billing is
    the fact, the bell is one of the things that reports it — so the cycle is
    broken at the reporting end.

    `used` is the total *after* the action being checked, which is the number a
    reader will see on the screen a moment later. `warn_about_usage` throttles
    the sentence itself, and swallows anything that goes wrong inside it.
    """
    from apps.notifications.services import warn_about_usage

    warn_about_usage(workspace, resource, used=used, limit=limit)


def refusal_reason(workspace, resource: str, *, adding: int = 1, current: int | None = None) -> str | None:
    """Why the plan refuses this, for a caller that must not raise. None when it does not.

    The other half of `plan_allows`: that one answers *whether*, this one
    answers *why*, in the same sentence `check_plan_allows` would have raised
    with. A path that cannot raise — a webhook, a queued job — still has
    somebody to tell afterwards, and writing a second wording for the same
    refusal is how the two start disagreeing about what the plan says.
    """
    limit = plan_limit(workspace, resource)
    if limit is None:
        return None
    if current is None:
        current = current_usage(workspace, resource)
    total = current + adding
    if total <= limit:
        return None
    return limit_message(workspace, resource, total=total, limit=limit)


def check_graph_allows(workspace, nodes, *, flow_id: str | None = None, script: str | None = None) -> None:
    """The plan check for a flow as it will run — its canvas and its code.

    The incoming graph replaces whatever that flow held, so its blocks are
    counted from `nodes` and the flow itself is left out of the workspace
    total — otherwise re-saving a flow would count its AI blocks twice and
    refuse an edit that changes nothing. The script is counted the same way,
    for the same reason.

    `script` is read off the row when the caller does not hand one over, so a
    caller that already holds the source spends no query and one that does not
    still cannot switch on code the plan does not cover. Passing `""` is a
    caller saying there is none, which is different from not saying.
    """
    adding = ai_blocks_in(nodes)
    # A flow that carries none cannot put the workspace further over, so there
    # is nothing here to refuse. Asking anyway is what turned an over-limit
    # workspace into one where no flow at all could be switched on — including
    # the ones an author built specifically to stay inside their plan.
    if adding:
        check_plan_allows(
            workspace,
            "aiBlocks",
            adding=adding,
            current=ai_blocks_used(workspace, excluding_flow_id=flow_id),
            field="nodes",
        )

    if script is None and flow_id:
        script = Flow.objects.filter(pk=flow_id).values_list("script", flat=True).first() or ""
    # Whitespace is not a script: the panel writes an empty file back as a few
    # newlines, and charging a plan slot for one would refuse a flow whose code
    # the author had just deleted.
    if (script or "").strip():
        check_plan_allows(
            workspace,
            "scripts",
            current=scripts_used(workspace, excluding_flow_id=flow_id),
            field="script",
        )


#: Limits that are counted and shown but never refused on.
#:
#: `messages` is the only one, and deliberately: refusing a send because a
#: counter is full stops a bot mid-conversation in front of a customer, which
#: this module's own docstring calls a worse failure than the overage. It is
#: warned about instead (`notifications.services.warn_about_usage`).
#:
#: This exists so the screen can say which kind of full a full bar is. Without
#: it `UsageMeter` printed "yangi so'rovlar rad etilyapti" under every bar,
#: which was true of five keys and false of this one — and false in the
#: direction that matters, because a workspace over its message count was being
#: told its bots had stopped when they had not.
#:
#: `apps/billing/tests.py::UNGUARDED` names the same key from the other side,
#: and a test binds the two so neither can move alone.
COUNTED_NOT_REFUSED = frozenset({"messages"})


def usage_report(workspace) -> dict:
    """The limits screen's rows. `limit` of None means the plan does not cap it."""
    plan = plan_for(workspace)
    limits = (plan.limits or {}) if plan else {}
    rows = []
    for key, resource in RESOURCES.items():
        used = resource["count"](workspace)
        limit = limits.get(key)
        rows.append(
            {
                "key": key,
                "label": resource["label"],
                "used": used,
                "limit": limit,
                "hint": resource["hint"],
                # What happens at the ceiling, not just where it is.
                "enforced": key not in COUNTED_NOT_REFUSED,
                # And what that costs, in the terms of the thing that stops —
                # see the note over `RESOURCES`.
                "whenFull": resource["whenFull"],
                # Why one more of this would be refused, said before anybody
                # presses anything. Empty on every row that has room — see
                # `lock_reason`.
                "lockReason": "" if limit is None else lock_reason(workspace, key, used=used, limit=limit),
            }
        )
    return {
        "planKey": plan.key if plan else "",
        "planName": plan.name if plan else "",
        "periodLabel": f"so'nggi {WINDOW_DAYS} kun",
        "metrics": rows,
    }
