#!/usr/bin/env bash
#
# Is this checkout coherent right now?
#
# One command, because there is more than one way for the tree to be broken and
# no single tool sees them all. Two agents editing at once leave a state where
# the frontend typechecks, the backend passes, and the app is still wrong: a
# model changed with no migration beside it, a write moved into a render, a
# comment that ended early, or a dev server serving modules the source no
# longer has. Each of those has cost a session already. They are gathered here
# so that "did I break anything" is one thing to run rather than six things to
# remember.
#
#   scripts/verify.sh              everything, including the running stand
#   scripts/verify.sh --no-stand   the checkout only — for CI, or with the stand down
#
# Exit status is 0 only if every FAIL-level check passed. Warnings are printed
# and do not fail: they are things that are usually stale data rather than a
# broken tree, and a check that cries wolf gets ignored, which is worse than
# not having it.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PY="$BACKEND/.venv/bin/python"
LOGS="${OQIM_LOGS:-/tmp/oqim-stend}"

WITH_STAND=1
[ "${1:-}" = "--no-stand" ] && WITH_STAND=0

failures=0
warnings=0

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; warnings=$((warnings + 1)); }
skip() { printf '  \033[90m·\033[0m %s\n' "$*"; }

# Every check runs even after one fails. A half-edited tree usually has more
# than one thing wrong with it, and stopping at the first turns one command
# into as many rounds as there are mistakes.
run() {
  local label="$1" dir="$2"; shift 2
  local output
  output="$(cd "$dir" && "$@" 2>&1)"
  if [ $? -eq 0 ]; then
    ok "$label"
  else
    bad "$label"
    printf '%s\n' "$output" | tail -25 | sed 's/^/      /'
  fi
}

# -- backend -----------------------------------------------------------------
say "Backend"
if [ ! -x "$PY" ]; then
  bad ".venv topilmadi — backend/ da 'python3 -m venv .venv'"
else
  run "tests" "$BACKEND" "$PY" manage.py test apps --settings=config.settings.test
  # A model edited without the migration beside it passes every test on a
  # database the test runner built from the models themselves, and then fails
  # on the one machine that matters — the one with data on it.
  run "migrations are in step with the models" "$BACKEND" \
    "$PY" manage.py makemigrations --check --dry-run --settings=config.settings.test
  # And that the file was actually *run* against the database the stand uses.
  # The check above is satisfied by a migration existing on disk, which is what
  # `makemigrations` leaves behind — the tests then pass too, because the test
  # runner builds its database from the models. Everything is green and the
  # running app answers `no such column` on the one write that needed it, with
  # the failure surfacing in the browser as a form that silently does nothing.
  # Default settings on purpose: `db.sqlite3` is the database this is about.
  run "migrations applied to the stand's database" "$BACKEND" \
    "$PY" manage.py migrate --check
  if "$PY" -m ruff --version >/dev/null 2>&1; then
    run "ruff" "$BACKEND" "$PY" -m ruff check apps config \
      --select=F,E9,B,I --line-length=120 --exclude "*/migrations/*"
  else
    skip "ruff o'rnatilmagan (pip install -r requirements-dev.txt)"
  fi
fi

# -- frontend ----------------------------------------------------------------
say "Frontend"
run "check:comments — no block comment ends early" "$FRONTEND" npm run --silent check:comments
run "check:effects — no write reached from a render" "$FRONTEND" npm run --silent check:effects
run "typecheck" "$FRONTEND" npm run --silent typecheck
run "lint" "$FRONTEND" npm run --silent lint

# -- the running stand -------------------------------------------------------
# Everything above reads the source. None of it can see the one failure that
# hurt most: a Turbopack cache still serving exports the source deleted, which
# leaves typecheck and lint clean while the browser is broken. Only asking the
# server that is actually running finds that.
if [ "$WITH_STAND" = 0 ]; then
  say "Stend"; skip "--no-stand"
else
  say "Stend"
  code() { curl -s -m 20 -L -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo 000; }

  if [ "$(code http://127.0.0.1:3000/login)" = "000" ]; then
    skip ":3000 javob bermayapti — stend o'chiq (.claude/skills/stend/restore.sh)"
  else
    # Signed in, because the routes worth smoke-testing are behind the login.
    #
    # Three cookies, because that is what a browser carries here: the DRF token
    # is the credential, `oqim_ws` names the tenant, and `oqim_session` is the
    # unsigned descriptor the route guard reads to decide whether to let the
    # request through at all (`features/auth/session-cookie.ts` — base64 of a
    # URI-encoded JSON, explicitly "not encryption"). An existing token is
    # reused rather than minted: a read-only sweep should not be the thing that
    # changes the database it is checking.
    COOKIE="$(cd "$BACKEND" && "$PY" manage.py shell -c "
import base64, json, time, urllib.parse
from rest_framework.authtoken.models import Token
from apps.workspaces.models import Membership
m = Membership.objects.filter(invited=False).select_related('user').order_by('joined_at').first()
t = Token.objects.filter(user=m.user).first() if m else None
if t:
    s = {'userId': m.user.id, 'email': m.user.email, 'name': m.user.name,
         'workspaceId': m.workspace_id, 'emailVerified': True,
         'expiresAt': int((time.time() + 600) * 1000)}
    raw = base64.b64encode(urllib.parse.quote(json.dumps(s)).encode()).decode()
    print(f'oqim_token={t.key}; oqim_ws={m.workspace_id}; oqim_session={raw}')
else:
    print('')
" 2>/dev/null | tail -1)"

    # Where a request *ended up*, not just what it answered. A signed-out sweep
    # follows every redirect to /login and gets eleven cheerful 200s while
    # rendering nothing — a green light for a check that ran on the door.
    # One request, three answers: the status, the URL it finished on, and the
    # page itself — kept, because the status alone lies.
    #
    # A server component that throws does not produce a 5xx. The error boundary
    # above it renders instead and the response is a perfectly ordinary 200
    # carrying the error where only a reader would see it. What is actually in
    # the body is React's flight payload for the thrown error, and that is the
    # thing to look for: `"digest":"…","name":"Error"`, which no page that
    # rendered has in it.
    BODY="$(mktemp)"
    trap 'rm -f "$BODY"' EXIT
    fetch() { curl -s -m 25 -L -o "$BODY" -w "%{http_code} %{url_effective}" -H "Cookie: $COOKIE" "http://127.0.0.1:3000$1" 2>/dev/null; }
    # A thrown server component and a deliberate `notFound()` both leave a
    # digest in the flight payload, and they need different sentences: one is a
    # broken page, the other is a page working correctly on an id this reader
    # cannot see — which is a fault in what the sweep asked for, not in the app.
    threw()   { grep -qF '\"digest\":\"' "$BODY" && ! missing; }
    missing() { grep -qF 'NEXT_HTTP_ERROR_FALLBACK' "$BODY"; }
    routes="/dashboard /bots /projects /contacts /analytics /tables /settings /settings/team /settings/api-keys /market /billing /help /docs /integrations"

    # The screens that need an id, resolved the way the cookie was — from the
    # database, read-only, reusing whatever is already there.
    #
    # They were left out for as long as they were because a fixed list cannot
    # name them, and the cost of that was the whole point of the sweep going
    # missing: the flow editor is the screen this product *is*, and until now it
    # could be broken outright and every check here would still pass. A bot's
    # own tabs are the same argument one level down — that is where a token, a
    # payment provider and a script library are configured.
    #
    # Nothing is minted. An empty answer means the workspace has none of that
    # kind yet, and the route is dropped rather than requested as `/bots/`,
    # which is a different page and would report a failure that is not one.
    IDS="$(cd "$BACKEND" && "$PY" manage.py shell -c "
from apps.agents.models import Agent
from apps.bots.models import Bot
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.tables.models import Table
from apps.workspaces.models import Membership
# The same membership the cookie above was minted from. Resolved globally, the
# oldest row of a kind can belong to a workspace this reader is not in — and
# then the sweep asks for something the app is right to refuse and reports the
# refusal as a broken page. Every id here has to be one this cookie can open.
m = Membership.objects.filter(invited=False).order_by('joined_at').first()
def first(model):
    row = model.objects.filter(workspace_id=m.workspace_id).order_by('created_at').first() if m else None
    return row.pk if row else '-'
print(first(Bot), first(Flow), first(Project), first(Agent), first(Table))
" 2>/dev/null | tail -1)"
    # Positional rather than ${IDS%% *}: five ids need five splits, and a
    # missing one is "-" so the shape never shifts under the parse.
    set -- $IDS
    BOT_ID="${1:--}"; FLOW_ID="${2:--}"; PROJECT_ID="${3:--}"; AGENT_ID="${4:--}"; TABLE_ID="${5:--}"
    [ "$BOT_ID" != "-" ] && routes="$routes /bots/$BOT_ID /bots/$BOT_ID/code /bots/$BOT_ID/payments /bots/$BOT_ID/settings"
    [ "$FLOW_ID" != "-" ] && routes="$routes /flows/$FLOW_ID"
    [ "$PROJECT_ID" != "-" ] && routes="$routes /projects/$PROJECT_ID"
    # The canvas is the whole of an agent's editor now — the form it replaced
    # was removed rather than kept beside it, so this page failing is an agent
    # nobody can change.
    [ "$AGENT_ID" != "-" ] && routes="$routes /agents/$AGENT_ID"
    # A table's four tabs. Ma'lumotlar was missing from this sweep entirely
    # while it grew a grid that is typed into directly, a column editor and an
    # integrations screen — three ways for a price list to stop opening, none
    # of them visible to typecheck or lint.
    [ "$TABLE_ID" != "-" ] && routes="$routes /tables/$TABLE_ID /tables/$TABLE_ID/columns /tables/$TABLE_ID/integrations /tables/$TABLE_ID/settings"
    # The Mini App, and deliberately outside the signed-in set below: Telegram
    # opens it with no panel cookie at all, so a page that renders only for a
    # signed-in reader is a page no customer can open.
    [ "$BOT_ID" != "-" ] && routes="$routes /webapp/$BOT_ID"
    case "$(fetch /dashboard)" in
      *"/login"*|"")
        warn "sahifalarga kirib bo'lmadi (sessiya cookie'si ishlamadi) — faqat ochiq sahifalar tekshirildi"
        COOKIE=""
        routes="/login /signup /forgot-password /help"
        [ "$BOT_ID" != "-" ] && routes="$routes /webapp/$BOT_ID"
        ;;
    esac

    broken=""
    for route in $routes; do
      answer="$(fetch "$route")"
      status="${answer%% *}"
      case "${status:-000}" in 5*|""|000) broken="$broken $route(${status:-000})" ;; esac
      case "$answer" in
        *"/login"*) [ -n "$COOKIE" ] && broken="$broken $route(login'ga otdi)" ;;
      esac
      threw && broken="$broken $route(render xatosi)"
      missing && broken="$broken $route(topilmadi — id bu ish maydoniniki emas)"
    done
    if [ -n "$broken" ]; then
      bad "sahifalar javob bermadi:$broken"
      printf '      %s\n' "eskirgan kesh bo'lsa: rm -rf frontend/.next (restore.sh shuni qiladi)"
    else
      ok "$(echo $routes | wc -w | tr -d ' ') sahifa toza ochildi"
    fi

    # Does the page come alive, or only render?
    #
    # Everything above reads a response body, and a body is complete and
    # correct on a page whose JavaScript never loads. `next dev` guards its own
    # assets by origin: a request for `/_next/static/chunks/*` carrying an
    # Origin that is not in `allowedDevOrigins` is answered 403, the bundle
    # never arrives, and the page hydrates never — every button, sheet and
    # toggle on it is dead while the HTML looks perfect. `localhost` is on
    # Next's default list and `127.0.0.1` is not, so the stand looked fine
    # through the tunnel and was inert on the address most likely to be typed.
    #
    # Curl sends no Origin, which is exactly why the sweep above could not see
    # this. So this asks for one real chunk three times, as three browsers.
    chunk="$(curl -s -m 15 http://127.0.0.1:3000/login | grep -o '/_next/static/chunks/[^"]*\.js' | head -1)"
    if [ -z "$chunk" ]; then
      warn "sahifada chunk topilmadi — gidratsiya tekshiruvi o'tkazib yuborildi"
    else
      # Read here rather than reusing `$panel`, which is not assigned until
      # after this block.
      tunnel="$(grep -E '^FRONTEND_BASE_URL=' "$BACKEND/.env" 2>/dev/null | cut -d= -f2-)"
      dead=""
      for origin in "http://127.0.0.1:3000" "http://localhost:3000" "$tunnel"; do
        [ -z "$origin" ] && continue
        got="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -H "Origin: $origin" "http://127.0.0.1:3000$chunk" 2>/dev/null || echo 000)"
        [ "$got" = "200" ] || dead="$dead $origin($got)"
      done
      if [ -n "$dead" ]; then
        bad "bu manzillarda sahifa jonlanmaydi (JS 403):$dead"
        printf '      %s\n' "frontend/.env.local dagi ALLOWED_ORIGINS ga qo'shing — restore.sh shuni yozadi"
      else
        ok "sahifa uchala manzilda ham jonlanadi"
      fi
    fi

    # The signature of the stale cache itself, in the dev server's own log.
    # It does not heal on its own — only wiping `.next` clears it — so finding
    # it anywhere in this run's log is a real answer, not old news.
    if [ -f "$LOGS/next.log" ] && grep -qE "doesn't exist in target module|was not found in|Module not found" "$LOGS/next.log"; then
      bad "next.log da eskirgan modul xatosi bor — rm -rf frontend/.next"
      grep -nE "doesn't exist in target module|was not found in|Module not found" "$LOGS/next.log" | tail -5 | sed 's/^/      /'
    else
      ok "next.log da eskirgan modul xatosi yo'q"
    fi
  fi

  # The tunnel hostname lives in four places and they drift apart silently.
  # `restore.sh` writes all four; this only reads them back, so a stand that
  # has been up across a reconnect says so instead of quietly answering nothing.
  panel="$(grep -E '^FRONTEND_BASE_URL=' "$BACKEND/.env" 2>/dev/null | cut -d= -f2-)"
  origins="$(grep -E '^ALLOWED_ORIGINS=' "$FRONTEND/.env.local" 2>/dev/null | cut -d= -f2-)"
  if [ -n "$panel" ] && [ -n "$origins" ]; then
    case "$origins" in
      *"$panel"*) ok "backend/.env va frontend/.env.local bir xil panel manzilini ko'rsatyapti" ;;
      *) warn "panel manzili ikki .env da har xil ($panel ⇄ $origins) — restore.sh" ;;
    esac
  fi

  if [ -x "$PY" ]; then
    # Only bots Telegram has actually answered about: a blank `webhook_actual_url`
    # is a bot whose webhook was never registered — `seed_demo`'s invented token,
    # most often — and that is a fixture, not drift.
    drift="$(cd "$BACKEND" && "$PY" manage.py shell -c "
from django.conf import settings
from apps.bots.models import Bot
base = (settings.PUBLIC_BASE_URL or '').rstrip('/')
print(' '.join(b.handle for b in Bot.objects.exclude(webhook_actual_url='') if not b.webhook_actual_url.startswith(base)))
" 2>/dev/null | tail -1)"
    if [ -n "$drift" ]; then
      warn "Telegram hali eski manzilga yozyapti: $drift — restore.sh"
    else
      ok "bot webhooklari PUBLIC_BASE_URL bilan mos"
    fi
  fi
fi

# -- verdict -----------------------------------------------------------------
echo
if [ "$failures" -gt 0 ]; then
  printf '\033[31m%s\033[0m\n' "$failures ta tekshiruv o'tmadi ($warnings ogohlantirish)."
  exit 1
fi
printf '\033[32m%s\033[0m\n' "Hammasi joyida ($warnings ogohlantirish)."
