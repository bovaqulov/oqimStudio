from django.urls import path

from . import views

urlpatterns = [
    path("realtime/ticket/", views.workspace_ticket, name="realtime-ticket"),
]
