"""Analytics — one event log, read back as reports.

Every number the product shows is an aggregate over rows in `Event`: nothing is
incremented in place, so a figure can always be explained by listing the events
behind it. The indexes below are what make that affordable — a report asks for
one workspace, one date range and one metric at a time.

There is deliberately no pre-aggregated daily table yet. It would only pay for
itself once the log is pruned behind it (otherwise the two have to be summed
without double-counting, which is where such tables go wrong), and pruning is a
retention decision nobody has made.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.common.models import new_id
from apps.workspaces.models import Workspace


class Metric(models.TextChoices):
    """The measures the product reports on. Mirrors `MetricKey` in the frontend."""

    CONVERSATION = "conversations", "Suhbatlar"
    NEW_CONTACT = "newContacts", "Yangi kontaktlar"
    MESSAGE = "messages", "Yuborilgan xabar"
    CLICK = "clicks", "Tugma bosilishi"
    HANDOFF = "handoffs", "Operatorga o'tdi"
    CONVERSION = "conversions", "Maqsadli amal"
    REVENUE = "revenue", "Tushum"


#: Traffic sources a contact can arrive through, as the filter bar lists them.
TRAFFIC_SOURCES = [
    ("organic", "Organik"),
    ("ads", "Reklama"),
    ("campaign", "Kampaniya"),
    ("referral", "Tavsiya"),
    ("direct", "To'g'ridan-to'g'ri"),
]


class Event(models.Model):
    """One measurable thing that happened.

    `value` is 1 for a count and the money amount for revenue — one column, so
    a new metric never needs a new table.
    """

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="events")
    project_id = models.CharField(max_length=64, blank=True, db_index=True)
    bot_id = models.CharField(max_length=64, blank=True, db_index=True)
    flow_id = models.CharField(max_length=64, blank=True, db_index=True)
    contact_id = models.CharField(max_length=40, blank=True)
    #: Which of the five modules the event happened on — the "channel" filter.
    module_key = models.CharField(max_length=16, blank=True)
    source = models.CharField(max_length=32, blank=True)

    metric = models.CharField(max_length=24, choices=Metric.choices)
    value = models.DecimalField(max_digits=14, decimal_places=2, default=1)
    currency = models.CharField(max_length=8, blank=True)

    occurred_at = models.DateTimeField(default=timezone.now)
    #: Denormalised date in the workspace's own zone, which is what a report is grouped by.
    occurred_on = models.DateField(db_index=True)

    class Meta:
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["workspace", "occurred_on", "metric"]),
            models.Index(fields=["workspace", "flow_id", "occurred_on"]),
        ]

    def __str__(self) -> str:
        return f"{self.metric}@{self.occurred_on}"
