"""Test settings: no Redis, no broker, no network.

The channel layer runs in memory and Celery tasks execute inline, so the same
code paths the workers use are exercised by `manage.py test` on a laptop with
nothing else running.
"""

from .base import *  # noqa: F403

DEBUG = False
TELEGRAM_OFFLINE = True
# The same promise for the model provider: no test may open a socket to it.
# Tests that need a particular model behaviour patch `agents.provider.complete`;
# tests about a machine with no key override this back to False.
AGENTS_OFFLINE = True

CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# The tests exercise the real, unshortened flow unless one of them says otherwise.
DEV_AUTO_VERIFY_EMAIL = False
DEV_EXPOSE_AUTH_CODES = False
