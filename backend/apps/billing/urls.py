from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("billing/plans/", views.plans, name="billing-plans"),
    path("billing/subscription/", views.subscription, name="billing-subscription"),
    path("billing/invoices/", views.invoices, name="billing-invoices"),
    path("billing/usage/", views.usage, name="billing-usage"),
]
