"""HTTP routes.

Everything the interface talks to lives under `/api/`; each feature owns its
own `urls.py` so adding a surface is one include here and nothing else.
"""

from __future__ import annotations

from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from apps.common.health import run_checks


def health(request):
    """What is working, part by part.

    `?deep=0` keeps the old liveness answer: no dependencies touched, so a load
    balancer can still tell the process apart from the things behind it. The
    default is the full check, because "is the site up" was never the question
    anybody needed answered — the bots went quiet while it said yes.
    """
    if request.GET.get("deep") == "0":
        return JsonResponse({"ok": True, "service": "oqim-backend"})

    healthy, checks = run_checks()
    return JsonResponse(
        {"ok": healthy, "service": "oqim-backend", "checks": checks},
        status=200 if healthy else 503,
    )


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.workspaces.urls")),
    path("api/", include("apps.projects.urls")),
    path("api/", include("apps.bots.urls")),
    path("api/", include("apps.contacts.urls")),
    path("api/", include("apps.inbox.urls")),
    path("api/", include("apps.flows.urls")),
    path("api/", include("apps.tables.urls")),
    path("api/", include("apps.media.urls")),
    path("api/", include("apps.agents.urls")),
    path("api/", include("apps.analytics.urls")),
    path("api/", include("apps.billing.urls")),
    path("api/", include("apps.notifications.urls")),
    path("api/", include("apps.marketplace.urls")),
    path("api/", include("apps.realtime.urls")),
    path("api/", include("apps.apikeys.urls")),
    path("api/telegram/", include("apps.telegram.urls")),
    # The open API, and the one include here that is not the interface's.
    # Under a version segment of its own because it is a promise to callers
    # nobody in this repository controls: `/api/…` moves when the editor moves,
    # and `/api/v1/…` must not. See `apps/publicapi/views.py` for why it is a
    # separate app with its own thin views rather than an alias.
    path("api/v1/", include("apps.publicapi.urls")),
]
