"""Writing events, and reading them back as a report.

`record_event` is the only way a number gets into the product. Everything the
analytics screen shows — totals, the series, the funnel, every breakdown — is
an aggregate over these rows, which is why a figure can always be explained by
listing the events behind it.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from django.db.models import Sum
from django.utils import timezone

from .models import TRAFFIC_SOURCES, Event, Metric

#: The measures, in the order the summary row shows them.
METRIC_ORDER = [
    Metric.CONVERSATION,
    Metric.NEW_CONTACT,
    Metric.MESSAGE,
    Metric.CLICK,
    Metric.HANDOFF,
    Metric.CONVERSION,
    Metric.REVENUE,
]

METRIC_LABELS = {
    Metric.CONVERSATION: "Suhbatlar",
    Metric.NEW_CONTACT: "Yangi kontaktlar",
    Metric.MESSAGE: "Yuborilgan xabar",
    Metric.CLICK: "Tugma bosilishi",
    Metric.HANDOFF: "Operatorga o'tdi",
    Metric.CONVERSION: "Maqsadli amal",
    Metric.REVENUE: "Tushum",
}

MODULE_LABELS = {
    "business": "Business",
    "groups": "Guruh",
    "channels": "Kanal",
    "dms": "Bot ichida",
    "webapp": "Web App",
}


def workspace_zone(workspace) -> ZoneInfo:
    """The zone this tenant's own days are measured in.

    `TIME_ZONE` is UTC and a workspace's is not — Tashkent is five hours ahead
    — so anything that prints or groups a moment has to come through here or it
    will disagree with the rest of the product by up to a day.
    """
    try:
        return ZoneInfo(workspace.timezone)
    except Exception:  # noqa: BLE001 - an unknown zone must not stop a write
        return ZoneInfo("UTC")


def workspace_today(workspace) -> date:
    """Today in the workspace's own zone — the day a report is grouped by."""
    return timezone.now().astimezone(workspace_zone(workspace)).date()


def record_event(
    *,
    metric: str,
    workspace=None,
    flow=None,
    bot=None,
    contact=None,
    value: float | Decimal = 1,
    currency: str = "",
    source: str = "",
    module_key: str = "",
) -> Event | None:
    """Records one measurable thing. Silently no-ops when there is no tenant to attribute it to."""
    workspace = workspace or getattr(flow, "workspace", None) or getattr(bot, "workspace", None)
    if workspace is None:
        return None

    bot = bot or getattr(flow, "bot", None)
    return Event.objects.create(
        workspace=workspace,
        project_id=getattr(flow, "project_id", "") or getattr(bot, "project_id", "") or "",
        bot_id=getattr(bot, "id", "") or "",
        flow_id=getattr(flow, "id", "") or "",
        contact_id=getattr(contact, "id", "") or "",
        module_key=module_key or getattr(flow, "module_key", "") or "",
        source=source or getattr(contact, "source", "") or "",
        metric=metric,
        value=Decimal(str(value)),
        currency=currency,
        occurred_on=workspace_today(workspace),
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _empty_totals() -> dict[str, float]:
    return {metric: 0.0 for metric in METRIC_ORDER}


def _parse_date(value: str | None, fallback: date) -> date:
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return fallback


def parse_query(params, workspace) -> dict[str, Any]:
    """Reads the filter bar's parameters. Same names as the frontend sends."""
    today = workspace_today(workspace)
    to = _parse_date(params.get("to"), today)
    frm = _parse_date(params.get("from"), to - timedelta(days=13))
    if frm > to:
        frm, to = to, frm
    return {
        "projectId": params.get("projectId") or None,
        "botId": params.get("botId") or None,
        "flowId": params.get("flowId") or None,
        "sourceId": params.get("sourceId") or None,
        "channelId": params.get("channelId") or None,
        "from": frm.isoformat(),
        "to": to.isoformat(),
    }


def _filtered_events(workspace, query: dict, frm: date, to: date):
    rows = Event.objects.filter(workspace=workspace, occurred_on__gte=frm, occurred_on__lte=to)
    if query.get("projectId"):
        rows = rows.filter(project_id=query["projectId"])
    if query.get("botId"):
        rows = rows.filter(bot_id=query["botId"])
    if query.get("flowId"):
        rows = rows.filter(flow_id=query["flowId"])
    if query.get("sourceId"):
        rows = rows.filter(source=query["sourceId"])
    if query.get("channelId"):
        rows = rows.filter(module_key=query["channelId"])
    return rows


def _totals(rows) -> dict[str, float]:
    totals = _empty_totals()
    for row in rows.values("metric").annotate(total=Sum("value")):
        totals[row["metric"]] = float(row["total"] or 0)
    return totals


#: The bucket every event whose subject the workspace no longer has falls into.
#: Not a real id — nothing is ever filtered or linked by it.
DELETED_BUCKET = "__deleted__"


def _breakdown(
    rows,
    field: str,
    labels: dict[str, str],
    href: str = "",
    *,
    missing: str,
    deleted: str = "",
) -> list[dict]:
    """One breakdown table: every distinct value of `field`, with its metrics.

    Two of the values are not names of anything and the table has to say so
    rather than print them:

    * The empty one. `dispatch` counts a button tap and a new contact before
      anything has decided which flow will answer, so those rows carry no
      `flow_id` at all — a real bucket, and it is called what it is
      (`missing`) instead of "—".
    * An id the workspace no longer has. A deleted flow keeps the events it
      produced, and `labels` cannot name it, so the table printed the raw
      `e72a54639ce3bee5` and linked it to a page that 404s. They collapse into
      one unlinked row: their traffic is worth reading together and there is
      nothing to act on in any of them separately.
    """
    buckets: dict[str, dict[str, float]] = {}
    for row in rows.values(field, "metric").annotate(total=Sum("value")):
        key = row[field] or ""
        if key and deleted and key not in labels:
            key = DELETED_BUCKET
        bucket = buckets.setdefault(key, _empty_totals())
        # Added, not assigned: several deleted subjects share one bucket, and
        # the second one's numbers must not replace the first one's.
        bucket[row["metric"]] += float(row["total"] or 0)

    conversations = sum(bucket[Metric.CONVERSATION] for bucket in buckets.values()) or 0
    result = []
    for key, metrics in buckets.items():
        own = metrics[Metric.CONVERSATION]
        if key == DELETED_BUCKET:
            label = deleted
        elif not key:
            label = missing
        else:
            label = labels.get(key, key)
        result.append(
            {
                "id": key or "—",
                "label": label,
                # Only a subject that still exists has a page to open.
                **({"href": href.format(id=key)} if href and key in labels else {}),
                "metrics": metrics,
                "share": round(own / conversations * 100, 1) if conversations else 0.0,
                "conversionRate": round(metrics[Metric.CONVERSION] / own * 100, 1) if own else 0.0,
            }
        )
    return sorted(result, key=lambda row: row["metrics"][Metric.CONVERSATION], reverse=True)


#: The funnel's steps, in order, and what each one calls the people who reached it.
#:
#: Counted in people — distinct contacts — and not in events, because the four
#: measures this used to stack count four different things: a `conversations`
#: row is one flow run, `newContacts` one person, `clicks` one button tap and
#: `conversions` one payment. Eighteen taps over twelve runs is 150%, and the
#: `min(100, …)` that used to sit here turned that into a third step wider than
#: the second one and still reading "100%". Clamping a ratio whose numerator
#: and denominator count different populations hides the fault; it does not fix
#: it.
#:
#: `newContacts` is not a stage at all — a returning customer never becomes a
#: new contact, so it is a segment of the people in the first step rather than
#: something between two of them. It keeps its own summary tile.
FUNNEL_STEPS = [
    (Metric.CONVERSATION, "Suhbat boshlaganlar"),
    (Metric.CLICK, "Tugma bosganlar"),
    (Metric.CONVERSION, "Maqsadga yetganlar"),
]


def _funnel(rows) -> list[dict]:
    """How far the people who wrote to the bot got.

    Each step is the people from the step above it who also did this, so a step
    can only be a subset of the one before it and the percentages can only
    descend. Every percentage is a share of the same widest step — everyone who
    started a conversation in this window — which is the one denominator the
    old funnel did not have.

    An event carrying no contact cannot be placed in a funnel of people and is
    left out of it; the totals above still count it.
    """
    reached: set[str] | None = None
    steps: list[dict] = []
    for metric, label in FUNNEL_STEPS:
        did = set(rows.filter(metric=metric).exclude(contact_id="").values_list("contact_id", flat=True))
        reached = did if reached is None else reached & did
        steps.append({"key": metric, "label": label, "value": len(reached), "percent": 0.0})

    base = steps[0]["value"]
    for step in steps:
        step["percent"] = round(step["value"] / base * 100, 1) if base else 0.0
    return steps


def build_report(workspace, query: dict) -> dict[str, Any]:
    """The `AnalyticsReport` the interface renders, in its own field names."""
    frm = date.fromisoformat(query["from"])
    to = date.fromisoformat(query["to"])
    span = (to - frm).days + 1

    rows = _filtered_events(workspace, query, frm, to)
    totals = _totals(rows)

    # The same window immediately before this one, for the delta on each tile.
    previous = _totals(_filtered_events(workspace, query, frm - timedelta(days=span), frm - timedelta(days=1)))

    daily: dict[str, dict[str, float]] = {
        (frm + timedelta(days=offset)).isoformat(): _empty_totals() for offset in range(span)
    }
    for row in rows.values("occurred_on", "metric").annotate(total=Sum("value")):
        key = row["occurred_on"].isoformat()
        if key in daily:
            daily[key][row["metric"]] = float(row["total"] or 0)

    summary = []
    for metric in METRIC_ORDER:
        current, before = totals[metric], previous[metric]
        summary.append(
            {
                "key": metric,
                "label": METRIC_LABELS[metric],
                "value": current,
                "format": "currency" if metric == Metric.REVENUE else "count",
                "previousValue": before,
                # No previous number is not a 0% change — it is nothing to
                # compare with, and the tile says so.
                "deltaPercent": round((current - before) / before * 100, 1) if before else None,
            }
        )

    from apps.bots.models import Bot
    from apps.flows.models import Flow

    flow_labels = dict(Flow.objects.filter(workspace=workspace).values_list("id", "name"))
    bot_labels = dict(Bot.objects.filter(workspace=workspace).values_list("id", "handle"))

    return {
        "query": query,
        "scopeLabel": _scope_label(query, span, flow_labels, bot_labels),
        "totals": totals,
        "summary": summary,
        "series": [{"date": day, "metrics": metrics} for day, metrics in daily.items()],
        "funnel": _funnel(rows),
        "breakdown": {
            "flows": _breakdown(
                rows,
                "flow_id",
                flow_labels,
                "/flows/{id}",
                missing="Oqimga bog'lanmagan",
                deleted="O'chirilgan oqimlar",
            ),
            "bots": _breakdown(rows, "bot_id", bot_labels, missing="Botsiz", deleted="O'chirilgan botlar"),
            # A module key and a traffic source are names the product writes
            # itself, not ids of rows anyone can delete — an unknown one is
            # worth showing as it is rather than calling it deleted.
            "channels": _breakdown(rows, "module_key", MODULE_LABELS, missing="Bo'lim ko'rsatilmagan"),
            "sources": _breakdown(rows, "source", dict(TRAFFIC_SOURCES), missing="Manba noma'lum"),
        },
        "currency": workspace.currency,
    }


def _scope_label(query: dict, span: int, flow_labels: dict, bot_labels: dict) -> str:
    if query.get("flowId"):
        subject = flow_labels.get(query["flowId"], "Oqim")
    elif query.get("botId"):
        subject = bot_labels.get(query["botId"], "Bot")
    elif query.get("channelId"):
        subject = MODULE_LABELS.get(query["channelId"], "Bo'lim")
    else:
        subject = "Barcha oqimlar"
    return f"{subject} · {span} kun"


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

#: How many payments one read of the history hands back, and how far `?limit=`
#: may push it. This feeds a panel, not an export: fifty is more than an owner
#: scrolls through in one sitting, and the ceiling keeps a mistyped parameter
#: from asking for a year of a busy shop's takings in one response.
PAYMENT_HISTORY_LIMIT = 50
PAYMENT_HISTORY_MAX = 200

#: Stands in when the payer's contact row is gone. The money still moved, so
#: the row keeps its place in the list rather than being dropped for want of a
#: name.
UNKNOWN_PAYER = "Noma'lum mijoz"


def bot_payments(workspace, bot_id: str, limit: int = PAYMENT_HISTORY_LIMIT) -> list[dict]:
    """What one bot has actually been paid, newest first.

    There is no payments table behind this on purpose: `dispatch` already
    writes a `revenue` event the moment Telegram confirms a charge, so the
    money is in the same log every report is built from, and a second copy of
    those facts would be one more thing to keep in step with it.

    What an `Event` cannot answer is what was bought, which provider took the
    money and Telegram's `provider_payment_charge_id`. Those are worth a
    migration the day the panel has to show them; inventing them here would be
    worse than leaving them out.
    """
    from apps.contacts.models import Contact

    zone = workspace_zone(workspace)
    rows = list(
        Event.objects.filter(workspace=workspace, bot_id=bot_id, metric=Metric.REVENUE)
        .order_by("-occurred_at")[: max(1, min(limit, PAYMENT_HISTORY_MAX))]
    )

    # One query for everyone on the page rather than one per row: fifty
    # payments from fifty different customers is the ordinary case here, not
    # the pathological one.
    payers = {
        contact.id: contact.display_name
        for contact in Contact.objects.filter(id__in={row.contact_id for row in rows if row.contact_id})
    }

    return [
        {
            "id": row.id,
            "contactName": payers.get(row.contact_id) or UNKNOWN_PAYER,
            "amount": float(row.value),
            "currency": row.currency,
            # Moved into the workspace's own zone before it is printed. Every
            # report groups the same event under `occurred_on`, a workspace
            # day, so a Tashkent evening payment sent as UTC would show here
            # under yesterday's date and contradict the numbers next to it.
            "occurredAt": row.occurred_at.astimezone(zone).isoformat(),
        }
        for row in rows
    ]
