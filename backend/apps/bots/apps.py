import os
import sys

from django.apps import AppConfig


class BotsConfig(AppConfig):
    """Telegram botlar va ularning sozlamalari."""

    name = "apps.bots"
    label = "bots"

    def ready(self) -> None:
        """Re-points every bot's webhook at this deployment as the server boots.

        A worker already does this (`config.celery.reconcile_webhooks_on_boot`),
        but the two processes are started separately and read the environment
        separately — which is exactly how a stale `PUBLIC_BASE_URL` in one of
        them spent an afternoon quietly pointing live bots back at a tunnel that
        no longer resolved. Whoever comes up last wins, and both now agree.

        The work is handed to the queue rather than done here: `ready()` runs
        inside the import that builds the app, and a network call there would
        make Telegram's latency the server's startup time — and Telegram being
        slow a reason the site does not come up at all.
        """
        if not _serving():
            return
        try:
            from .tasks import reconcile_webhooks_task

            reconcile_webhooks_task.delay()
        except Exception:  # noqa: BLE001 - a broker that is down must not stop the server
            pass


def _serving() -> bool:
    """Whether this process is going to answer requests.

    `ready()` also runs for `migrate`, `test`, `makemigrations` and every other
    management command, and none of them should be telling Telegram anything.
    """
    if os.environ.get("BOTS_RECONCILE_ON_START", "1") not in {"1", "true", "yes", "on"}:
        return False
    argv = sys.argv
    if len(argv) > 1 and argv[1] in {"runserver", "daphne"}:
        # `runserver` without `--noreload` boots twice; only the child serves.
        return argv[1] != "runserver" or "--noreload" in argv or os.environ.get("RUN_MAIN") == "true"
    # A real ASGI/WSGI server (daphne, gunicorn, uvicorn) imported us instead.
    return not argv or "manage.py" not in argv[0]
