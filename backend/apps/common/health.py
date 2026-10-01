"""What is actually working, right now.

One endpoint that answers separately for each moving part, because "the site is
up" is the least useful thing a health check can say. The outage this exists
for looked exactly like a healthy service: Django answered, the panel rendered,
and every bot had quietly stopped replying because the queue behind them was
gone.

Every check is bounded and independent — a probe that hangs is a probe that
takes the page down with whatever it was checking.
"""

from __future__ import annotations

import time
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.db import connection


def _timed(check) -> dict[str, Any]:
    started = time.monotonic()
    try:
        detail = check()
        ok = True
    except Exception as exc:  # noqa: BLE001 - a failed probe is a result, not a crash
        detail = f"{type(exc).__name__}: {exc}"[:200]
        ok = False
    return {"ok": ok, "detail": detail, "ms": round((time.monotonic() - started) * 1000)}


def check_database() -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return "ulandi"


def check_cache() -> str:
    cache.set("health", "1", 5)
    return "ishlayapti" if cache.get("health") == "1" else "javob bermadi"


def check_broker() -> str:
    """Redis, as the queue sees it — not as a socket test sees it."""
    from kombu import Connection

    with Connection(settings.CELERY_BROKER_URL, connect_timeout=2) as conn:
        conn.ensure_connection(max_retries=0, timeout=2)
    return "ulandi"


def check_workers() -> str:
    """Whether anything is actually consuming the queue.

    A broker with no worker behind it accepts tasks and never runs them, which
    is the failure that looks most like everything being fine.
    """
    from config.celery import app

    replies = app.control.ping(timeout=1.5) or []
    if not replies:
        raise RuntimeError("worker javob bermadi")
    names = ", ".join(name for reply in replies for name in reply)
    return f"{len(replies)} ta worker: {names}"


#: Checks whose failure means the product cannot do its job. The cache is not
#: one of them — throttling degrades, nothing stops.
CRITICAL = {"database", "broker", "workers"}


def run_checks() -> tuple[bool, dict[str, Any]]:
    checks = {
        "database": _timed(check_database),
        "cache": _timed(check_cache),
        "broker": _timed(check_broker),
        "workers": _timed(check_workers),
    }
    healthy = all(checks[name]["ok"] for name in CRITICAL)
    return healthy, checks
