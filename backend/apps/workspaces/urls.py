"""Workspace routes."""

from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("workspaces", views.WorkspaceViewSet, basename="workspace")
router.register("members", views.MembershipViewSet, basename="member")

urlpatterns = [
    path("workspaces/invite/<str:code>/", views.invite_preview, name="workspace-invite-preview"),
    path("workspaces/join/", views.join_workspace, name="workspace-join"),
    path("", include(router.urls)),
]
