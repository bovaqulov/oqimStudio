"""Which flow answers this update.

Candidates come from `FlowTrigger`, already ordered by the priority ladder the
editor shows, so this module only has to answer "does this rule actually match
this event" — the *order* was decided when the graph was saved.

The first rule that matches wins. That is the whole dispatch policy: a catch-all
never steals an update from the command block above it, and two blocks with the
same signature are settled by their position on the canvas.
"""

from __future__ import annotations

import re
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.flows.models import FlowTrigger

from .events import IncomingEvent

#: Which trigger kinds an event of each kind may match.
KIND_MAP: dict[str, set[str]] = {
    "message": {"start", "command", "keyword", "any", "media"},
    "callback": {"callback"},
    "join": {"groupjoin"},
    "leave": {"groupleave"},
    "join_request": {"joinrequest"},
    "channel_post": {"channelpost"},
    "reaction": {"reaction"},
    "payment": {"payment"},
    "webapp": {"webapp", "any"},
    "blocked": {"blocked"},
    "unblocked": {"unblocked"},
}


def _keyword_hit(trigger: FlowTrigger, text: str) -> bool:
    if not text:
        return False
    terms = [line.strip() for line in (trigger.keywords or "").splitlines() if line.strip()]
    if not terms:
        return False
    haystack = text.lower()

    if trigger.keyword_match == "regex":
        flags = 0
        if "i" in trigger.keyword_flags:
            flags |= re.IGNORECASE
        if "m" in trigger.keyword_flags:
            flags |= re.MULTILINE
        if "s" in trigger.keyword_flags:
            flags |= re.DOTALL
        for term in terms:
            try:
                if re.search(term, text, flags):
                    return True
            except re.error:
                # A pattern that no longer compiles must not take the bot down
                # with it; the block simply never fires until it is fixed.
                continue
        return False

    if trigger.keyword_match == "exact":
        return any(haystack == term.lower() for term in terms)
    return any(term.lower() in haystack for term in terms)


def _within_schedule(schedule: dict, workspace_timezone: str) -> bool:
    """Whether "now" falls inside (or outside) a business handler's window."""
    mode = schedule.get("mode") or "always"
    if mode == "always":
        return True

    zone = schedule.get("timezone") or workspace_timezone or "UTC"
    try:
        now = timezone.now().astimezone(ZoneInfo(zone))
    except Exception:  # noqa: BLE001 - an unknown zone must not break routing
        now = timezone.now()

    days = schedule.get("days") or [1, 2, 3, 4, 5]
    start = _parse_clock(schedule.get("from") or "09:00")
    end = _parse_clock(schedule.get("to") or "18:00")
    current = now.time()

    if start <= end:
        inside_hours = start <= current < end
        day_matches = now.isoweekday() in days
    else:
        # A window that crosses midnight belongs to the day it started on.
        inside_hours = current >= start or current < end
        day_matches = now.isoweekday() in days or (current < end and (now.isoweekday() - 1 or 7) in days)

    inside = day_matches and inside_hours
    return inside if mode == "inside" else not inside


def _parse_clock(value: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError:
        return time(0, 0)


def matches(trigger: FlowTrigger, event: IncomingEvent, workspace_timezone: str = "UTC") -> bool:
    """Does this rule claim this update?"""
    if trigger.kind not in KIND_MAP.get(event.kind, set()):
        return False
    if trigger.schedule and not _within_schedule(trigger.schedule, workspace_timezone):
        return False

    kind = trigger.kind
    if kind == FlowTrigger.Kind.START:
        return event.command == "start"
    if kind == FlowTrigger.Kind.COMMAND:
        wanted = (trigger.command or "").lower()
        return bool(event.command) and (event.command == wanted if wanted else True)
    if kind == FlowTrigger.Kind.KEYWORD:
        return _keyword_hit(trigger, event.text)
    if kind == FlowTrigger.Kind.MEDIA:
        wanted = set(trigger.media_kinds or [])
        return bool(event.media & wanted) if wanted else bool(event.media)
    if kind == FlowTrigger.Kind.ANY:
        # Anything a person actually said, service messages aside. /start is not
        # excluded here: the priority ladder already puts a real /start handler
        # ahead of the fallback, and a bot that has none should still answer
        # rather than sit silent on the one command every user tries first.
        return bool(event.text or event.media)
    # Event kinds (callback, reaction, payment, webapp, join…) carry their own
    # update; arriving at all is the match.
    return True


def find_trigger(bot, event: IncomingEvent) -> FlowTrigger | None:
    """The winning rule for this update, or None when nothing claims it."""
    module_key = event.module_key
    if not bot.module_enabled(module_key):
        return None

    candidates = (
        FlowTrigger.objects.filter(
            bot=bot,
            module_key=module_key,
            kind__in=KIND_MAP.get(event.kind, set()),
            flow__enabled=True,
        )
        .select_related("flow")
        # The last two keys are the tie-break: two blocks with the same
        # signature would otherwise be ordered by whatever the database
        # returned first, and a bot that answers differently on Tuesday is
        # worse than one that answers wrongly every time.
        .order_by("priority", "order", "flow__created_at", "id")
    )
    workspace_timezone = bot.workspace.timezone
    for trigger in candidates:
        if matches(trigger, event, workspace_timezone):
            return trigger
    return None
