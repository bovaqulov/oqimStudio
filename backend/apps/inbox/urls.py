from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("inbox/conversations/", views.conversations, name="inbox-conversations"),
    path("inbox/conversations/<str:contact_id>/messages/", views.messages, name="inbox-messages"),
]
