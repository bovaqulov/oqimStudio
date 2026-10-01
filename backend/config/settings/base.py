"""Settings shared by every environment.

Everything that differs between a laptop and a server is read from the
environment (see `.env.example`), never branched on in code: the same image
runs in both places and only the values around it change.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/config/settings/base.py -> backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env")


def env_str(name: str, default: str = "") -> str:
    """An empty value in `.env` means "not set" — the key is there as a hint,
    and a blank line under it must not override the default with nothing."""
    return os.environ.get(name, "").strip() or default


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    """An integer from the environment, falling back when unset or unparseable."""
    raw = env_str(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env_str(name, default).split(",") if item.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")


def host_of(url: str) -> str:
    """The bare hostname in a URL. "" when there is no URL to read one from.

    Used to keep `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` honest without
    asking anyone to write the same tunnel name into three variables.
    """
    from urllib.parse import urlparse

    return urlparse(url).hostname or ""

INSTALLED_APPS = [
    # Daphne owns `runserver` so the dev server speaks ASGI (and therefore
    # WebSocket) — it has to sit above staticfiles, which owns it otherwise.
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "channels",
    # Local
    "apps.common",
    "apps.accounts",
    "apps.workspaces",
    "apps.projects",
    "apps.bots",
    "apps.contacts",
    "apps.inbox",
    "apps.flows",
    "apps.tables",
    "apps.media",
    "apps.engine",
    "apps.agents",
    "apps.telegram",
    "apps.analytics",
    "apps.billing",
    "apps.notifications",
    "apps.marketplace",
    "apps.realtime",
    "apps.apikeys",
    "apps.publicapi",
]

MIDDLEWARE = [
    # First, and therefore outermost. It has to see the responses the inner
    # middleware short-circuit with — `CommonMiddleware`'s append-slash
    # redirect is one — and it mutates whatever it is handed rather than
    # replacing it, so the CORS headers written further in survive. See
    # `apps.common.middleware` for why an HTML answer under `/api/` is a bug
    # rather than a cosmetic detail.
    "apps.common.middleware.ApiErrorEnvelopeMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": env_str("DJANGO_DB_PATH", str(BASE_DIR / "db.sqlite3")),
        # Keep the connection open between requests and Celery tasks instead of
        # opening a fresh one each time. A worker draining a burst of updates
        # otherwise pays a connect-and-auth handshake per update — cheap on
        # SQLite, a real cost on the Postgres a production install uses. Zero
        # (the default) restores per-request connections.
        "CONN_MAX_AGE": env_int("DJANGO_CONN_MAX_AGE", 60),
        # A persisted connection can be closed by the database side while idle;
        # this checks it is alive at the start of a request rather than failing
        # the first query on it.
        "CONN_HEALTH_CHECKS": True,
    }
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# The product is Uzbek; timestamps are stored in UTC and rendered in each
# workspace's own `timezone` field, never in the server's.
LANGUAGE_CODE = "uz"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

MAILERS = {
    "default": {
        "BACKEND": env_str("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"),
    },
}
DEFAULT_FROM_EMAIL = env_str("DJANGO_FROM_EMAIL", "Oqim Studio <no-reply@oqim.uz>")

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    # Session auth is what the Next.js server uses (it forwards the browser's
    # cookie); the token is for scripts, the bot runtime and WebSocket clients,
    # which have no cookie jar of their own.
    #
    # `apikeys.authentication.ApiKeyAuthentication` is deliberately **not**
    # here. Both credentials above are the account — every workspace its owner
    # belongs to, every bot token, the invoices, the team screen — and adding a
    # scoped credential to the same default list would make every existing
    # endpoint in the product reachable by an API key, which is the opposite of
    # what a scope is for. It is named on the `/api/v1/` views and nowhere
    # else, so a key is inert against the rest of the API by construction
    # rather than by a permission class somebody has to remember.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.DefaultPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "apps.common.exceptions.api_exception_handler",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    # How many trusted proxies stand between the public internet and Django,
    # each appending the peer it saw to `X-Forwarded-For`. This is the whole
    # security of every IP throttle below.
    #
    # Left at DRF's default of `None`, `get_ident` takes the *entire* XFF
    # string as the client identity whenever the header is present — and the
    # header is attacker-controlled. cloudflared (and any real load balancer)
    # *appends* the connecting peer rather than replacing the header, so a
    # request arriving as `X-Forwarded-For: <anything the caller typed>` leaves
    # Django with `<caller's value>, <real peer>`. Under `None` the caller's
    # value is part of the key, so rotating it hands out a fresh bucket per
    # request and the `auth`/`auth-email` ceilings below stop existing: login
    # brute-force, signup enumeration and reset/verification mail-bombing all
    # go uncapped. Proven by watching a rotating header never earn a 429.
    #
    # Set to the number of proxies instead, and `get_ident` reads
    # `addrs[-NUM_PROXIES]` — the entry the *trusted* proxy wrote, which the
    # caller cannot forge past. One for the stand (cloudflared alone); an env
    # var because prod may add a load balancer in front and the count has to
    # match the deployment or the throttle keys on the wrong hop. Zero would
    # pin everything to `REMOTE_ADDR`, correct only with no proxy at all.
    "NUM_PROXIES": env_int("DJANGO_NUM_PROXIES", 1),
    # The auth endpoints are the ones an attacker can reach without an account,
    # so they are the ones with a ceiling. `rate_limited` is a code the
    # interface already knows how to render (see `AuthErrorCode`).
    "DEFAULT_THROTTLE_RATES": {
        "auth": "12/min",
        # Password reset and verification mail: slower still, because each one
        # sends a message to somebody's inbox.
        "auth-email": "5/min",
        # Waiting for a Telegram login to be approved.
        #
        # Sized for the deployment, not for one visitor, and that is the whole
        # subtlety: the panel calls Django from its own server without
        # forwarding the browser's address, so DRF sees a single client for
        # everybody and this bucket is shared. At a one-second poll one person
        # signing in spends 60/min, so the old 90 left room for exactly one —
        # a second concurrent sign-in got 429s that had nothing to do with them.
        #
        # Cheap to allow: the endpoint answers only for a nonce this server
        # issued seconds earlier, so there is nothing here to guess at and
        # nothing to enumerate. `NUM_PROXIES` above now pins the *direct*
        # caller to a real hop, but it does not narrow this bucket: the panel
        # reaches Django with no `X-Forwarded-For` at all, so every poll that
        # comes through `lib/api/server.ts` still shares one identity. Bringing
        # this back down needs per-client identity for that path — forwarding
        # the browser's address through `server.ts`, or throttling on the nonce
        # itself, which is the one thing already unique per sign-in.
        "auth-poll": "600/min",
        # Pressing "Ishga tushirish" in the Kod panel — per account, not per
        # address (see `flows.views.ScriptRunThrottle` for why that distinction
        # is the whole point here).
        #
        # Each press spawns a Node process on our machines, and the editor's
        # own budget for one is 8000 ms, so an author who actually reads the
        # answers cannot draw more than about seven a minute out of this
        # endpoint however fast they type. Thirty is four times the headroom a
        # tight loop on a script that returns in 30 ms needs, and still a
        # ceiling something hammering it reaches in a minute — at which point
        # the only thing that goes quiet is that one account's test panel.
        "script-run": "30/min",
        # `/api/v1/` — the open API, counted **per workspace** (see
        # `apikeys.throttling` for why it is not per key: a ceiling anybody can
        # raise by minting a second key is not a ceiling).
        #
        # Sized on the write path, because that is the only one that costs
        # anything: an import validates a graph against the block vocabulary,
        # spends a plan check, writes a flow and rebuilds its trigger index
        # inside one transaction. Two a second, sustained, is an order of
        # magnitude more than any integration a human is waiting behind — a CRM
        # syncing contacts polls once a minute, and an AI writing a flow makes
        # a handful of calls and then stops — and it is still low enough that
        # one tenant hammering it cannot make graph reindexing the box's
        # problem. Reads are far cheaper and share the bucket rather than
        # getting one of their own: two limits mean two things to explain to
        # whoever gets a 429, and nothing here needs the second one yet.
        "api-key": "120/min",
    },
}

# The browser talks to Django directly for WebSockets and (optionally) for
# fetches from client components, so the Next.js origin has to be allowed.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")

# ---------------------------------------------------------------------------
# Redis, Channels, Celery
# ---------------------------------------------------------------------------

REDIS_URL = env_str("REDIS_URL", "redis://127.0.0.1:6379/0")

# Throttling counts requests here, so it has to be shared between processes: a
# per-process cache would give every worker its own allowance.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env_str("CACHE_URL", REDIS_URL),
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

CELERY_BROKER_URL = env_str("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = env_str("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE
CELERY_ENABLE_UTC = True
# A dropped update is a customer who got no answer, so a task is acknowledged
# only once it has run — at the cost of it running twice if a worker is killed
# mid-flight, which the runtime is written to tolerate.
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# Nothing in this product reads a task's return value, and keeping results turns
# every enqueue into a second round trip to Redis — one that retried twenty
# times while a Telegram webhook sat waiting.
CELERY_TASK_IGNORE_RESULT = True
# A webhook has seconds, not minutes. If the broker cannot be reached right
# away, the caller needs to hear so and act, not wait through a retry ladder.
CELERY_TASK_PUBLISH_RETRY = False
CELERY_BROKER_CONNECTION_TIMEOUT = 2.0
# Only the *connect* is bounded. A worker's read is a long poll on the queue by
# design, and capping that would make it reconnect every couple of seconds.
CELERY_BROKER_TRANSPORT_OPTIONS = {"socket_connect_timeout": 2}

# With no worker reachable, an update is handled inside the webhook request
# instead of being dropped. Slower — the Bot API call happens before the
# response — but the bot answers, which is the whole point of the product. Turn
# it off where a queue is guaranteed and latency matters more.
TELEGRAM_INLINE_FALLBACK = env_bool("TELEGRAM_INLINE_FALLBACK", True)

# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

# Public HTTPS origin Telegram can reach this backend at (a tunnel URL in dev).
# <PUBLIC_BASE_URL>/api/telegram/webhook/<webhook_token>/ is what gets registered
# — the bot's own `webhook_token`, not its id: the id is the public handle.
PUBLIC_BASE_URL = env_str("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
TELEGRAM_API_BASE = env_str("TELEGRAM_API_BASE", "https://api.telegram.org")
TELEGRAM_REQUEST_TIMEOUT = float(env_str("TELEGRAM_REQUEST_TIMEOUT", "20"))
# When true no Bot API call leaves the machine: sends are recorded and
# broadcast to the realtime channel instead. Lets the whole runtime be driven
# end to end without a real bot token.
TELEGRAM_OFFLINE = env_bool("TELEGRAM_OFFLINE", False)

# ---------------------------------------------------------------------------
# AI agents
# ---------------------------------------------------------------------------

# The credential every model call is made with. Unset is a supported state, not
# a broken one: `apps.agents.provider.is_available()` reports "sozlanmagan",
# the `agent.ask` block takes its failure exit and says so in the run's trace,
# and nothing else in the runtime changes. Exactly the shape `script` uses for
# a machine with no Node on it.
ANTHROPIC_API_KEY = env_str("ANTHROPIC_API_KEY")
# When true, no request reaches the model provider: `provider.complete` answers
# with a canned reply instead. The `TELEGRAM_OFFLINE` promise, for the other
# network dependency — the whole path (block, tools, guard, send, trace) can be
# driven on a laptop with no account. Forced on in the test settings.
AGENTS_OFFLINE = env_bool("AGENTS_OFFLINE", False)

# The bot behind the Login Widget. Its token signs what the widget hands the
# browser, so this is what verifies it — and it has to be the same bot whose
# domain was registered with @BotFather (`/setdomain`).
TELEGRAM_LOGIN_BOT_TOKEN = env_str("TELEGRAM_LOGIN_BOT_TOKEN")
TELEGRAM_LOGIN_BOT_USERNAME = env_str("TELEGRAM_LOGIN_BOT_USERNAME")
# The domain registered with @BotFather for that bot. The widget refuses to
# sign anybody in from anywhere else — and shows its own English error inside an
# iframe nobody can style — so the sign-in screens ask for this first and offer
# the password form instead when it does not match where they are being served
# from. Set it only *after* running `/setdomain`.
TELEGRAM_LOGIN_DOMAIN = env_str("TELEGRAM_LOGIN_DOMAIN")

# Where the interface is reachable — the links inside verification and reset
# mails point here, so a code in an inbox is one click rather than a copy-paste.
FRONTEND_BASE_URL = env_str("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")

# ---------------------------------------------------------------------------
# Scripts
# ---------------------------------------------------------------------------

# How many Kod blocks may be running at once, and how much of that any one
# workspace may take. Counted in Redis through the Django cache, so these are
# ceilings for the whole deployment rather than for one process — see
# `apps.engine.script.concurrency` for what a slot is and how one comes back
# when the worker holding it is killed.
#
# In settings and not beside the sandbox flags, which are deliberately not:
# those flags are what a script may *reach*, and a deployment that can weaken
# them from a config file has no sandbox. These are what a box can *afford*,
# and only the box knows. A script is a Node process with a 64 MB heap, so
# eight is roughly a gigabyte and eight busy cores — the shape of a small
# server, and a number to raise on a large one.
SCRIPT_MAX_CONCURRENT = env_int("SCRIPT_MAX_CONCURRENT", 8)
# Half the host, so no single tenant can take the box: two hot workspaces can
# fill it between them and a third is refused, which is the failure this is
# for — the alternative is one workspace's hot flow occupying every slot and
# every other tenant's script block reporting an error it did nothing to cause.
SCRIPT_MAX_CONCURRENT_PER_WORKSPACE = env_int("SCRIPT_MAX_CONCURRENT_PER_WORKSPACE", 4)

# ---------------------------------------------------------------------------
# Development shortcuts
# ---------------------------------------------------------------------------

# `and DEBUG` is the whole safety story: these cannot be switched on in
# production by an environment variable, however the file was copied. `prod.py`
# pins them off again, so it takes two deliberate mistakes to lose them.

#: Skips the emailed confirmation entirely — a signup lands verified. For test
#: environments where there is no inbox to open at all.
DEV_AUTO_VERIFY_EMAIL = env_bool("DEV_AUTO_VERIFY_EMAIL", False) and DEBUG
#: Hands the confirmation code back in the API response and writes it to the
#: log, so a tester can finish the flow without a mailbox.
DEV_EXPOSE_AUTH_CODES = DEBUG

#: Where unhandled exceptions are written. With DEBUG off Django stops printing
#: a traceback to the response — which is the point — so it has to be printed
#: somewhere, or a 500 becomes a page that says nothing to anybody.
LOG_FILE = env_str("DJANGO_LOG_FILE", "")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "{levelname} {name} {message}", "style": "{"},
        "verbose": {"format": "{asctime} {levelname} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
        **(
            {
                "file": {
                    "class": "logging.handlers.RotatingFileHandler",
                    "filename": LOG_FILE,
                    "maxBytes": 5 * 1024 * 1024,
                    "backupCount": 3,
                    "encoding": "utf-8",
                    "formatter": "verbose",
                }
            }
            if LOG_FILE
            else {}
        ),
    },
    "loggers": {
        # Django logs a handled 4xx at WARNING and an unhandled 500 at ERROR
        # with the traceback attached; both belong wherever the rest goes.
        "django.request": {
            "handlers": ["console"] + (["file"] if LOG_FILE else []),
            "level": "WARNING",
            "propagate": False,
        },
    },
    "root": {
        "handlers": ["console"] + (["file"] if LOG_FILE else []),
        "level": env_str("DJANGO_LOG_LEVEL", "INFO"),
    },
}
