"""Server settings. Everything secret is required from the environment."""

from .base import *  # noqa: F403
from .base import env_bool, env_str

DEBUG = False

SECRET_KEY = env_str("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY is required in production")

SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# `manage.py check --deploy` refuses the console mailer here on purpose: a
# server that prints password-reset links to a log instead of sending them
# locks people out of their accounts silently.

# Belt and braces: `base.py` already ANDs these with DEBUG, which is False here.
DEV_AUTO_VERIFY_EMAIL = False
DEV_EXPOSE_AUTH_CODES = False
