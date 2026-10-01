"""Raising a notification.

One function for the general case, because a notification is two things that
must not come apart: a row someone can find later, and a push to whoever is
looking right now.

`warn_about_usage` below is the second function, and it exists for one limit in
particular. `apps.billing.services` splits enforcement in two — `check_plan_allows`
raises at somebody who asked, `plan_allows` only answers for the runtime — and
`messages` fits neither half. It is counted after a send that has already left
the machine, so there is nothing left to refuse; and refusing it earlier would
be a bot that goes quiet mid-conversation because a counter filled, which that
module names as the worse failure. Telling the workspace is what is left, and
it is not optional: without it the only witness to an overrun is a bar on a
screen nobody had a reason to open.
"""

from __future__ import annotations

import logging

from django.core.cache import cache

from apps.billing.services import RESOURCES, current_usage, plan_for, plan_limit
from apps.realtime.broadcast import publish, workspace_group

from .models import Notification, NotificationSettings

logger = logging.getLogger(__name__)

#: How much of a limit has to be gone before the workspace hears about it.
#:
#: Early enough that there is time to do something — raise the plan, prune a
#: flow — and late enough that it is news. At half a limit nobody would act on
#: it, and a notice nobody acts on trains people to dismiss the next one.
WARN_AT = 0.8

#: How long one warning stands for.
#:
#: A day, not a window: the same workspace crosses the same threshold thousands
#: of times inside one busy afternoon, and the second sentence adds nothing to
#: the first. Long enough to be quiet, short enough that a limit that is still
#: full tomorrow says so again.
WARN_WINDOW_SECONDS = 24 * 60 * 60

#: How often the count behind a warning may actually be run, per workspace.
#:
#: This is the whole difficulty of the feature. `warn_about_usage` is reached
#: after *every message the product sends*, and the number it needs is a
#: `COUNT(*)` over thirty days of events — put on that path unthrottled it
#: would be the most expensive query in the runtime and it would run more often
#: than any other. So the cheap half comes first: one `cache.add` decides
#: whether anybody is allowed to count at all right now, and fifty sends inside
#: five minutes cost fifty cache calls and no query.
PROBE_SECONDS = 300

#: What being past this limit actually costs, for the two limits the runtime
#: crosses on its own.
#:
#: Both are paragraphs rather than the one line `RESOURCES[...]["whenFull"]`
#: holds, and that is the whole reason they are still here: these two are
#: reached mid-conversation with nobody watching, so the notice is the only
#: account of it anybody gets, and what a reader cannot work out from a full bar
#: is which of the two applies to them — they are opposites, one says the bot
#: kept its promises and the other says it did not.
#:
#: Everything else falls through to `whenFull`, which is the sentence the
#: billing screen prints under the same bar. A limit refused at somebody who
#: asked has already been explained to them once, in the 402; the bell is the
#: record of it, and a record that disagreed with the screen would be worse
#: than a short one.
OVER_LIMIT_EFFECT = {
    "messages": (
        "Botlar javob berishda davom etmoqda — hech narsa to'xtamadi. "
        "Ortiqcha xabarlar shu oynada hisobda qoladi."
    ),
    "contacts": (
        "Yangi mijozlar saqlanmayapti — bot ularga javob beryapti, "
        "lekin ular Kontaktlar va Suhbatlarga tushmaydi."
    ),
}


#: Notice kind → the `NotificationSettings` column that switches it off.
#:
#: A kind that is not in here has no switch and always reaches the bell. That
#: is the safe default on purpose: adding a `Kind` should not silently make it
#: silenceable, and a new switch is a column, a row on the settings screen and
#: a sentence saying what it stops.
SWITCHES: dict[str, str] = {
    Notification.Kind.HANDOFF: "handoff",
    Notification.Kind.BILLING: "usage_warnings",
}

#: The limits whose "to'ldi" notice is raised even with the warnings switched off.
#:
#: One entry, and it is the difference between a warning and an alarm. Past the
#: `contacts` cap `engine.dispatch` stops filing the people writing to the bot:
#: they are answered and then they are gone — no row in Kontaktlar, no thread
#: in Suhbatlar, and a multi-step flow becomes a one-step one for them. A
#: workspace that ticked a box three months ago would have no witness to
#: customers going missing at all.
#:
#: `messages` is deliberately not here. Nothing stops when it fills —
#: `billing.services` says so in as many words — so that notice is news, and
#: news is exactly what a switch is for.
ALWAYS_WARN = frozenset({"contacts"})

#: What the panel has to say about the line above, in the words it says it in.
#: The rule lives in `ALWAYS_WARN`; this is the one sentence describing it, and
#: `apps.notifications.tests` holds the screen to the same string so the two
#: cannot drift into promising different things.
ALWAYS_WARN_SENTENCE = (
    "Kontaktlar limiti to'lganda — yangi mijozlar saqlanmay qolganda — "
    "ogohlantirish baribir keladi."
)


def notifications_allow(workspace, kind: str) -> bool:
    """Whether this workspace still wants to hear about `kind`.

    No row means yes. A settings table arriving in a migration must not silence
    the product for every tenant that existed before it.
    """
    column = SWITCHES.get(kind)
    if column is None:
        return True
    row = NotificationSettings.objects.filter(workspace=workspace).only(column).first()
    return True if row is None else bool(getattr(row, column))


def notify(*, workspace, title: str, text: str = "", kind: str = Notification.Kind.SYSTEM,
           href: str = "", icon: str = "bell-ringing", user=None, force: bool = False) -> Notification | None:
    """Raises one notice — a row someone can find later, and a push to whoever
    is looking right now — unless the workspace has switched that kind off.

    The switch is applied here rather than at each call site, so it is one
    decision and every future caller inherits it: `_handle_human` in the engine
    passes nothing and is covered. Nothing is written and nothing is pushed —
    filtering on read would leave the table filling up and the unread count
    counting rows the popover then refuses to show, which is its own bug report.

    `force` is for the notice a workspace is not allowed to mute. Its only user
    is `warn_about_usage`, for the one limit whose overrun costs customers
    rather than merely reporting a number — see `ALWAYS_WARN`.
    """
    if not force and not notifications_allow(workspace, kind):
        return None
    notification = Notification.objects.create(
        workspace=workspace, user=user, kind=kind, title=title, text=text, href=href, icon=icon
    )
    publish(
        workspace_group(workspace.id),
        "notification.created",
        {
            "id": notification.id,
            "kind": notification.kind,
            "title": notification.title,
            "text": notification.text,
            "href": notification.href,
            "icon": notification.icon,
            "at": notification.created_at.isoformat(),
        },
    )
    return notification


def _step_for(used: int, limit: int) -> str:
    """Which of the two things worth saying is true, if either."""
    if limit <= 0:
        # A plan that declares nought of something: any use of it at all is
        # already past the ceiling, and there is no fraction to be near.
        return "full" if used > 0 else ""
    if used >= limit:
        return "full"
    return "near" if used >= limit * WARN_AT else ""


def _sentence(workspace, resource: str, step: str, *, used: int, limit: int) -> tuple[str, str]:
    plan = plan_for(workspace)
    name = plan.name if plan else "Joriy"
    noun = RESOURCES[resource]["noun"]
    if step == "full":
        title = f"{noun.capitalize()} limiti to'ldi"
        # The screen's own sentence when there is no paragraph for this key —
        # see the note over `OVER_LIMIT_EFFECT`. Lower-cased on the way in
        # because it lands mid-body here and heads a bar over there.
        effect = OVER_LIMIT_EFFECT.get(resource) or _effect_of(resource)
        body = f"{name} tarifida {limit} ta limitdan {used} tasi ishlatildi. {effect}"
    else:
        title = f"{noun.capitalize()} limiti tugayapti"
        body = f"{name} tarifida {limit} ta limitdan {used} tasi ishlatildi."
    return title[:160], body.strip()[:280]


def _effect_of(resource: str) -> str:
    """`whenFull` with its own "Limit to'ldi" taken off — the title just said it."""
    sentence = RESOURCES[resource].get("whenFull", "")
    _, separator, rest = sentence.partition("—")
    return (rest.strip() if separator else sentence).capitalize()


def warn_about_usage(
    workspace, resource: str, *, used: int | None = None, limit: int | None = None
) -> Notification | None:
    """Tells the workspace that a limit is nearly gone, or gone. At most once a day.

    Returns the notification when one was raised and `None` every other time,
    which is nearly always — the caller is the runtime and is mid-send.

    `used` and `limit` are for the caller that already has them.
    `billing.check_plan_allows` counts both before it decides, so re-counting
    here would run the same query twice on every create in the product; and
    since there is then no expensive half to defer, the five-minute probe is
    skipped for those calls. That matters as well as saving a query: the probe
    is keyed per workspace and resource, and a create refused an hour into a
    busy afternoon must not be silent because the same limit was looked at
    four minutes ago.

    Nothing in here may reach the caller. It is called from the path that
    answers a customer, so a failure to *mention* a limit must not become a
    failure to answer: every exit is `None`, including the ones that are bugs,
    and the log line is where those are read. The same rule `record_inbound`
    keeps, for the same reason.

    A cache that is down is a deliberate silence rather than a fallback. The
    throttle is the only thing standing between this and a thirty-day
    `COUNT(*)` per message, so the moment it cannot be consulted the honest
    answer is to say nothing — an outage is exactly when the database must not
    be handed the runtime's busiest query.
    """
    if workspace is None or resource not in RESOURCES:
        return None
    counted = used is not None and limit is not None
    try:
        if not counted and not cache.add(f"usage-probe:{workspace.id}:{resource}", 1, PROBE_SECONDS):
            return None

        if limit is None:
            limit = plan_limit(workspace, resource)
        if limit is None:
            return None
        if used is None:
            used = current_usage(workspace, resource)
        step = _step_for(used, limit)
        if not step:
            return None
        # The one notice a workspace may not mute, and only when it is actually
        # full: 80% of the contacts cap is still advice.
        force = step == "full" and resource in ALWAYS_WARN
        # Asked here, before the day below is spent, and not left to `notify`.
        # A sentence that was never said has not been said: a workspace that
        # switches the warnings back on this afternoon has to hear about a
        # limit that is still full, rather than sitting out a 24-hour window
        # bought by a notice nobody received.
        if not force and not notifications_allow(workspace, Notification.Kind.BILLING):
            return None
        # A second gate, and a longer one: the probe above only decides how
        # often the question may be *asked*, this decides how often the same
        # answer may be said out loud. Keyed by step so that "nearly full" and
        # "full" are two notices and not one repeated.
        if not cache.add(f"usage-warned:{workspace.id}:{resource}:{step}", 1, WARN_WINDOW_SECONDS):
            return None

        title, text = _sentence(workspace, resource, step, used=used, limit=limit)
        return notify(
            workspace=workspace,
            kind=Notification.Kind.BILLING,
            title=title,
            text=text,
            href="/billing/usage",
            icon="warning",
            force=force,
        )
    except Exception:  # noqa: BLE001 — see the docstring
        logger.warning("could not warn %s about its %s limit", getattr(workspace, "id", "?"), resource, exc_info=True)
        return None
