"""The Celery application.

Every setting comes from Django under the `CELERY_` prefix (see
`config/settings/base.py`), so there is exactly one place to change the broker
or the timezone.
"""

from __future__ import annotations

import os

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_ready

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("oqim")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Scheduled work. Beat has to be running for these: `celery -A config beat`.
app.conf.beat_schedule = {
    # Runs parked on a "Kutish" block whose wake-up task was lost (a worker
    # killed mid-flight, a broker restart) are picked back up here.
    "engine-resume-due-runs": {
        "task": "apps.engine.tasks.resume_due_runs",
        "schedule": 60.0,
    },
    # Delivery records outlive their usefulness within a day or two.
    "engine-forget-old-updates": {
        "task": "apps.engine.tasks.forget_old_updates",
        "schedule": crontab(hour=3, minute=20),
    },
    # Telegram forgets a webhook whose endpoint kept failing; this notices.
    # Every ten minutes rather than hourly: a bot that stopped receiving is not
    # a thing to discover fifty minutes later, and a pass where nothing moved
    # costs one `getWebhookInfo` per bot.
    "bots-check-webhooks": {
        "task": "apps.bots.tasks.reconcile_webhooks",
        "schedule": 600.0,
    },
}


@worker_ready.connect
def reconcile_webhooks_on_boot(**_kwargs) -> None:
    """Re-points every bot's webhook at this deployment as soon as a worker starts.

    The address a webhook was registered at is only true until the next
    deployment or the next tunnel. Between the move and the hourly check, every
    bot is silent and the panel has no way to know — so booting is treated as
    "the address may have changed", which is the one moment we can be sure of.
    """
    from apps.bots.tasks import reconcile_webhooks_task

    reconcile_webhooks_task.delay()
