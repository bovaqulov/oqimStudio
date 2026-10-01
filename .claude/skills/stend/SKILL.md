---
name: stend
description: Bring the local Oqim Studio stand up, or restore it after a power cut, a network drop or a reboot — tunnels, both .env files, Django, Celery, Next, the Telegram webhooks — then verify it end to end. Use whenever the stand is being started, has stopped answering, the tunnel URLs have changed, or the user says something like "svet o'chib qoldi", "loyihani ishga tushir", "tekshir".
---

# The local stand

Two applications and five processes. `restore.sh` in this directory does the
whole sequence; run it and read what it prints.

```bash
.claude/skills/stend/restore.sh
```

It is safe to run when things are already up — every step replaces what it
finds. Logs land in `/tmp/oqim-stend/`.

## Why a script and not five commands

A quick Cloudflare tunnel gets a **new random hostname every time it
reconnects**, and four separate things hold a copy of that hostname:

1. `backend/.env` — `PUBLIC_BASE_URL`, `FRONTEND_BASE_URL`,
   `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `TELEGRAM_LOGIN_DOMAIN`
2. `frontend/.env.local` — `ALLOWED_ORIGINS`
3. The login bot's webhook, registered with Telegram
4. Each workspace bot's webhook, also registered with Telegram

Restart the servers and miss any of them and the stand *looks* up while
answering nothing. That is the whole reason this exists.

## What bites, and how to recognise it

**A live `cloudflared` is not a live tunnel.** After a network drop the process
stays alive in a retry loop under a hostname that no longer resolves. `ps` shows
it running; `curl` returns `000`. Always check the URL, never the process — the
script kills and re-opens rather than reusing.

**Celery does not reload, and Celery is where the bot actually runs.**
`telegram/views.py` hands every update to `process_update.delay(...)`, so a
webhook that answers 200 proves only that Django is alive — the flow itself is
walked in the worker. `manage.py runserver` reloads on a file change and the
worker does not, so after editing anything under `apps/engine` the bot keeps
running the code it was started with, silently and indefinitely. The symptom is
the worst kind: tests pass, the stand is green, and the bot behaves exactly as
it did before the fix. Check the clock, not the process list:

```bash
ps -o pid,lstart -p $(pgrep -f "celery -A config worker" | head -1)
```

If that time is older than the edit, restart the worker (or re-run this
script). `FlowRunStep.payload` is the other witness — a step whose payload is
missing a field the new code always writes is a step the old code produced.

**A stale Turbopack cache serves deleted exports.** If a file was edited while
the dev server was watching — especially by a background agent mid-task — `.next`
can keep modules that import names the source no longer has. The symptom is
nasty: a feature silently stops working in the browser while `npm run typecheck`
and `npm run lint` are both clean. Look for `doesn't exist in target module` in
`/tmp/oqim-stend/next.log`. The script wipes `.next` for this reason.

**`*/` inside a block comment ends the comment.** A JSDoc line mentioning a path
like `` `features/*/data` `` closes the comment early and the file stops parsing;
Turbopack then reports the error on a *later*, innocent line. This has broken the
whole app once already. When a build error points at a line that looks fine,
search the comment above it for `*/`.

**`@sunrise_academy_bot` always reports `Unauthorized`.** It is a `seed_demo`
fixture whose token was invented, so it can never register a webhook. It is not
a regression and it belongs to the demo workspace, not the user's. Do not
"fix" it; the fix is deleting the demo if nobody wants it.

**Old invite links die with the tunnel.** `/join/<code>` links embed the panel
hostname at the time they were minted. After a URL change the user has to
generate new ones from Jamoa → Taklif havolasi.

## Checking it by hand

```bash
cd backend && .venv/bin/python manage.py test apps --settings=config.settings.test
cd frontend && npm run typecheck && npm run lint
```

The API can be driven directly with a token — useful when a browser cannot be
opened:

```bash
# a token for the Telegram-linked account
cd backend && .venv/bin/python manage.py shell -c "
from rest_framework.authtoken.models import Token
from apps.accounts.models import User
u = User.objects.filter(telegram_id__isnull=False).first()
print(Token.objects.get_or_create(user=u)[0].key)"
```

Then, with `$TK` and the API URL the script printed:

```bash
curl -s "$API/api/bots/managed-config/" -H "Authorization: Token $TK" -H "X-Workspace-Id: beltinguz"
curl -s -X POST "$API/api/auth/login/" -H 'Content-Type: application/json' \
     -d '{"email":"aziza@sunrise.uz","password":"Parol12345"}'
```

## Screenshots

Images sometimes fail to reach the model in a long session. The way through is
OCR — the user can save a screenshot over `data/image.png` and it can be read
locally:

```bash
sips -Z 2400 data/image.png --out /tmp/ocr.png && tesseract /tmp/ocr.png -
```

## What the stand is not

`TELEGRAM_OFFLINE=0` in `backend/.env`, so **real Bot API calls leave the
machine**. Sends from a workspace bot reach real people. Set it to `1` to work
without touching Telegram at all — but then the login bot's webhook cannot be
registered either, and `manage.py telegram_login_webhook` will claim success
while doing nothing, because offline mode returns a plausible fake result.
