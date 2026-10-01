"""Importing the Celery app here is what makes `@shared_task` work.

Django imports this package on start-up, so the app instance exists before any
module reaches for it — the workers and the web process end up with the same
one configured the same way.
"""

from .celery import app as celery_app

__all__ = ("celery_app",)
