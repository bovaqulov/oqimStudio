"""Local development: SQLite, console email, debug on — but not on a tunnel.

A dev box reached only from `localhost` can afford `DEBUG=True`: the technical
404 page listing every route is a feature there. The moment the same process is
published through ngrok or cloudflared it is on the open internet, and that page
becomes a map of the API handed to whoever typed a wrong path — which is exactly
what happened on the QA stand.

So debug is not decided by the environment file alone: a public origin turns it
off unless it is asked for by name, and `ALLOWED_HOSTS` names hosts instead of
accepting all of them.
"""

from .base import *  # noqa: F403
from .base import env_bool, env_list, env_str, host_of

#: Where this backend is reachable from outside, when it is. Empty on a laptop.
PUBLIC_HOST = host_of(env_str("PUBLIC_BASE_URL", ""))
LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "0.0.0.0", "[::1]"}
IS_PUBLISHED = PUBLIC_HOST not in LOCAL_HOSTS

# On a laptop, debug as usual. Published, it takes a second variable named for
# what it actually does — `DJANGO_DEBUG=1` is in every dev `.env` ever written,
# so it cannot be the thing that decides to publish tracebacks to the internet.
DEBUG = env_bool("DJANGO_DEBUG", True) and (not IS_PUBLISHED or env_bool("DJANGO_DEBUG_PUBLIC", False))

# A tunnel terminates TLS and forwards plain HTTP to this process, so Django
# believes every request is insecure and builds every absolute URL as `http://`.
# The open API is where that shows: DRF's pagination writes `next` with
# `build_absolute_uri`, so a caller reading a tunnelled stand gets
# `http://<tunnel>/api/v1/flows/?offset=50` — a link the tunnel will not serve
# and some clients refuse to follow at all. `prod.py` has trusted this header
# since it was written; a published dev stand is the same deployment shape and
# needs the same line.
#
# Only when published. On a laptop reached directly there is no proxy to trust,
# and `X-Forwarded-Proto: https` would be a header anybody could send.
if IS_PUBLISHED:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# `base.py` derives these from *its* DEBUG, which was read before the line
# above could turn it off — so they are derived again from the real answer.
# Without this a published stand still hands out verification codes over the
# API, which is the same leak in a different shape.
DEV_AUTO_VERIFY_EMAIL = env_bool("DEV_AUTO_VERIFY_EMAIL", False) and DEBUG
DEV_EXPOSE_AUTH_CODES = DEBUG

#: Named, not "*": a Host header nothing recognises is a request for somebody
#: else's site arriving here, and answering it is how cache poisoning starts.
ALLOWED_HOSTS = sorted(
    {
        *env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1"),
        "localhost",
        "127.0.0.1",
        "testserver",
        *([PUBLIC_HOST] if PUBLIC_HOST else []),
        *[host_of(origin) for origin in env_list("CSRF_TRUSTED_ORIGINS") if host_of(origin)],
    }
)

# The tunnel the backend answers on has to be trusted for CSRF too — the admin
# and the session endpoints post to it.
CSRF_TRUSTED_ORIGINS = sorted(
    {
        *env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"),
        *([env_str("PUBLIC_BASE_URL", "")] if IS_PUBLISHED else []),
    }
)

# In-process cache on a laptop, because tying the login screen to a running
# Redis makes the API unusable while the broker is down — a normal state during
# development.
#
# The script concurrency cap is counted here too (`engine.script.concurrency`),
# and in-process is not what it means in production: on a dev stand Daphne and
# each Celery worker keep a count of their own, so `SCRIPT_MAX_CONCURRENT` is
# eight *per process* rather than eight for the machine. Fine for a laptop with
# one conversation on it, and the reason the cap cannot be judged from here —
# point `CACHE_URL` at Redis to see the real one.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
