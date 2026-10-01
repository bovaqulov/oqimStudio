"""Billing — what the workspace is on, what it has been charged, what it has used.

Limits live on the plan as data rather than in code so raising one is a row
edit, and the usage screen reads the same numbers the runtime enforces.
"""

from __future__ import annotations

from django.db import models

from apps.common.models import new_id
from apps.workspaces.models import Workspace


def default_limits() -> dict:
    """`null` means uncapped — the interface prints "cheksiz" and draws no bar.

    These keys are the whole vocabulary: `apps.billing.services.RESOURCES` both
    counts and enforces exactly them, and a plan that declares a key nobody
    counts caps nothing.
    """
    return {
        "bots": 3,
        "flows": 25,
        "messages": 50000,
        "contacts": 5000,
        "members": 5,
        "aiBlocks": 5,
        "scripts": 5,
    }


class Plan(models.Model):
    key = models.CharField(primary_key=True, max_length=32)
    name = models.CharField(max_length=64)
    description = models.CharField(max_length=280, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="UZS")
    #: Per-month caps, keyed the same way `UsageMetric.key` is in the frontend.
    limits = models.JSONField(default=default_limits)
    is_public = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "price"]

    def __str__(self) -> str:
        return self.name


class Subscription(models.Model):
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=32, default="Faol")
    status_tone = models.CharField(max_length=16, default="success")
    renews_at = models.DateField(null=True, blank=True)
    auto_renew = models.BooleanField(default=True)
    #: `null` while the plan is on a trial or an invoice agreement.
    payment_method = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.workspace_id} · {self.plan_id}"


class Invoice(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invoices")
    number = models.CharField(max_length=32)
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=8, default="UZS")
    status = models.CharField(max_length=32, default="To'langan")
    status_tone = models.CharField(max_length=16, default="success")

    class Meta:
        ordering = ["-date"]

    def __str__(self) -> str:
        return self.number
