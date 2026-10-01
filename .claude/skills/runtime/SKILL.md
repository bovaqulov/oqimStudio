---
name: runtime
description: How an incoming Telegram update becomes an answer — process_update → dispatch → parse → match → walk → send, the precedence a parked run has over a new conversation, the derived FlowTrigger index, parking and resuming (questions, delays, invoices), and what happens to an update nobody claimed. Use when a bot answers the wrong flow or answers nothing at all, when a trigger will not fire or fires when it should not, when a run is stuck in waiting/sleeping, when a Kutish delay never wakes, or when an update has to be traced through webhook processing — "bot noto'g'ri javob berdi", "trigger ishlamayapti", "oqim to'xtab qoldi".
---

# How a message becomes an answer

```
POST /api/telegram/webhook/<webhook_token>/     apps/telegram/views.py
  └─ process_update.delay(bot.id, update)       apps/engine/tasks.py   ← Celery
       └─ dispatch(bot, update)                 apps/engine/dispatch.py
            ├─ parse_update → IncomingEvent     apps/engine/events.py
            ├─ claim_update → ProcessedUpdate   apps/engine/models.py
            ├─ 1. a parked run that asked for this  → resume_with_reply ┐
            ├─ 2. find_trigger                      → start_run         ├ apps/engine/runner.py
            └─ 3. nobody claimed it                 → nothing is sent   ┘ (record_inbound only)
                                     walk → execute → sender.send_node
                                                      apps/engine/sender.py
```

Everything below is read off that code. Where `backend/README.md` disagrees,
the code is right and the drift is called out inline.

Bot connection, tokens and webhook *registration* are a different subject and
already have a skill: `.claude/skills/bot/`. This one starts at the update
arriving.

## 1. The webhook does nothing but enqueue

`telegram/views.py:webhook` checks two secrets, parses the body, calls
`process_update.delay(...)`, answers 200. That is the whole handler.

Telegram waits a few seconds and no longer. Anything slower is recorded on its
side as a read timeout, the update stays pending, and it is re-delivered —
so a webhook that walks the graph inline turns one slow HTTP call to
`api.telegram.org` into a duplicate conversation. The queue is what keeps the
answer time independent of how long the flow takes.

Two secrets, not one, and they are independent: the **path** carries
`Bot.webhook_token` (256 bits, `new_secret`) so an update can be attributed
before its body is parsed; the **header** carries `Bot.webhook_secret`,
compared with `hmac.compare_digest`. An unknown token and a wrong secret get
the identical 401 with no log line naming either — an endpoint that
distinguishes them is an endpoint that answers questions.

> README drift: both the "How a message becomes an answer" section and the API
> table still say `POST /api/telegram/webhook/<bot_id>/`. The path has carried
> `webhook_token` since the id (the bot's public `@handle`) made the URL
> guessable. `bots.services.webhook_url_for` is the truth.

**When the broker is down** the update is handled inside the request instead
(`settings.TELEGRAM_INLINE_FALLBACK`, default `True`). Late is a bot; never is
nothing. Set it to `0` and the endpoint answers 503 instead, and Telegram
re-delivers until the queue is back. Either way the detour is written to the
bot's activity log through `report_problem`, at most once per message per five
minutes — Telegram retries every few seconds, and sixty identical entries hide
everything else the bot did.

**Every update is claimed exactly once.** `claim_update` does
`ProcessedUpdate.objects.get_or_create(bot, update_id)`; the unique constraint
is the idempotency. Without it a re-delivery answers the customer twice and,
worse, feeds a question its answer a second time. Update ids are per bot, so
two bots seeing the same id both handle it.

## 2. `parse_update` — one shape for a dozen

`events.py` reads the raw update once into an `IncomingEvent` whose vocabulary
is the editor's, not Telegram's. Matching against raw update shapes would put
the Bot API schema into every rule in the product.

Worth knowing about the dataclass:

- `kind` is one of `message`, `callback`, `join`, `leave`, `join_request`,
  `channel_post`, `reaction`, `payment`, `pre_checkout`, `webapp`, `blocked`,
  `unblocked`, `business_connection`, `membership`. Anything else returns `None`
  and dispatch stops with `unsupported_update`.
- `my_chat_member` reads two ways. In a **private** chat it is the customer:
  `kicked` is `blocked`, `member` again is `unblocked`. Anywhere else it is the
  bot's own standing in a room — `membership`, which `_dispatch` files to
  `bots.chats.record_membership` and returns from. No contact, no inbox row, no
  trigger lookup: a status change is not a conversation. See
  `backend/README.md` → "Groups and channels".
- `module_key` is **derived**, never configured: business connection wins, then
  channel, then group, then webapp, else `dms`. It is what `find_trigger`
  filters on and what `bot.module_enabled()` gates.
- `reply_to` = `reply_chat_id or chat_id`. A join request arrives on the group
  and is answered in the applicant's private chat, which Telegram hands over as
  `user_chat_id`.
- `answer_text` falls back to a shared phone number or `"lat,lon"` — a
  `contact`/`location` question is answered by a tap and carries no text at all.
- `command` is the slash stripped and `@botname` removed, lowercased.

## 3. Precedence — the part people get wrong

This is `dispatch._dispatch` steps 1–3 and `dispatch._reply_port`.

**A parked run gets first refusal, but only for what it actually asked for.**

`_waiting_run` finds the contact's `WAITING` runs, newest first (a `SLEEPING`
run is not offered the update at all). A `btn:` press is the exception to
"newest": it names the exact row it came from, so the run whose current node
still has that port wins — otherwise tapping a keyboard from earlier in the
conversation would answer a question it never saw.

`_reply_port` then decides whether this update *is* the answer that block was
waiting for, in this order:

| The parked block | claims | lets through |
| --- | --- | --- |
| anything | a `btn:<id>` callback | — |
| invoice | a `payment` update (→ `paid`), `port:cancelled` (→ `cancelled`) | everything else |
| subscription | `port:check` (→ `check`) | everything else |
| rating / language | `rate:`/`lang:` callback (→ `out`) | everything else |
| question with `allowSkip` | `port:skip`, the label, or a typed `/skip` | — |
| any of the above | — | *a command*, always — an instruction is never an answer |
| question | any other typed text (→ `out`) | — |
| reply-keyboard message | text equal to a row's label (→ `btn:<id>`) | everything else |
| inline-keyboard message | nothing typed | all typed text |

Anything in the "lets through" column falls to step 2 and starts a new
conversation, and **the old run stays `WAITING` with its keyboard tappable**.
Only a command clears the board, and only once a trigger has claimed it:
`_close_superseded_runs` then ends the contact's other non-test
`WAITING`/`SLEEPING` runs, recording why in `FlowRun.error`. A command that
matches nothing sends nothing and leaves the parked runs alone.

Why this way. The rejected design is the obvious one — "a parked run swallows
the next update, whatever it is". Under it, a customer sitting in front of a
menu who types «narx qancha?» has that sentence routed into an exit the author
never drew, so the flow ends silently on an unconnected port and the keyword
block that was written for exactly this question never runs. The bot has
ignored a customer who was talking to it. The other half matters too: a
*question* really did ask for words, so it must keep them, or an intake would
lose the name to a keyword flow. Both are pinned by tests —
`test_typing_past_a_keyboard_starts_the_flow_that_answers_it` and
`test_a_question_still_claims_the_next_thing_typed`
(`tests/test_dispatch.py:ParkedRunRoutingTests`).

Order details that are load-bearing:

- `/skip` is checked **before** the command rule, because one of the three ways
  to decline an optional question is typing a command.
- `pre_checkout` is answered before anything else in `_dispatch` and is never
  routed to a flow. Telegram gives ten seconds; an unanswered query is a
  payment that fails with nothing said on either side.
- `_acknowledge_callback` fires before matching — the pressed button has to
  stop spinning whether or not anything answers it.
- `_rewrite_menu_button` runs *after* the analytics counters (so a menu tap is
  still counted as a click) and *before* matching.
- A blocked contact is never resumed and never started.

## 4. `FlowTrigger` is derived, never authored

`flows/services.py:reindex_triggers` deletes the flow's rows and rebuilds them
from `flow.nodes` on **every** save. Callers: `flows/views.py` (create,
`main`, `graph` — which is autosave, `duplicate`), `marketplace/views.py`
(install), `seed_demo`. The Django admin shows the rows `readonly` for the same
reason.

The graph is JSON because a block is wide and polymorphic and the editor always
reads and writes the whole thing; the index exists because "which flow answers
this update" cannot be a JSON scan at message rate. Derivation is what stops
the two from disagreeing — the index cannot claim something the author did not
draw, because it is thrown away and re-read from what they drew.

**If someone writes a row by hand** (shell, script, data migration) two things
happen. It routes updates until the next save of that flow, then vanishes —
autosave from the canvas is enough. And while it lives it points at
`node_id`; if no such block exists, `start_run` → `walk` finds nothing,
`_finish(FAILED, "Blok topilmadi: …")`, and the customer gets **silence**. A
failed run in the list and nothing sent is the signature — and note that an
unmatched message now looks the same from outside, so the run list is what
tells the two apart.

To re-derive after touching a graph outside the API:

```python
from apps.flows.models import Flow
from apps.flows.services import reindex_triggers
reindex_triggers(Flow.objects.get(pk="..."))
```

## 5. The priority ladder

`matching.find_trigger`:

1. `bot.module_enabled(event.module_key)` — no, and nothing is matched at all
   (an empty `enabled_modules` still answers `dms`).
2. Candidates: `bot` + `module_key` + `kind ∈ KIND_MAP[event.kind]` +
   `flow__enabled=True`.
3. Ordered `priority, order, flow__created_at, id`. The last two are a
   tie-break so that two identical handlers resolve the same way every time —
   a bot that answers differently on Tuesday is worse than one that answers
   wrongly every time.
4. First row whose `matches()` returns true wins. No scoring, no best match.

Levels, from `flows/models.py` and `flows/services.py`:

| | level |
| --- | --- |
| `/start`, an explicit command, a callback/reaction/payment/webapp/status event, a group or channel event block, an **exact** keyword | 1 `PRIORITY_EXACT` |
| a **contains**/**regex** keyword, a media (content-type) filter | 2 `PRIORITY_PARTIAL` |
| «Istalgan xabar» (`any`) | 3 `PRIORITY_CATCH_ALL` |
| a business handler with a working-hours window | its level **minus one**, floored at 1 |
| `node.priority` set by the author | that number, overriding all of the above |

The window rule is what makes the everyday setup order itself: an after-hours
autoreply (catch-all + `outside` → 2) beats the plain catch-all (3) and still
steps aside for a keyword handler.

**The editor draws the same ladder** in
`frontend/src/features/flow-builder/lib/trigger.ts` — `PRIORITY_EXACT`
/`PRIORITY_PARTIAL`/`PRIORITY_CATCH_ALL`, `kindPriority`, `businessPriority`,
`effectivePriority`, and `handlerOrder()` which renders the queue so "#2" can
be read as a position. Change one side and change the other, or the order the
author sees is not the order the bot runs.

One asymmetry to remember when debugging: `handlerOrder()` sorts the handlers
of **one flow**; `find_trigger` sorts across **every enabled flow on the bot in
that module**. Two flows that each hold a matching handler are ordered by
priority, then by the block's position in its own graph, then by which flow was
created first. The editor cannot show that.

`KIND_MAP` is the other half of "why is this trigger not firing": a `message`
update can only ever match `start`/`command`/`keyword`/`any`/`media`, a
`callback` only `callback`, a `webapp` only `webapp`/`any`. `any` deliberately
does **not** exclude `/start` — a bot with no `/start` handler should still
answer the one command every user tries first.

## 6. Parking and resuming

`runner.walk` executes blocks until one parks or the graph runs out, capped at
`MAX_STEPS = 60` (the editor warns about cycles; the runtime has to survive one
that shipped). Each handler returns `(outcome, port)` — `continue` follows
`flow.next_node_id(node, port)`, `park` and `stop` return the run as it stands.

| parks as | block | continues when |
| --- | --- | --- |
| `WAITING` | question, rating, language | the answer arrives (`resume_with_reply`) |
| `WAITING` | a message/menu with routable buttons | a row is tapped |
| `WAITING` | invoice | `successful_payment` → `paid`, or the Bekor row → `cancelled` |
| `WAITING` | subscription gate, when not subscribed | the check row → re-ask Telegram |
| `SLEEPING` | Kutish (delay) | `resume_run`, or the minute sweep |
| `HANDOFF` | Operator | a person, outside the runtime |

`routable_buttons` is what decides whether a keyboard parks: on an inline
keyboard only `callback` buttons come back at all (a URL or Web App button
returns nothing to route on); on a reply keyboard every button does, because
Telegram sends the label as an ordinary message. Same rule as
`isRoutableButton` in the editor.

**Delays.** `_handle_delay` parks with `resume_at` set, then
`resume_run.apply_async(countdown=minutes*60)` — countdown, not eta, so a
worker whose clock differs from the web process still waits the interval the
author asked for. A broker hiccup here is caught and logged, never raised: the
run is already parked with `resume_at`, and failing would mark a perfectly good
conversation `FAILED`.

**`resume_due_runs` runs every 60s** (`config/celery.py:beat_schedule`) and
re-queues every `SLEEPING` run whose `resume_at` has passed. It is the net
under a lost wake-up — a worker killed mid-flight, a broker restart, a
`apply_async` that never landed. With it a broker restart costs a late message;
without it, a dead conversation nobody notices. **Beat has to be running** for
delays to be reliable.

**Follow-up (`Kechiktirilgan eslatma`) is not a delay.** It arms
`send_followup` and walks straight on — nothing parks, so the rest of the flow
runs now. `deliver_followup` calls the reminder off if `contact.last_seen_at`
moved past `armed_at`. There is no parked run for the sweep to find, so a
follow-up lost to a broker failure is lost; that is why the failure is logged
as a step rather than raised.

**Resuming** (`runner.resume_with_reply`) in order: the gate's re-check short
circuit; strip a `rate:`/`lang:` prefix so `rate:5` never reaches
`{{message.text}}`; record the user step; `skip` leaves through `out`;
`validation.check_answer` on a typed question answer — a failure calls
`_reject_answer`, which re-asks with the correction *and* the question in one
message and hands off to a person after `retryLimit` (default 3) tries;
`message.text`/`xabar` are rewritten to *this* message; the answer is stored
under `saveAnswerAs` (or legacy `tagName`, or `javob_<id>`) on both the run
context and the contact.

`_continue_from` ends the run `DONE` when the port is unwired. That is not an
error — what the author did not draw is where the conversation ends. All three
endings are now the same ending: an unwired port, walking off the end of a
graph (`walk`) and an explicit `end` block each stop and send nothing. They
used to differ — the first offered no after-flow menu and the other two did —
and that difference disappeared with the menu itself.

## 7. What an unmatched message gets: nothing

`dispatch` returns `{"handled": False, "reason": "no_trigger"}` and stops. No
message is sent. The update is not lost — `record_inbound` has already filed it
to **Suhbatlar** (`apps/inbox`), where an operator reads it and can answer by
hand.

**There used to be a safety net and it is gone.** `engine/fallback.py` answered
an unclaimed message with one line and a menu of buttons, configured from the
bot's «Javob topilmaganda» settings screen. Both the module and the screen were
removed. If you are reading code, a comment or a document that mentions
`answer_unmatched`, `offer_menu_after_flow`, `Bot.settings.fallback`,
`menuAfterFlow` or `bot.fallback[...]`, it is describing a build that no longer
exists — the settings key itself was dropped from every row by
`bots/migrations/0008_drop_bot_fallback_setting.py`.

**So "the bot said nothing" is now an expected outcome, not a symptom.** That is
the single most important thing on this page for anybody debugging. Before
looking for a break, establish which silence this is:

| what you see | what it means |
| --- | --- |
| no `FlowRun` for the contact, message in Suhbatlar | nothing matched — working as designed |
| `FlowRun` `FAILED` with `Blok topilmadi` | a trigger matched a block that is not in the graph |
| `FlowRun` `DONE` on an unwired port | the author did not draw that exit |
| no `Message` row at all | the update never arrived — check the webhook, not the graph |

The way to cover the first row is a catch-all flow: a Handler with
`dmsTrigger.kinds = ["any"]` at the lowest priority. It is an ordinary flow, so
it is editable, translatable and testable — which the old setting was not. Note
what `any` actually matches (`matching.KIND_MAP`): `message` and `webapp` only.
A reaction, a join or a status change still reaches nothing.

**`cmd:<command>` round-trip.** A menu button is not an exit from any graph; it
re-enters the bot at a command. So it carries `sender.COMMAND_PREFIX + command`
as its callback data, and `dispatch._rewrite_menu_button` turns the tap back
into the update the typed command would have been: `kind = "message"`,
`command` set, `text = "/<command>"`, `callback_data` cleared. Everything
downstream — `_close_superseded_runs`, `find_trigger`, the whole ladder — sees a
typed command and none of it needs to know the menu exists. This mechanism was
shared with the safety-net menu and outlived it: the Menyu block's home row
(`sender._menu_home_row`) is what uses it now. On a *reply* keyboard there is no
payload to carry, so the row's text simply *is* `/start`.

## 8. Placeholders

`sender.render_text` resolves the language **first**, then substitutes
`{{name}}` from the run context. That order is the point: a translated field is
a `{"uz": …, "ru": …}` map, so substituting first would substitute into a dict
and every placeholder inside a translated message would reach the customer as
literal braces.

The names come from `runner._initial_context` and are exactly the ones the
editor's variable menu inserts (`frontend/src/features/flow-builder/lib/variables.ts`) —
`user.*`, `chat.*`, `message.*`, `business.connection_id`, `bot.*`, plus
`mijoz_ismi` / `mijoz_telefoni`, plus everything a question or a
"Teg / o'zgaruvchi" block stored on the contact. A runtime that invented its own
names would render every placeholder an author picked from that menu as braces.

**An unknown name keeps its braces.** `"Salom {{ism}}"` is a bug the author can
see; `"Salom "` is one they cannot. Same reasoning as the missing-translation
fallback in `resolve_text`, which sends *any* translation it has rather than an
empty string.

Note `chat_id` (where this run answers) lives on the **run**, not the contact:
the same person can be answered in a group now and in their private chat an
hour later. `upsert_contact` only writes `contact.chat_id` from a private chat
for the same reason.

## 9. Driving the whole path with no token

`TELEGRAM_OFFLINE=1` makes `TelegramClient.call` short-circuit and return a
plausible result (`telegram/client.py:_offline_result`), appending every call
to `client.sent`. `getMe`, `getWebhookInfo`, anything `send*`, `copyMessage`
and `getChatMember` have hand-written answers; everything else returns `True`.
`getChatMember` answers `"member"` on purpose — a subscription gate that said
"not subscribed" offline would make every flow behind one unwalkable on a
laptop.

So `dispatch(bot, update)` in a shell exercises parse → match → walk → send end
to end with no token and no network. A **test run** (`is_test`) is offline
regardless: `runner._deliver` builds the Bot API payload and returns it with
`preview: True` instead of calling the client, which is how the editor's test
chat shows the author exactly what would be sent.

`config/settings/test.py` forces the rest: `TELEGRAM_OFFLINE = True`, the
in-memory channel layer, `CELERY_TASK_ALWAYS_EAGER` (so `.delay()` runs
inline and `resume_run` fires within the test), locmem cache, in-memory SQLite.
Webhook → dispatch → run → socket runs with no Redis, no broker, no network.

The live stand runs `TELEGRAM_OFFLINE=0` — sends reach real people. See
`.claude/skills/stend/`.

## 10. Testing a change

`apps/engine/tests/` is the only app in this backend with real coverage. Eight
files; `base.py` holds every fixture and update builder and the others do
`from .base import *`.

| file | what it pins |
| --- | --- |
| `test_dispatch.py` | the trigger index, routing, parked-run precedence, reply keyboards, shared answers, an unmatched message vs. `/start` |
| `test_scenarios.py` | whole conversations: the clinic intake, commands interrupting, two parked runs, duplicate delivery, test-run fidelity, validation |
| `test_blocks.py` | invoice, menu, subscription, rating, language, follow-up, `end` |
| `test_language.py` | which language a run speaks, and the answer rules |
| `test_markdown.py` | authored markdown → the HTML Telegram receives |
| `test_http.py` | the SSRF guard and the HTTP block |

```bash
cd backend
.venv/bin/python manage.py test apps.engine --settings=config.settings.test   # 132 tests, ~3s
.venv/bin/python manage.py test apps --settings=config.settings.test          # 360 tests, ~6s
```

Both are green as of this writing, so any failure is the change. (`CLAUDE.md`
prints the Windows interpreter path, `.venv/Scripts/python`; on this machine it
is `.venv/bin/python`.)

Write the test as what a customer would see — which flow answered, what was
sent, where the run parked — not as which function was called. `EngineTestCase`
gives one workspace, one bot and `make_flow(nodes, edges)`, which reindexes for
you; `make_intake_flow()` is the two-question intake most scenarios walk, kept
as its own fixture rather than reading `starter_graph()`, because that graph is
the product's opening offer and changes with the product.

## Other README drift found

- **The webhook path** (see §1).
- Background work table: the hourly `bots.tasks.check_webhooks` is not what
  beat schedules. `config/celery.py` runs `apps.bots.tasks.reconcile_webhooks`
  every **600s**, plus `forget_old_updates` nightly at 03:20, and re-points
  every webhook on `worker_ready`. `engine.tasks.send_followup` is missing from
  the table entirely.
- Step 1 of "How a message becomes an answer" omits the inline-dispatch path
  taken when the broker is unreachable.
