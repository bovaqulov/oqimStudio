"""The template market: what a workspace can install instead of building.

A template carries a whole graph, so installing one is a copy into a new flow —
the market never becomes a live dependency of the flow that came out of it.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.common.models import new_id
from apps.workspaces.models import Workspace


class MarketTemplate(models.Model):
    class Category(models.TextChoices):
        SALES = "sales", "Sotuv"
        SUPPORT = "support", "Qo'llab-quvvatlash"
        CONTENT = "content", "Kontent"
        AI = "ai", "AI"

    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    name = models.CharField(max_length=120)
    icon = models.CharField(max_length=48, default="puzzle-piece")
    description = models.CharField(max_length=280)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.SALES)
    #: Author of the template — a person or a studio, not the installing workspace.
    author = models.CharField(max_length=120)
    module_key = models.CharField(max_length=16, default="dms")
    installs = models.PositiveIntegerField(default=0)
    #: 0 for a free template.
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="UZS")
    #: Telegram modules the template needs — shown before install so a mismatch is caught early.
    requires = models.JSONField(default=list)
    #: The blocks it lays down, in order, for the preview panel.
    preview = models.JSONField(default=list)
    #: The graph an install copies.
    nodes = models.JSONField(default=list)
    edges = models.JSONField(default=list)
    is_published = models.BooleanField(default=True)
    #: True for the rows `seed_demo` puts on the shelf.
    #:
    #: Their author, their install count and their reviews are invented, and a
    #: catalogue is the one screen where those three numbers are the whole
    #: basis for choosing. Unmarked, «O'rnatishlar 1 240» and a five-star
    #: review from last week read as a template thousands of workspaces are
    #: using. The workspace already carries the same flag for the same reason
    #: (`Workspace.is_demo`), and `clear_demo` deletes these rows outright.
    is_demo = models.BooleanField(default=False)
    #: Set when a workspace published it — null for the ones that ship with the product.
    owner_workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="templates", null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-installs"]

    def __str__(self) -> str:
        return self.name

    @property
    def rating(self) -> float:
        scores = list(self.reviews.values_list("rating", flat=True))
        return round(sum(scores) / len(scores), 1) if scores else 0.0


class TemplateReview(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    template = models.ForeignKey(MarketTemplate, on_delete=models.CASCADE, related_name="reviews")
    author_name = models.CharField(max_length=120)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    rating = models.PositiveSmallIntegerField()
    text = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.template_id} · {self.rating}"
