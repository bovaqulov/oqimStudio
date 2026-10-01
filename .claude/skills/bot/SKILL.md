---
name: bot
description: The Telegram bot lifecycle in Oqim Studio — creating a bot from the panel without @BotFather (managed bots, Bot API 9.6), which token belongs to which bot, where each webhook lives, and why a bot stopped receiving updates. Use when a bot is being created or connected, when a webhook errors or reports the wrong URL, when getWebhookInfo has to be read, when TELEGRAM_OFFLINE is involved, or when the user says something like "bot javob bermayapti", "bot yaratilmadi", "webhook xato".
---

# Bots, tokens and webhooks

Two entirely different things in this product are called "bot", they hold
different tokens, their webhooks are registered by different code and they live
at different URLs. Almost every wasted hour here starts with confusing them.

|  | the manager / login bot | a workspace bot |
| --- | --- | --- |
| Who owns it | the deployment | one tenant |
| Where the token is | `TELEGRAM_LOGIN_BOT_TOKEN` in `backend/.env` | `bots.Bot.token`, one row per bot |
| Webhook URL | `<PUBLIC_BASE_URL>/api/auth/telegram/bot/` | `<PUBLIC_BASE_URL>/api/telegram/webhook/<webhook_token>/` |
| Registered by | `manage.py telegram_login_webhook` | `bots.services.register_webhook` |
| Header secret | derived from `SECRET_KEY` (`bot_login.webhook_secret`) | `Bot.webhook_secret`, per bot |
| `allowed_updates` | `["message", "managed_bot"]` | twelve, listed in `telegram/client.py` |

On this stand the manager is `@SelfeBot`. It does two jobs: it signs people in
(the Start-button flow in `accounts/bot_login.py`) **and** it owns every bot a
workspace creates from the panel (`bots/managed.py`). One deployment-level bot
rather than two, because a second one would be a second token to configure and
a second webhook to forget.

**The workspace webhook path carries `Bot.webhook_token`, not the bot id.**
`backend/README.md` and the comment in `config/settings/base.py` both still say
`/api/telegram/webhook/<bot_id>/`; they are stale. `services.webhook_url_for`
is the truth. The id is the bot's public `@username` — anyone who could read the
handle could read the URL — so the path now carries 256 bits of `new_secret`
and the header carries a separate secret. Two independent secrets, neither
derivable from the other.

Bringing the whole stand back up, tunnels and both webhooks included, is
`.claude/skills/stend/` — do not re-derive that sequence here.

## Creating a bot without leaving the panel

Bot API **9.6 (April 3, 2026)** let a bot own other bots. This is newer than
most models' training data, so the surface, verified against
`core.telegram.org/bots/api`:

- `getMe` → `User.can_manage_bots` — *"True, if other bots can be created to be
  controlled by the bot. Returned only in getMe."*
- `https://t.me/newbot/{manager_bot_username}/{suggested_bot_username}[?name={suggested_bot_name}]`
  — the link that opens Telegram's own creation screen.
- `Update.managed_bot` → `ManagedBotUpdated {user: User, bot: User}` — *"A new
  bot was created to be managed by the bot, or token or owner of a managed bot
  was changed."*
- `getManagedBotToken(user_id)` → the token, as a String. `user_id` is the
  **new bot's** id, not the creator's.
- `replaceManagedBotToken(user_id)` → revokes and returns a new token.
- `KeyboardButtonRequestManagedBot {request_id, suggested_name,
  suggested_username}`, reached through `KeyboardButton.request_managed_bot` —
  the same creation, offered as a reply-keyboard button instead of a link.
- `Message.managed_bot_created` → `ManagedBotCreated {bot: User}` — the service
  message left in the chat where the button was pressed.
- `savePreparedKeyboardButton` / `PreparedKeyboardButton` — the same button,
  for a Mini App.
- `setManagedBotAccessSettings(user_id, is_access_restricted, added_user_ids)`
  and `getManagedBotAccessSettings` / `BotAccessSettings` are **10.0**
  (May 8, 2026), not 9.6. Do not describe them as part of the original feature.

This codebase uses the link, `can_manage_bots`, the `managed_bot` update and
`getManagedBotToken`. The keyboard-button and Mini App variants, token
replacement and access settings are not wired to anything — grep before
assuming otherwise.

### The one thing that is easy to get wrong

`/start` deep links carry a payload. **This link does not.** It carries a
manager username, a suggested bot username and an optional display name, and
nothing of ours survives the round trip. `ManagedBotUpdated` names only the
person and the new bot; `ManagedBotCreated` names only the bot.

So when the update lands on the manager's webhook there is exactly one thread
back to the person who pressed the button in the panel: **their Telegram user
id**, in `ManagedBotUpdated.user.id`. That is the whole reason
`bots.models.ManagedBotRequest` exists — it holds the Telegram id alongside the
workspace and project the bot should land in — and the whole reason
`managed.open_request` refuses an account with no `telegram_id` (`reason:
"telegram_required"` on `GET /api/bots/managed-config/`). An account that
signed in with a password has no id for the update to match.

It also explains the 15-minute `REQUEST_TTL` and why opening a request marks
that person's older pending ones failed. A request left open forever would
claim the *next* bot that person creates anywhere, months later, through any
link, and file it into a project they had forgotten. `managed.claim` matches on
`telegram_id` + `PENDING` + not expired, newest first — nothing narrower is
available.

### The path, end to end

`POST /api/bots/create-request/` (username validated only enough to make the
link well-formed: 5–32 chars, must end in `bot` — Telegram's own screen is the
only place "that username is taken" can be discovered) → panel opens the
`t.me/newbot/…` link in a new tab and polls
`GET /api/bots/create-request/<id>/` every 2s → the reader confirms on
Telegram's screen → `managed_bot` arrives at
`/api/auth/telegram/bot/` → `telegram_views.telegram_bot_webhook` hands it to
`managed.handle_update` → `getManagedBotToken` → `managed._store` writes the
`Bot` row and registers its webhook on commit → the poll returns `ready` and
the panel navigates to the bot.

`_store` deliberately does not call `services.connect_bot`: that one starts with
`getMe` to learn whose token this is, and Telegram has just said so in the
update that carried it.

Two ways this silently breaks:

- **`managed_bot` missing from the login bot's `allowed_updates`.** Telegram
  will not deliver an update type that is not listed. The bot gets created on
  Telegram's side and never arrives here; the panel polls until the request
  expires. `bot_login.install_webhook` lists it — anything that re-registers
  that webhook by hand must too.
- **A `Bot` row already exists with that `telegram_id`.** `handle_update`
  returns early, by design: the same update shape announces a token
  *replacement*, and re-storing it would duplicate the row. The side effect is
  that a replaced token is never written back — the stored one goes stale and
  nothing says so.

## `TELEGRAM_OFFLINE` is a trap, not a safety net

With `TELEGRAM_OFFLINE=1`, `telegram/client.py` never opens a socket. It
records the call and returns a plausible fake: `getMe` returns
`@offline_bot`, `getWebhookInfo` returns `{"url": "", "pending_update_count":
0}`, anything starting with `send` returns a message id, and **every other
method returns `True`** — `setWebhook` included.

Which means:

- `manage.py telegram_login_webhook` prints `Webhook o'rnatildi:` in green
  while registering nothing at all. This has cost real time. It is not lying
  about the URL, only about having sent it.
- `connect_bot` accepts *any* string as a token. It marks such a bot
  "Sozlanmoqda" / unverified and logs "Offline rejim — token Telegramda
  tekshirilmadi" rather than pretending, but the row exists.
- The managed-bot path cannot be exercised offline at all:
  `getManagedBotToken` falls through to the `return True` default, so the token
  column would be handed a boolean.

`config/settings/test.py` forces it on, which is why the whole runtime is
testable with no network — and why there are no tests covering the managed-bot
path. `backend/.env` on this stand has `TELEGRAM_OFFLINE=0`: real calls leave
the machine and sends reach real people.

## When a bot goes quiet

Our columns are a claim; only Telegram knows. Ask it directly — this is
read-only and safe:

```bash
cd backend && .venv/bin/python manage.py shell -c "
from apps.bots.models import Bot
from apps.telegram.client import client_for
for b in Bot.objects.exclude(token=''):
    print(b.handle, client_for(b).get_webhook_info())"
```

`Bot` stores both halves on purpose: `webhook_url` is where we last told
Telegram to post, `webhook_actual_url` is where Telegram says it is posting.
Those two disagreeing *is* the failure — our column reads "connected" while the
bot receives nothing. `webhook_pending_updates` above zero means Telegram is
holding messages it could not deliver right now.

`services.reconcile_webhooks` is the repair: for every bot with a token it runs
`check_webhook` first and re-registers **only** if Telegram disagrees, so it is
cheap to run often and reports `changed: false` when all is well. It runs from
four places — `bots/apps.py:ready()` when a server boots, `worker_ready` in
`config/celery.py`, the beat schedule every 600s, and the panel's own
`POST /api/bots/reconcile-webhooks/`. Two processes read the environment
separately, which is exactly how a stale `PUBLIC_BASE_URL` in one of them once
left live bots pointed at a dead tunnel; whoever boots last wins. Opening a
bot's page also repairs it (`BotViewSet.retrieve`).

`GET /api/bots/<id>/webhook/` is the one to reach for when a person is waiting:
it adds a `probe` that actually dials the address, because "Telegram has the
right URL on file" and "something answers there" are different claims and a
dead tunnel satisfies the first. Any HTTP answer counts as reachable — a 401
or 405 from the webhook endpoint is what health looks like there.

**`@sunrise_academy_bot` reports `Unauthorized` forever.** Its token
(`7842119503:AAF718264444xQe-demo-token`) is invented, hard-coded in
`seed_demo`, and belongs to the demo workspace. Not a regression, not fixable —
the only fix is deleting the demo.

A bot whose webhook is genuinely fine and still says nothing:

- `Bot.enabled_modules` — a module missing from the list is off, and
  `matching.find_trigger` refuses before looking for a flow. An empty list is
  the exception: it answers `dms` anyway. Nothing stands behind that refusal
  any more — the safety net that used to answer an unmatched message is gone,
  so a module that is off is silence, and the message is filed to «Suhbatlar»
  by `record_inbound` for an operator to find.
- The flow is not enabled, or `FlowTrigger` never got rebuilt — the index is
  derived from the graph on every save (`flows.services.reindex_triggers`).
- The header secret does not match: `telegram/views.py` answers 401 and writes
  "Webhook rad etildi — maxfiy kalit mos kelmadi" to the bot's own activity
  log, at most once per 5 minutes per problem. Every webhook detour lands
  there; read `BotActivity` before guessing.
- The update was already processed. `engine.models.ProcessedUpdate` makes the
  webhook idempotent per `(bot, update_id)`, so a redelivery is dropped
  silently by design.

## What only a human can do

Two prerequisites live in Telegram, not in this repository, and no code here
can set them.

**Bot Management Mode**, switched on in the @BotFather Mini App under the
manager bot's own settings. Telegram's docs say it plainly of
`request_managed_bot`: *"Available for bots that enabled management of other
bots in the @BotFather Mini App."* Check it, never assume it — the answer is
`getMe().can_manage_bots`, which is what `managed.can_manage_bots()` asks and
what surfaces as `reason: "management_off"`:

```bash
cd backend && curl -s "https://api.telegram.org/bot$(grep '^TELEGRAM_LOGIN_BOT_TOKEN=' .env | cut -d= -f2-)/getMe"
```

A copy of that answer in the environment would be a setting that can disagree
with Telegram, so there is none.

**`/setdomain`** with @BotFather, for the Login Widget only. It is genuinely
optional: the widget refuses to render anywhere but the registered domain — and
renders its own English error inside a cross-origin iframe nobody can style,
which is why `telegram_config` probes `oauth.telegram.org/embed/<username>`
before offering it — but the Start-button flow in `bot_login.py` needs no
domain at all and is what a tunnelled stand uses. `TELEGRAM_LOGIN_DOMAIN` is
the panel's host, not the API's, and must be set only *after* `/setdomain`.
