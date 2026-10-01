from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("notifications", views.NotificationViewSet, basename="notification")

urlpatterns = [
    path("notification-settings/", views.notification_settings, name="notification-settings"),
    path("", include(router.urls)),
]
