from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("webhook/<str:token>/", views.webhook, name="telegram-webhook"),
]
