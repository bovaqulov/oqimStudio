from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("analytics/", views.report, name="analytics-report"),
    path("analytics/dimensions/", views.dimensions, name="analytics-dimensions"),
]
