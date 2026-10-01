#!/usr/bin/env bash
#
# Brings the local Oqim Studio stand back up and re-points everything that
# names it. Safe to run when it is already running: every step replaces what
# it finds rather than assuming a clean machine.
#
# The whole reason this exists is that a quick Cloudflare tunnel gets a *new*
# random hostname every time it reconnects, and four separate things hold a
# copy of that hostname. Restarting the servers without updating all four
# leaves a stand that looks up and answers nothing.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="/tmp/oqim-stend"
PY="$BACKEND/.venv/bin/python"

mkdir -p "$LOGS"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# -- 0. What has to be there already ----------------------------------------
say "0/6  Muhit"
[ -x "$PY" ] || { bad ".venv topilmadi — backend/ da 'python3 -m venv .venv' qiling"; exit 1; }
redis-cli ping >/dev/null 2>&1 && ok "redis" || bad "redis javob bermadi (Celery va WebSocket ishlamaydi)"

# -- 1. Tunnels, and the names they came back with ---------------------------
# Killed rather than reused: after a network drop cloudflared stays alive in a
# retry loop under a hostname that no longer resolves, so a live process is not
# evidence of a live tunnel.
say "1/6  Tunnellar"
pkill -f "cloudflared tunnel" 2>/dev/null; sleep 2
: > "$LOGS/tunnel-api.log"; : > "$LOGS/tunnel-panel.log"
( nohup cloudflared tunnel --url http://localhost:8000 --no-autoupdate < /dev/null > "$LOGS/tunnel-api.log"   2>&1 & ) < /dev/null > /dev/null 2>&1
( nohup cloudflared tunnel --url http://localhost:3000 --no-autoupdate < /dev/null > "$LOGS/tunnel-panel.log" 2>&1 & ) < /dev/null > /dev/null 2>&1

# `api.trycloudflare.com` is not a tunnel: it is the control endpoint
# cloudflared POSTs to for a hostname, and it appears in the log line printed
# when that POST times out. A bare `*.trycloudflare.com` grep therefore reads a
# *failed* tunnel as a successful one, writes that host into both .env files
# and re-registers every workspace bot webhook at an address Telegram can never
# reach. The stand then looks up and answers nothing — the exact failure this
# script exists to prevent. Excluded by name, and the timeout is reported.
# `-a` on both greps. cloudflared is still writing this log while it is read,
# and a half-written line is enough for grep to call the whole file binary,
# print "Binary file ... matches" and say nothing about the URL. That sentence
# then *is* the hostname as far as the rest of this script is concerned: it
# reached PUBLIC_BASE_URL and every webhook came back "invalid webhook URL
# specified" from a stand whose tunnels were both up and answering. Same shape
# as the api.trycloudflare.com case below — a line that is not a URL, used as
# one — which is why both of them are guarded here rather than at the call.
url_of() {
  grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$1" 2>/dev/null \
    | grep -avx 'https://api\.trycloudflare\.com' | head -1
}

API=""; PANEL=""
for _ in $(seq 1 40); do
  API=$(url_of "$LOGS/tunnel-api.log")
  PANEL=$(url_of "$LOGS/tunnel-panel.log")
  [ -n "$API" ] && [ -n "$PANEL" ] && break
  sleep 2
done
if [ -z "$API" ] || [ -z "$PANEL" ]; then
  bad "tunnel manzillari olinmadi — $LOGS/tunnel-*.log ga qarang"
  grep -h "failed to request quick Tunnel" "$LOGS"/tunnel-*.log 2>/dev/null | head -1 \
    && bad "cloudflare so'rovi javob bermadi — internetni tekshirib, qayta uring"
  exit 1
fi
ok "api   $API"
ok "panel $PANEL"

# -- 2. The four copies of those names ---------------------------------------
say "2/6  .env fayllar"
API="$API" PANEL="$PANEL" "$PY" - "$BACKEND/.env" <<'PYEOF'
import os, pathlib, re, sys
api, panel = os.environ["API"], os.environ["PANEL"]
p = pathlib.Path(sys.argv[1]); s = p.read_text()
local = "http://localhost:3000,http://127.0.0.1:3000"
for key, value in {
    "CORS_ALLOWED_ORIGINS": f"{local},{panel}",
    "CSRF_TRUSTED_ORIGINS": f"{local},{panel}",
    "FRONTEND_BASE_URL": panel,
    "PUBLIC_BASE_URL": api,
    "TELEGRAM_LOGIN_DOMAIN": panel.removeprefix("https://"),
}.items():
    s, n = re.subn(rf"^{key}=.*$", f"{key}={value}", s, flags=re.M)
    if not n:
        s = s.rstrip("\n") + f"\n{key}={value}\n"
p.write_text(s)
PYEOF
ok "backend/.env"
# The tunnel *and* the two local addresses. `next.config.ts` derives
# `allowedDevOrigins` from this list, and the dev server answers 403 to its own
# `/_next/static/chunks/*` for an origin that is not on it — so a browser opened
# at http://127.0.0.1:3000 gets the server-rendered HTML and then never
# hydrates: every button, sheet and toggle on the page is dead. `localhost` is
# allowed by default and `127.0.0.1` is not, which is why this looked like it
# worked. Nothing that reads the response body can see it, which is why
# `verify.sh` now asks for a chunk with an Origin header on it.
printf 'API_BASE_URL=http://127.0.0.1:8000\nALLOWED_ORIGINS=%s,*.trycloudflare.com,http://127.0.0.1:3000,http://localhost:3000\n' "$PANEL" > "$FRONTEND/.env.local"
ok "frontend/.env.local"

# -- 3. Servers --------------------------------------------------------------
# `.next` is wiped rather than reused. A Turbopack cache written while a file
# was mid-edit keeps serving modules that import exports the source no longer
# has, and the symptom is a feature that silently stops working while
# `npm run typecheck` stays clean.
say "3/6  Serverlar"
pkill -f "manage.py runserver" 2>/dev/null
pkill -f "celery -A config" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 4
# Every one of these detaches completely: stdin closed, both output streams
# pointed at a file — *including the subshell's own*. Without the redirect on
# the subshell it inherits this script's stdout, and since the child it starts
# runs forever that pipe never closes. Anything reading this script's output (a
# `| tail`, a CI step, an agent) then waits on a stand that is already up: the
# work finishes, only the report hangs.
start() { local dir="$1" log="$2"; shift 2; ( cd "$dir" && nohup "$@" < /dev/null > "$log" 2>&1 & ) < /dev/null > /dev/null 2>&1; }

start "$BACKEND"  "$LOGS/django.log"        "$PY" manage.py runserver 0.0.0.0:8000
start "$BACKEND"  "$LOGS/celery-worker.log" "$PY" -m celery -A config worker -l warning
start "$BACKEND"  "$LOGS/celery-beat.log"   "$PY" -m celery -A config beat -l warning
rm -rf "$FRONTEND/.next"
start "$FRONTEND" "$LOGS/next.log"          npm run dev

for _ in $(seq 1 60); do
  lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1 && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 2
done
lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1 && ok "django :8000" || bad "django ko'tarilmadi — $LOGS/django.log"
lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && ok "next :3000"   || bad "next ko'tarilmadi — $LOGS/next.log"

# -- 3b. Wait for the tunnel to actually answer ------------------------------
# cloudflared prints its hostname the moment it is assigned, which is well
# before that name resolves anywhere else. Registering a webhook in that window
# gets "Failed to resolve host" from Telegram — and then the stand is up, the
# script says it succeeded, and signing in through the bot is quietly broken
# until somebody re-runs the command by hand. Learned by watching it happen.
say "3b/6 Tunnel tayyorligi"
code() { curl -s -m 10 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo 000; }
ready=0
for _ in $(seq 1 30); do
  if [ "$(code "$API/api/auth/telegram/config/")" != "000" ] && [ "$(code "$PANEL/")" != "000" ]; then
    ready=1; break
  fi
  sleep 3
done
[ "$ready" = 1 ] && ok "ikkala tunnel ham javob beryapti" || bad "tunnel javob bermadi — webhook o'rnatilmaydi"

# -- 4. Telegram -------------------------------------------------------------
# The login bot also owns the bots a workspace creates from the panel, so its
# webhook carries `managed_bot` as well as `message`. Registering it is not
# optional after a URL change: Telegram keeps posting to the dead address and
# signing in through the bot fails with nothing said on either side.
say "4/6  Telegram webhook"
( cd "$BACKEND" && "$PY" manage.py telegram_login_webhook 2>&1 | tail -1 | sed 's/^/  /' )

# The workspace bots point at the same host and are re-registered by the same
# arithmetic — `reconcile_webhooks` compares what Telegram holds against
# `PUBLIC_BASE_URL` and fixes what drifted.
say "5/6  Bot webhooklari"
( cd "$BACKEND" && "$PY" manage.py shell -c "
from apps.bots.services import reconcile_webhooks
for row in reconcile_webhooks():
    print('  ', row.get('handle') or row.get('bot'), '->', 'ok' if row.get('ok') else row.get('error'))
" 2>&1 | grep -v "objects imported" )

# -- 6. Proof ----------------------------------------------------------------
say "6/6  Tekshiruv"
# `-L`, because `/` on the panel is a redirect to `/login` for anyone not
# signed in — which is the correct answer, not a failure.
alive() { [ "$(curl -s -m 25 -L -o /dev/null -w "%{http_code}" "$1" 2>/dev/null)" = "200" ]; }
alive "$PANEL/" && ok "panel javob berdi" || bad "panel javob bermadi"
alive "$API/api/auth/telegram/config/" && ok "api javob berdi" || bad "api javob bermadi"

echo
say "Tayyor"
echo "  Panel : $PANEL"
echo "  API   : $API"
echo "  Loglar: $LOGS"
