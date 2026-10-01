from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("api-keys", views.ApiKeyViewSet, basename="api-key")

urlpatterns = [path("", include(router.urls))]
