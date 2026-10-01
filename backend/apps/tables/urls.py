from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("tables", views.TableViewSet, basename="table")

urlpatterns = [
    # Before the router, and stated as a literal rather than left to chance:
    # the detail route is `tables/<pk>/`, one segment, so `tables/hook/<secret>/`
    # cannot collide with it today — but the day somebody adds a route that
    # could, the explicit line is the one that keeps winning.
    path("tables/hook/<str:secret>/", views.hook, name="table-hook"),
    path("", include(router.urls)),
]
