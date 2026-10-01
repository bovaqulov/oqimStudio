from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("agents", views.AgentViewSet, basename="agent")

urlpatterns = [path("", include(router.urls))]
