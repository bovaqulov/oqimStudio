# Oqim Studio — backend

Django + DRF backend for the Telegram bot studio. It stores the workspaces,
bots and flow graphs the editor draws, receives Telegram's webhooks, **runs**
those graphs against real conversations, and pushes what happens to the browser
over WebSocket.

```
Telegram ──webhook──▶ Django (ASGI)
                        │  enqueue
                        ▼
                      Celery worker ──▶ flow runtime ──▶ Bot API
                        │                    │
                        └──── Redis ─────────┘
                                 │ channel layer
                                 ▼
                        WebSocket ──▶ Next.js frontend
```

## Stack

| Piece | What it does here |
| --- | --- |
| Django 6.1 + DRF | Models and the REST API under `/api/` |
| SQLite | The dev database (`backend/db.sqlite3`) |
| Channels + Daphne | WebSocket under `/ws/`, and the ASGI dev server |
| Celery | Update processing, delayed blocks, scheduled checks |
| Redis | Celery broker **and** the Channels layer |
| Node 22+ | The script sandbox only — see below. Optional: without it the script block reports `unavailable` and the rest of the runtime is unaffected |

## Getting started

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
cp .env.example .env

.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py seed_demo        # the demo workspace the UI ships with
.venv/Scripts/python manage.py runserver        # ASGI (Daphne): HTTP + WebSocket on :8000
```

Two more processes, once Redis is up (`docker run -p 6379:6379 redis:7`):

```bash
.venv/Scripts/python -m celery -A config worker -l info --pool=solo   # --pool=solo on Windows
.venv/Scripts/python -m celery -A config beat -l info
```

`seed_demo` creates the same tenant the frontend's in-memory seeds describe:

- **aziza@sunrise.uz / Parol12345** — owner of *Sunrise Agency*
- **jasur@sunrise.uz / Parol12345** — editor
- project *Sunrise Academy*, bot *@sunrise_academy_bot*, three flows, three
  weeks of analytics events

`--reset` rebuilds it from scratch.

Without Redis the API and the admin still work; only Celery and the WebSocket
layer need it.

## Layout

```
config/          settings (base/dev/prod/test), urls, asgi, celery, ws routing
apps/
  common/        tenancy, error shape, the JSON-everywhere middleware, pagination, seed_demo
  accounts/      users, email verification, password reset
  workspaces/    tenants, memberships, roles, invites
  projects/      projects and their activity trail
  bots/          bots, tokens, webhooks, business + payment connections
  contacts/      the people on the other side of a bot, tags, variables
  flows/         flow graphs, the trigger index, runs and their steps
  engine/        the runtime: parse → match → walk → send
  agents/        AI agents: who they are, what they may do, every turn they took
  telegram/      Bot API client and the webhook endpoint
  analytics/     event log and the reports built from it
  billing/       plans, subscription, invoices, usage
  apikeys/       scoped keys for outside programs: model, auth, scopes, throttle
  publicapi/     /api/v1/ — the open surface those keys reach
  notifications/ the bell, and what the workspace socket pushes
  marketplace/   template store and installs
  realtime/      consumers, socket auth, broadcast helper
  engine/script/ the JavaScript sandbox: limits, the runner, the Node host
```

### How a message becomes an answer

1. `POST /api/telegram/webhook/<webhook_token>/` — checks the secret, enqueues, answers
   200. Telegram retries anything slow, so the handler does nothing else.
2. `engine.tasks.process_update` → `engine.dispatch.dispatch`.
3. `engine.events.parse_update` normalises a dozen Telegram shapes into one
   `IncomingEvent`.
4. A run already **waiting** on this contact gets first refusal — but only for
   what it actually asked for: a pressed button, a question's answer, or a reply
   keyboard's row by its label. Anything else typed past a keyboard is a new
   conversation, and the keyboard stays tappable.
5. Otherwise `engine.matching.find_trigger` takes the first matching
   `FlowTrigger`, ordered by the same priority ladder the editor draws.
6. `engine.runner` walks the graph, block by block. Questions, delays and
   invoices park the run; everything else continues out of a port. The editor's
   test chat drives *this* runtime rather than a second walker of its own — two
   implementations of one rulebook is how a green test chat ends up next to a
   broken bot.
7. Nothing matched: `engine.fallback` answers anyway. A bot that walks a
   customer through a flow and then goes silent on their next sentence reads as
   broken, not as "that was not covered", so an unclaimed private message gets
   one line and the buttons back to the menu. What it says lives under
   `Bot.settings.fallback` (`bots.models.default_fallback`), and a menu button
   carries `cmd:<command>` — `dispatch` turns that back into the update the
   typed command would have been.

`FlowTrigger` rows are **derived**: they are rebuilt from the graph on every
save (`flows.services.reindex_triggers`), so the index can never disagree with
what the author drew.

### Graphs that did not come from the editor

A flow graph can now be written somewhere else — by another model, by a script —
and uploaded. That breaks the assumption the API rested on: the editor cannot
draw a block type that does not exist or an edge leaving a port nobody
published, so nothing checked either. `apps/flows/vocabulary.py` is the block
vocabulary in Python (23 types and the exits each publishes) and
`apps/flows/graph_validation.py` reads a graph against it.

| Endpoint | What it does |
| --- | --- |
| `GET /api/flows/schema/` | The vocabulary, written to be pasted into another model — the envelope first (`howTo`), then one entry per block with its ports and fields. Any member. |
| `POST /api/flows/import/validate/` | A dry run: `{ok, findings, summary}` and nothing written. |
| `POST /api/flows/import/` | Files the graph as a **new** flow. Never replaces one — there is no flow id in the payload, because an upload that overwrote a running bot is not what anybody asked for. Refused with the whole report when there is an error. |
| `GET /api/flows/<id>/export/` | The graph as a file: `schemaVersion`, name, description, module, nodes and edges. Nothing that ties it to this flow — no id, no bot, no `enabled`. Any member. |

An **error** refuses the write (unknown type, an edge leaving a port the block
does not publish, an edge with no `port` at all, an edge into an entry block, a
duplicate or missing id, two flow-owned entry blocks, an oversized script). A
**warning** does not (an unwired named exit, an empty body, a block nothing
routes into, no entry block) — a graph is uploaded in order to be finished.

`PUT /flows/<id>/graph/` goes through the same check, which is worth more than
the import feature it came with: autosave is where nearly every graph in the
product is written, and until now it checked ids and edge endpoints and nothing
else.

**The drift risk.** `vocabulary.py` is the *second* copy of the block table —
the first is `frontend/src/features/flow-builder/node-definitions.ts`, and the
editor is where a block type is always added first.
`apps/flows/tests_vocabulary_contract.py` parses that TypeScript and asserts the
two agree on the set of types, each one's fixed ports, and the entry sets. It is
a contract rather than a unit test: when it fails it is telling you the editor
moved and the backend has not, and the fix is in `vocabulary.py`. `flows.models.ENTRY_NODE_TYPES`
and `engine.runner.PASSTHROUGH_TYPES` are both derived from it now, so the three
hand-written copies of those six strings are down to one.

## API

Everything lives under `/api/`. Payloads are camelCase, matching the TypeScript
types in `frontend/src/features/*/types.ts` — the frontend can point
`NEXT_PUBLIC_API_BASE_URL` at this service without a translation layer.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/{signup,login,logout,verify-email,forgot-password,reset-password}/`, `GET /api/auth/session/` |
| Telegram login | `POST /api/auth/telegram/`, `GET /api/auth/telegram/config/` |
| Tenancy | `/api/workspaces/`, `/api/workspaces/<id>/members/`, `/api/members/<id>/`, `/api/workspaces/join/` |
| Projects | `/api/projects/`, `/api/projects/<id>/activity/` |
| Bots | `/api/bots/`, `.../reveal-token/`, `.../rotate-token/`, `.../webhook/`, `.../payments/`, `.../payments/<provider>/` (DELETE disconnects, POST re-checks), `.../payment-history/`, `.../script-library/` (GET/PUT), `.../scripts/`, `.../chats/`, `.../chats/<chat_id>/refresh/`, `.../chats/<chat_id>/` (DELETE forgets the row) |
| Flows | `/api/flows/` (`?withGraph=1` includes the blocks), `.../graph/`, `.../enable/`, `.../duplicate/`, `.../test/`, `.../test-reply/`, `.../export/`, `/api/flows/main/` (POST may carry the entry graph), `/api/flows/schema/`, `/api/flows/import/validate/`, `/api/flows/import/` |
| Contacts | `/api/contacts/`, `.../tags/`, `.../variables/` |
| Analytics | `/api/analytics/`, `/api/analytics/dimensions/` |
| Billing | `/api/billing/{plans,subscription,invoices,usage}/` |
| Market | `/api/market/templates/` (`?mine=1` for this workspace's own), `.../install/`, `.../review/` |
| Agents | `/api/agents/` (tools written with the agent), `/api/agents/status/`, `/api/agents/<id>/runs/` |
| API keys | `/api/api-keys/` (GET lists, POST mints, DELETE revokes) |
| Telegram | `POST /api/telegram/webhook/<webhook_token>/` |
| **Open API** | `/api/v1/…` — see below. Routes of its own, not aliases. |

**Tenancy.** Every tenant-scoped request resolves its workspace from the
`X-Workspace-Id` header (or `?workspaceId=`), *validated against the caller's
memberships*. An unknown one is a 404, a read-only role writing is a 403. No
endpoint can be asked for another company's data.

**Auth.** Session cookie (what the Next.js server forwards) or
`Authorization: Token <key>` (scripts, sockets). Both come back from
`/api/auth/login/`, and both *are* the account. An outside program gets neither
— it gets a scoped `Authorization: Bearer oq_live_…` key, which reaches
`/api/v1/` and nothing else (see "The open API" below). Note that session auth also enforces CSRF on unsafe
methods — a caller holding the cookie has to send `X-CSRFToken` too, which is
one reason the token exists.

**Signing in with Telegram.** `POST /api/auth/telegram/` takes the Login
Widget's payload exactly as Telegram signed it and checks the HMAC with
`TELEGRAM_LOGIN_BOT_TOKEN` (see `accounts/telegram_auth.py`), refusing anything
tampered with or older than a day. An account created this way has no real
address — Telegram hands none over — so it gets a `tg<id>@telegram.local`
placeholder, no usable password, and is verified from the start: Telegram
established the identity, which is stronger than a clicked link. The widget
only works once the bot's domain is registered with @BotFather (`/setdomain`).

**Mail.** Verification and reset mails carry both a link into the interface
(`FRONTEND_BASE_URL`) and the bare code. In development `DJANGO_EMAIL_BACKEND`
is the console backend, so they are printed to the server log and **nothing is
sent** — point it at `django.core.mail.backends.smtp.EmailBackend` with real
SMTP settings to actually deliver.

**Rate limits.** The endpoints reachable without an account have a ceiling:
12/min for signing in, verifying and resetting, 5/min for anything that mails
somebody. Over it the answer is `429` with code `rate_limited`. Counters live in
the cache — Redis in production, in-process in dev, so a laptop can sign in with
the broker down.

The open API has one as well: 120/min **per workspace**, not per key — a
ceiling anybody can raise by minting a second key is not a ceiling
(`apikeys/throttling.py`).

One signed-in endpoint has one too: `POST /api/flows/script/run/`, at 30/min
**per account**. It spawns a Node process inside the Django process that serves
every other screen, so exhausting it does not degrade scripts — it takes the
editor down for everybody. Per account and not per address, because the panel
reaches Django through the Next.js server and that server forwards no client
address: an address bucket here would be one bucket for the whole company (the
same fact the `auth-poll` note in `settings.base` is written around).

**Errors.** One shape: `{"error": {"code", "message", "field?"}}`, with the same
codes `AuthError` already uses in the frontend — and it now covers the answers
no view wrote, too. `apps/common/middleware.py` puts every non-JSON refusal
under `/api/` into that envelope: an unrouted path (`404 unknown_endpoint`,
naming the method and path and *not* listing the routes that do exist), a body
over `DATA_UPLOAD_MAX_MEMORY_SIZE` (`413 payload_too_large`), an unhandled 500
with debug off. An HTML page reaches an API client as a JSON parse error, which
is the one failure where the real cause is written in an `<h1>` nothing reads.
Middleware and not `handler404`, because `handler404` is skipped entirely when
`DEBUG` is on and an API that answers one shape on a laptop and another on a
server cannot be tested on the laptop.

The same file upgrades the `APPEND_SLASH` redirect from `301` to `308` for
methods that carry a body. curl, `requests` and `fetch` all answer a 301 by
re-sending as GET with nothing attached, so a POST one character short of the
route arrived as an empty read and came back `405` with no sign a graph had
been dropped.

**And in one language.** DRF ships no `uz` catalogue at all — the messages that
did come back in Uzbek did so because Django's own catalogue happens to hold
that exact English sentence. `common.exceptions.UZBEK_DEFAULTS` covers the
handful DRF alone says (a wrong method, a throttle, a media type nothing
parses), and only ever replaces a message that is still the library's default,
so an error this codebase worded keeps its words.

**Who calls this.** The Next.js server, on the reader's behalf: it holds the
token in an httpOnly cookie and adds `X-Workspace-Id` from the workspace
switcher. `GET /api/auth/session/` honours that header too, so the `role` it
returns is the role in the workspace being viewed and not in some other one.

## The open API — `/api/v1/`

Another program — a CRM, a script, a model writing a flow — needs to read and
write here without a person's account. `Authorization: Bearer oq_live_…` is how
it does that, and `apps/apikeys` plus `apps/publicapi` are the two halves.

```
GET    /api/v1/me/                       (any live key)  what this key is and may do
GET    /api/v1/flows/                    flows:read      summaries
GET    /api/v1/flows/<id>/               flows:read      with the graph
POST   /api/v1/flows/import/             flows:write     a graph becomes a new flow
PUT    /api/v1/flows/<id>/graph/         flows:write     replaces one
GET    /api/v1/bots/                     bots:read
GET    /api/v1/contacts/                 contacts:read
```

`/me/` is the one that carries no scope, deliberately: it answers "which
workspace is this key in and what may it do", and a key missing `flows:read` is
exactly the key whose holder is asking. It returns the key's name, prefix,
scopes, workspace and `lastUsedAt` — never the key, never its digest, and never
the other keys in the workspace. Before it existed the first thing that told an
integration anything about its credential was a real request, so a key pasted
from the *wrong workspace* announced itself as `403 insufficient_scope` and
sent somebody to tick a box that was never the problem.

**The lists are ordered to be walked.** `?limit=`/`?offset=` until `next` is
null is what a CRM sync does, and offset paging is only correct over a total,
unmoving order. The models' own is neither — `Contact.Meta.ordering` is
`-last_seen_at`, rewritten by every incoming message — so a customer writing to
the bot mid-walk moved to the front and the row at the page boundary was served
twice or never. The public lists re-order on a column that does not move, with
the primary key behind it (`publicapi.views.WalkableListMixin`).

**Not an alias of `/api/…`, and that is the point.** `/api/flows/` is the
editor's own endpoint: it moves when the editor moves, and every one of those
perfectly ordinary internal changes would break an outside caller pointed at
the same URL — silently, weeks later, in somebody else's deployment. So the
routes are separate and the views are their own, written out by hand rather
than through a router (a router would publish whatever an internal viewset
happens to grow next). What *is* shared is the part that must never diverge:
the serializers, `refuse_unwalkable_graph`, `graph_validation`,
`reindex_triggers` and `billing.services.check_plan_allows`. A graph the editor
refuses is refused here, and a plan limit reachable round the side is not a
limit.

One rule is **stricter** here than in the panel. The editor's autosave skips
the AI-block check because refusing it would lock an author out of the edit
that removes the blocks; nobody is typing on this surface, so
`PUT /api/v1/flows/<id>/graph/` applies `check_graph_allows` when the flow is
already enabled — the moment its blocks cost money. It cannot trap anyone: the
check counts the incoming graph, so a call that removes AI blocks always
passes.

**A key is not an account.** The DRF token from `/api/auth/login/` *is* the
account — every workspace its owner belongs to, the bot tokens, the invoices,
the team screen, no scope and no way to withdraw it without signing the person
out. An `ApiKey` names one workspace, carries a fixed set of scopes, and is
revoked without touching anybody's sign-in.

| | Behaviour |
| --- | --- |
| Shape | `oq_live_` + 32 base62 characters (~190 bits) |
| Stored | SHA-256 of the whole key, unique and indexed. Never the key |
| Returned | Once, in the create response. Never in a list |
| Tenant | `request.auth.workspace`. `X-Workspace-Id` naming another one is `404` |
| Scope | `flows:read`, `flows:write`, `bots:read`, `contacts:read`. Missing one is `403` naming it. `flows:write` does **not** imply `flows:read` — both write endpoints answer with the whole flow, graph included, so a key holding only `write` can still read back everything it wrote |
| Revoked | `401`. The row stays — it is the only record of what was calling |
| Rate | `api-key`, 120/min **per workspace** |

**Why SHA-256 and not a password hasher.** PBKDF2 is slow because a human
password has ~30 bits behind it; 190 bits of `secrets` needs no such help, and
the slowness would be paid on every request. The deeper reason is that a salted
hash cannot be *looked up*: authentication would have to read every key row and
verify each one, before it even knows which workspace to narrow to. SHA-256
makes it one `WHERE hashed = ?`.

**The creator leaving does not break the key.** A key is workspace
infrastructure — the CRM on the other end does not know which employee pasted
the string in — so `created_by` is `SET_NULL` and the row survives. Revoking on
departure would take a production integration down at a moment nobody is
watching, and leave nothing behind to explain the outage. Departure is made
*visible* instead: `created_by_name` is a snapshot, so the audit line still
names who made it after the account is deleted, and `last_used_at` says whether
anything is still calling. Reviewing is a human decision, because only a human
knows whether the departing person *was* the integration.

**No expiry, deliberately.** An expiry date promises a warning and a rotation
path; neither exists yet, so the column would only buy an integration that
stops at 03:00 on a date nobody remembers agreeing to. `revoked_at` is the off
switch and `last_used_at` is what makes a forgotten key visible. When there is
a rotation flow to hang it off, expiry is one nullable column.

**Who may mint one.** `WRITE_ROLES` — owner, admin and editor; an analyst may
read the list and nothing else. The rule is the codebase's own "nobody hands
out more than they hold": all four scopes name things a write role already does
from the panel, so a key grants its maker nothing new, it only changes what is
holding the credential. Owner/admin-only was the other candidate and is the
wrong line — it puts the person building the integration on one side and the
person who may mint its credential on the other, and integrations that need an
approval round trip get built with somebody's personal token instead. That
holds only while every scope stays inside an editor's reach: a future
`bots:write` would need its own gate. `apps/apikeys/views.py` argues it at
length, and there is no role check in that file precisely because
`IsWorkspaceMember` already is one.

## WebSocket

```
ws://localhost:8000/ws/workspace/<workspace_id>/?token=<key>
ws://localhost:8000/ws/flows/<flow_id>/?token=<key>
ws://localhost:8000/ws/bots/<bot_id>/?token=<key>
```

Membership is checked at handshake, not per message. The sockets are one-way by
design — anything a client wants to *do* goes through the REST API, where
permissions already live. Events: `run.started`, `run.step`, `run.parked`,
`run.finished`, `update.received`, `bot.activity`, `notification.created`.

## Background work

| Task | When |
| --- | --- |
| `engine.tasks.process_update` | every webhook |
| `engine.tasks.resume_run` | countdown, from a "Kutish" block |
| `engine.tasks.resume_due_runs` | every minute — the net under lost wake-ups |
| `bots.tasks.check_webhooks` | hourly — Telegram drops failing webhooks quietly |

Reports aggregate the event log directly, on the indexes in
`analytics/models.py`. There is no nightly rollup table: one only pays for
itself once the log behind it is pruned, and how long a workspace's events are
kept is a decision nobody has made yet.

## Scripts

A flow block can run an author's JavaScript. It runs in a Node subprocess that
has been given nothing worth reaching:

| Boundary | What it closes |
| --- | --- |
| `--permission` | Filesystem, network, subprocess, worker threads, native addons, inspector, WASI |
| `--disallow-code-generation-from-strings` | `eval`, `new Function` |
| A resolve hook in `host.mjs` | Every `node:` builtin — so the leaks a capability model does not cover (the host name, the account the server runs as) close too |
| An empty environment, and a replaced `process` | `process.env`, `argv`, `cwd()`, `execPath` — each of which spells out an absolute path |
| `--max-old-space-size` and a parent stopwatch | A script that will not stop is killed rather than reasoned with |
| A separate process | Whatever happens in there, happens in there |

`apps/engine/tests/test_script_sandbox.py` is the statement of all six, written
as escapes that must not work. It is a contract rather than a unit test: if one
of those lines starts passing, the boundary it names is gone, and the failure
message says which.

**The bot's library.** Imports are one of those six boundaries, so there is no
module system to hang a shared file off — and an author who wants the same
discount helper in four blocks needs one. `Bot.script_library` is that file,
and it is *prepended* to every block before the sandbox sees it
(`engine.script.compose`), which buys shared functions without buying a loader.
`GET`/`PUT /api/bots/<id>/script-library/` is where it is edited, capped at
50 000 characters; its `updatedAt` is null until somebody first saves, and is a
column of its own rather than the bot's `updated_at`, which moves for a rotated
token.

The price is line numbers, and it is why `compose` is a module rather than a
`+`: what runs is one body, and a fault in it is reported against a line of
*that*, while the author is looking at two separate editors. `compose` returns
the composed source and how many lines the library took; `locate` turns the
sandbox's number back into `("library" | "block", line)`, so a trace says
«kutubxona, 2-qator» instead of pointing at line 10 of a four-line block.

**What the bots actually run.** `GET /api/bots/<id>/scripts/` lists every Kod
block across that bot's flows — the library, then one row per block with its
flow, node id, variable and source — read straight out of `Flow.nodes`.
Readable by any member: code inside a canvas is code nobody reviews, and the
answer to "which of our bots run JavaScript" should not be "open every flow".

Node is looked up on `PATH` at call time. On a machine without it,
`script.is_available()` is false and the block reports `unavailable` — nothing
else in the runtime changes.

**How many at once.** All six boundaries above are per script; none of them
says anything about the fortieth. `engine.script.concurrency` is the one that
does, and it is applied inside `run_script` so neither call site can forget it:
`SCRIPT_MAX_CONCURRENT` (8) is what the deployment may run at one time, and
`SCRIPT_MAX_CONCURRENT_PER_WORKSPACE` (4) is what any one tenant may take of
that. The second is the half that buys fairness — a host cap alone buys a
queue, and the busiest tenant wins a queue every time.

A slot is a numbered key in the Django cache, so the ceiling is the
deployment's rather than one process's: Celery defaults its concurrency to the
CPU count, and an in-process semaphore of eight would be a hundred and
twenty-eight on a sixteen-core box while reading in a log exactly like a cap
that works. Every key carries its own expiry, which is why it is numbered keys
and not a counter — a worker killed mid-script leaves one slot held and that
slot comes back by itself a few seconds later, where a counter incremented and
decremented would be short forever. A cache nobody can reach lets the script
run, loudly: this is what a box can afford, not one of the six boundaries.

A block that could not be started reports `busy` and takes its `error` exit,
the same as a broken one — the graph has no third case to draw — but the step
reads «Kod ishga tushmadi» rather than «Kod xato», because there is nothing in
the source for the author to find.

## Tests

```bash
.venv/Scripts/python manage.py test apps --settings=config.settings.test
.venv/Scripts/python -m ruff check apps config --select=F,E9,B,I --line-length=120 --exclude "*/migrations/*"
```

The test settings use an in-memory channel layer, run Celery tasks inline and
force `TELEGRAM_OFFLINE`, so the whole path — webhook → dispatch → run → socket
— is exercised with no Redis, no broker and no network.

Linting needs `requirements-dev.txt`.

## Placeholders

`{{...}}` in a block's text resolves against the run's context, using the names
the editor's own variable menu inserts (`frontend/src/features/flow-builder/lib/variables.ts`):

`user.first_name`, `user.last_name`, `user.username`, `user.id`,
`chat.id`, `chat.type`, `chat.title`, `message.text`, `message.id`,
`message.date`, `business.connection_id`, `bot.id`, `bot.username` — plus
`mijoz_ismi` / `mijoz_telefoni`, which the intake template writes, and anything
a "Teg / o'zgaruvchi" block or a question has stored on the contact.

An unknown name keeps its braces: a visible `{{typo}}` is a bug the author can
see, an empty gap is one they cannot.

A question whose `answerType` is `contact` or `location` is answered by a tap,
not by typing — the shared phone number (or `lat,lon`) is what gets stored, and
a phone number is kept on the contact as well. Telegram leaves the keyboard
open, though, so a typed answer to a `contact` question is checked against the
phone rules rather than stored as-is (`engine.validation.CHECK_AS`).

## Groups and channels

Which chats a bot is in is a fact only Telegram has, and it announces it in
exactly one place: `my_chat_member`, when the bot is added, promoted, demoted or
removed. That update used to be read for one thing — a private chat going to
`kicked` is somebody blocking the bot — and dropped otherwise, so nothing
anywhere recorded that a bot was in a group at all.

`bots.BotChat` is that record, one row per `(bot, chat)`, written by
`bots.chats.record_membership` from the webhook path. It is filed in
`engine.dispatch` before a contact is created or a trigger is looked for: a
status change is not a conversation, nobody is waiting for an answer, and it
never reaches Suhbatlar. The row holds the title, the type, the bot's own
`ChatMember.status`, the `ChatMemberAdministrator` booleans, the member count
and when that count was read.

**A refresh that fails keeps the row.** The list endpoint is served from this
table and only `POST .../chats/<chat_id>/refresh/` calls out — `getChat`,
`getChatMemberCount`, `getChatMember`, each allowed to fail on its own. A
refusal writes `refresh_error` and nothing else, because writing back what a
failed call returned would empty the row: a screen that loses a group's title,
rights and members because one call timed out has just told its reader the bot
was thrown out of a chat it is still in. The one exception is `403`, which is
Telegram saying the bot is not in that chat — recorded as a departure, since the
alternative is a panel showing the bot as an administrator of a group that
removed it while the webhook was down.

`bots.chats.chat_problems` is what the panel renders, and it is the join of
three facts that live in three places: the bot's `enabled_modules`, the rights
Telegram granted, and whether the last refresh landed. On the server because a
second copy of that rule is how a chat comes to read as healthy on one screen
and broken on another.

Not built, deliberately: approving join requests from the panel. The Bot API has
`approveChatJoinRequest`/`declineChatJoinRequest` but no way to *list* pending
requests, so a queue would have to be a table of our own fed by
`chat_join_request` updates, with an expiry policy and an answer for the
requests that arrived while the webhook was down. That is a feature, not an
endpoint. A `joinrequest` flow already answers the applicant in their private
chat today.

## Payments

The invoice block is `sendInvoice`. Three things have to be right or the money
never moves, and all three live in `engine`:

- **`provider_token`** — required on every currency. Telegram Stars (`XTR`)
  need it present and empty and have no subunit, so 7 stars is `7`; every other
  currency is billed through the merchant token of the payment connection the
  block names (`runner._provider_token`) and is scaled by 100.
- **The Pay button comes first.** "If not empty, the first button must be a Pay
  button" — so `sender.build_keyboard` puts Telegram's own row in front of the
  author's, instead of replacing it with buttons that cannot take money.
- **`pre_checkout_query` must be answered within ten seconds**, or the payment
  fails with nothing said on either side (`dispatch._answer_pre_checkout`).

`successful_payment` then continues the parked run out of its `paid` port; a
button of the author's under the Pay row is how the flow branches on a customer
who changed their mind.

What a confirmed charge leaves behind is two analytics events — a `conversions`
count and a `revenue` row carrying the amount, the currency and the contact — and
`GET /api/bots/<id>/payment-history/` reads those back for the bot's *To'lovlar*
tab, newest first (`?limit=`, 50 by default, 200 at most). There is no payments
table behind it, which is also the limit of what the panel can show: an `Event`
has nowhere to put the invoice title, the provider that took the money or
Telegram's `provider_payment_charge_id`, so those stay off the screen until
something stores them.

## AI agents

A flow answers what it was drawn to answer. An agent answers what it was not —
and the price of that is that nobody can predict what it will say, which is why
it is a **block on the canvas** rather than a replacement for the flow.

`agent.ask` sits in the graph with three exits — `answered`, `unclear`,
`handoff` — so the deterministic flow keeps control on both sides of it.
Payment, personal data and cancellation are never handed to a model, and an
author can *see* what the agent may do, because its outcomes are drawn.

```
apps/agents/
  models.py     Agent · AgentTool · AgentRun · AgentMessage
  catalogue.py  which models, what each one's request may contain, what it costs
  provider.py   the one place a model is called. Nothing raises out of it.
  tools.py      the schema the model sees, and the check nothing skips
  guard.py      the last thing between an answer and a customer reading it
  services.py   the turn loop, the budgets, the trace
```

**Its tools are the blocks that already exist.** An HTTP tool goes through
`engine.safe_http`, which already refuses the metadata endpoint, loopback and
the private ranges; a `save` tool writes a contact variable the way
«Ma'lumotni saqlash» does; a `handoff` tool ends the turn on the block's
«Operatorga» exit, where the author has drawn what a handover means. There is
no second tool system, because a second one would be a second set of holes.

**Prompt injection is the threat this is designed around.** The layers, in the
order they matter:

1. The system instruction is one database column plus a fixed preamble. There
   is no code path from a Telegram message to either, so an injection can argue
   with the instruction and never become it.
2. A customer's words arrive inside `<mijoz_xabari>`, and a tool's answer inside
   `<vosita_javobi>`; the preamble names both as data. The closing tag is
   stripped out of the text, so the data cannot appear to end the quotation.
3. **Tool arguments are typed and the destination is the author's.** The model
   supplies *values* for parameters somebody drew — never a URL, a query or a
   field name — and every value is validated against the declared type before
   anything runs. Values are percent-encoded into the author's URL, so a `?` or
   a `/` fills a hole rather than rewriting the shape of the request.
4. Every tool runs under the same tenant scoping as the rest of the product.
5. The reply is checked before it is sent (`guard.py`): an empty answer, a
   verbatim run of the instruction, a `javascript:`/`data:`/`tg:` link.
6. Hard budgets — `max_turns` per message and `daily_token_budget` per agent —
   so a loop is a stopped agent rather than a bill.

Deliberately *not* implemented: a classifier that reads the incoming message
and judges whether it is an attack. It would be a model judging another model's
input — one more call, one more cost, one more thing to get wrong — defending
the layer that already holds.

**Cost is a plan limit.** `Plan.limits["aiBlocks"]` counts `agent.ask` blocks
alongside `ai` ones (`billing.services.AI_NODE_TYPES`). It is enforced when a
graph is saved, and again at run time — where reaching it takes a defined exit
with a row in the trace, never silence.

**Without a key.** `ANTHROPIC_API_KEY` unset is a supported state:
`provider.is_available()` is false, the block reports «sozlanmagan» in its trace
and takes its failure exit, and nothing else in the runtime changes — the same
shape the Kod block uses on a machine with no Node. `AGENTS_OFFLINE=1` is the
`TELEGRAM_OFFLINE` promise for this dependency: no request leaves the machine
and the whole path is walkable with a canned reply. It is forced on in the test
settings, and `anthropic` is never imported by the suite.

**Knowledge is not here.** Grounding an agent in a workspace's own documents
needs embeddings and a vector index, and this deployment is on SQLite. What
exists instead is the HTTP tool: an author points it at a search endpoint they
already have. Doing it properly means Postgres with `pgvector`, a documents
table with chunk-level rows, and retrieval as a fourth tool kind — a migration
off SQLite before it is a feature.

## Debug and the open internet

`config.settings.dev` turns `DEBUG` **off** when `PUBLIC_BASE_URL` points
somewhere that is not localhost. A tunnelled dev stand is on the open internet,
and Django's technical 404 page lists every route in the URLconf — which is a
map of the API handed to whoever mistyped a path. `DJANGO_DEBUG=1` is in every
dev `.env` ever written, so it is not the switch that decides this;
`DJANGO_DEBUG_PUBLIC=1` is, and it is named for what it does. `ALLOWED_HOSTS`
is likewise a list of hosts rather than `*`, assembled from
`DJANGO_ALLOWED_HOSTS`, `PUBLIC_BASE_URL` and `CSRF_TRUSTED_ORIGINS`.

With debug off the traceback stops going to the response, so set
`DJANGO_LOG_FILE` to keep one: `django.request` logs a handled 4xx at WARNING
and an unhandled 500 at ERROR with the traceback attached.
