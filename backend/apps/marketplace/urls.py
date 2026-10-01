from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("market/templates", views.TemplateViewSet, basename="market-template")

urlpatterns = [path("", include(router.urls))]
