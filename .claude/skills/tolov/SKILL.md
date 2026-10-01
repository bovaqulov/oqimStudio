---
name: tolov
description: Taking money in Oqim Studio — the invoice block and how sendInvoice is built, Telegram Stars and XTR, provider tokens and payment connections, the pre-checkout answer, a payment that never completes or a flow stuck after "To'lash", the bot's To'lovlar tab and its payment history, and workspace billing (plans, subscription, invoices, usage). Use when an invoice, a provider token, Stars, pre-checkout, the payments tab or the billing screen is being written, debugged or extended.
---

# Taking money

Two different kinds of money live in this repo and they share almost nothing:

- **Customer → bot.** A flow sends an invoice, Telegram charges the customer,
  the run continues. `backend/apps/engine/`, `backend/apps/bots/` (connections),
  `frontend/src/features/payments/`.
- **Workspace → us.** A plan, a subscription, invoices, limits.
  `backend/apps/billing/`, `frontend/src/features/billing/`.

Nothing joins them. A workspace on the Start plan can take a million so'm
through Click, and a paid subscription does not connect a single provider.
Read "billing vs payments" below before touching either — the two are the
easiest thing on this codebase to confuse, and both call a record `Invoice`.

## Three things that must be right, or the money never moves

All three are in `engine`. Each has a failure that looks like something else.

### 1. `provider_token`

`sender.build_call` puts the field into every `sendInvoice` payload, whatever
the currency — the exception is what goes *in* it:

```python
amount = int(round(raw)) if currency == STARS_CURRENCY else int(round(raw * 100))
...
"provider_token": "" if currency == STARS_CURRENCY else (provider_token or ""),
```

Telegram Stars (`XTR`) need the key **present and empty**, and `XTR` has no
subunit: 7 stars is `7`, not `700`. Every other currency is billed through the
merchant token of a payment connection, scaled by 100 because the Bot API
counts in the smallest unit while the editor holds a human decimal string
(`InvoiceConfig.amount` is a `string`).

The lookup is `runner._provider_token`, and it is by the id the block names:

```python
wanted = invoice.get("providerId") or ""
for connection in connections:
    if connection.provider_id == wanted and connection.token:
        return connection.token
usable = [connection for connection in connections if connection.token]
return usable[0].token if len(usable) == 1 else ""
```

Named-provider-first rather than "whatever is connected", because a bot with
both Click and Payme would otherwise silently charge through the wrong
merchant account. The fallback is deliberately narrow: with no provider named,
one connected provider is the only unambiguous answer — with two, the answer
is `""` rather than a guess.

**The failure.** An empty `provider_token` on a non-Stars invoice is a Bot API
error at send time. `send_node` raises `TelegramError`, `runner.walk` catches
it, writes a `system` step carrying Telegram's own message and ends the run as
`FAILED` — so the customer gets no invoice at all, and the only trace is that
step in the run history. It is not silent, but nobody is looking there.
The usual cause is an author who picked a provider that has since been
disconnected, on a bot that has two others. The editor guards the common case
(`InvoiceField` only offers connected providers, and warns when there are
none), but a graph saved before a disconnect keeps the stale `providerId`.

### 2. The Pay button comes first

Telegram's rule for `sendInvoice` is "if not empty, the first button must be a
Pay button". So `sender.build_keyboard` does not let the author's buttons
*be* the keyboard — it puts Telegram's own row in front of them:

```python
if kind == "invoice":
    rows = [[{"text": _pay_label(node), "pay": True}]]
    for button in buttons: ...          # the author's, each on its own row
    rows.append([{"text": _cancel_label(node, context), "callback_data": CANCEL_DATA}])
```

**The failure a naive keyboard produces.** Sending `buttons` straight through
means row 0 is an ordinary callback button, so Telegram rejects the call — or,
worse for the reader, the invoice arrives with no way to pay it. There is no
"add a Pay button" step for the author to forget: the row is not theirs to
draw, and the editor has no Pay button in its palette for exactly that reason.

The `Bekor qilish` row at the bottom (`CANCEL_DATA = "port:cancelled"`) is the
block's own second exit, not a `btn:` port — the way `yes`/`no` belong to a
condition. It is always appended, even when the author drew nothing on that
port: an invoice with only a Pay button is a conversation with no way out, and
a customer who changes their mind leaves the run parked forever.
`_continue_from` ends the run cleanly on an unwired port, so the worst case is
a finished run rather than a stranded one.

### 3. `pre_checkout_query` must be answered within ten seconds

`dispatch.dispatch` answers it before it does anything else with the update —
before the contact upsert, before counters, before routing:

```python
if event.kind == "pre_checkout":
    return _answer_pre_checkout(bot, event)
```

`_answer_pre_checkout` calls `answerPreCheckoutQuery(ok=True)` and returns.
There is nothing to decide: this bot built the invoice from the author's own
block moments ago, and what is being sold is a message rather than stock that
can run out. What matters is only that the answer arrives.

**The failure.** Miss the ten seconds and the payment fails with **nothing said
on either side** — no error in the panel, no message to the customer, no
`successful_payment`, and the run stays parked on the invoice looking exactly
like a customer who never tapped. That is why the answer is first and why
`pre_checkout` is parsed as its own kind in `events.parse_update` (there is no
chat on that update — Telegram is asking the bot, not the customer) and never
routed into a flow.

The update also has to be *subscribed to*: `pre_checkout_query` is in the
`allowed_updates` list `TelegramClient.set_webhook` sends. A webhook registered
by something else with a shorter list produces the same silent failure.

## After a confirmed charge

`successful_payment` arrives as an ordinary `message`, and
`events.parse_update` turns it into `kind="payment"`. In
`dispatch._reply_port`, money settling is read *before* any rule about text,
because it is the answer the invoice block was parked for:

```python
if content_kind(node) == "invoice":
    if event.kind == "payment":
        return "paid"
    return "cancelled" if event.callback_data == CANCEL_DATA else None
```

So the parked run continues out of `paid`. A `payment` update with no run
waiting on it can also *start* a flow: `matching.KIND_MAP` maps
`"payment" -> {"payment"}`, so a trigger of that kind fires on it.

A button of the author's under the Pay row is how a flow branches on somebody
who changed their mind — it keeps its own `btn:<id>` port, sits below the Pay
row, and is routed like any other keyboard tap. Both shapes are covered by
tests (`test_a_tapped_cancel_button_takes_the_other_branch`,
`test_the_invoice_always_offers_a_way_out`).

## What is deliberately not stored, and the limit that creates

A confirmed charge leaves exactly two rows in the analytics log
(`dispatch.dispatch`):

```python
amount = (event.payment.get("total_amount") or 0) / 100
record_event(**counted, metric="conversions")
record_event(**counted, metric="revenue", value=amount, currency=...)
```

`GET /api/bots/<id>/payment-history/` reads the `revenue` rows back
(`analytics.services.bot_payments`, newest first, `?limit=` with
`PAYMENT_HISTORY_LIMIT = 50` and `PAYMENT_HISTORY_MAX = 200`), joins the payer
names in one query, and moves each instant into the workspace's zone so the
list agrees with the reports beside it.

**There is no payments table.** That is a choice, not an omission — a confirmed
charge is already in the log every report is built from, and a second copy of
those facts would be one more thing to keep in step. The cost is exact and it
is the first question anyone asks when extending the To'lovlar tab:

> An `Event` has nowhere to put the invoice title, the provider that took the
> money, or Telegram's `provider_payment_charge_id`. Those are **not** hidden
> somewhere else, not on the `FlowRun`, not on the contact. They stay off the
> screen until something stores them.

So "show what was bought" or "reconcile with Payme's cabinet" is a migration
(a real payments table, written from `dispatch` beside the two events), not a
serializer change. `PaymentRecord` in
`frontend/src/features/payments/types.ts` carries only `contactName`,
`amount`, `currency`, `occurredAt`, and says why in its own doc comment.

**Stars revenue is recorded wrong.** That `/ 100` is unconditional, but the
send side treats `XTR` as having no subunit. A 7-star payment goes out as
`total_amount: 7` and comes back recorded as `0.07` revenue. The send path has
the exception (`sender.build_call`) and the record path does not
(`dispatch.dispatch`). Anyone fixing this should mirror the send-side rule
rather than special-casing the panel, and should know old rows are already
wrong.

## Payment connections

`bots.models.PaymentConnection` — one row per (bot, provider), unique together:

| Field | Note |
| --- | --- |
| `provider_id` | matches an id in `frontend/src/features/payments/providers.ts` |
| `token` | the merchant token. Blank for Stars |
| `mode` | `test`/`live`; blank for a token-less provider |
| `status`, `status_tone`, `error` | what the card shows |
| `last_checked_at` | when somebody last asked for a re-check |

The token never comes back out. `PaymentConnectionSerializer` makes `token`
write-only and exposes `tokenMasked` (`•••• 4242`) instead;
`PaymentConnection` on the TypeScript side has no `token` field at all, so no
page or action can leak one by accident.

Three endpoints, all on `BotViewSet` (`backend/apps/bots/views.py`):

```
GET/POST  /api/bots/<id>/payments/               list, or connect/replace (update_or_create)
DELETE    /api/bots/<id>/payments/<provider>/    disconnect
POST      /api/bots/<id>/payments/<provider>/    re-check
GET       /api/bots/<id>/payment-history/        the takings
```

`payment-history` is its own path rather than `payments/history` because the
router registers `payments/<provider_id>` first and would resolve it there.

**"Connected" means a string is stored, and nothing more.** Nothing in the
backend ever writes a failure tone or an `error` onto a connection: the only
writes are the default `("Ulangan", "success")` and the re-check, which resets
`error` and stamps `last_checked_at`. The endpoint's own docstring is honest
about why — a provider token is verified by Telegram only when an invoice is
actually sent, so "re-check" records that somebody asked and when. The
practical consequences:

- `connectPaymentProviderAction`'s `status.tone !== "success"` branch and the
  flow editor's `.filter((c) => c.status.tone === "success")` are both
  no-ops today. Do not read either as "the token works".
- The only real check on a token before Telegram sees it is
  `payments/validate.ts` `validateProviderToken`, which is shape-only
  (`<merchant-id>:(TEST|LIVE):<secret>`) and runs in the server action. It
  earns its place by naming the classic mix-up: a second segment starting
  `AA` is a **bot** token, not a provider token.
- A direct API call stores whatever it likes — the serializer does not check
  the shape.

**The provider sheet.** `payments/components/ProviderList.tsx` renders one row
per entry in `PAYMENT_PROVIDERS` (product data — adding a provider is an entry
there, and no component branches on a provider id). Tapping one opens
`ProviderSheet`, which has exactly three states and one action each, on
Telegram's MainButton:

- `auth: "bot_token"` (Stars) and not connected → `EnableBody`, one click,
  `enablePaymentProviderAction`, token `null`.
- `auth: "provider_token"` and not connected → `TokenForm`,
  `connectPaymentProviderAction` via `useActionState`.
- connected → facts, `Tekshirish` (`verifyPaymentProviderAction`),
  `Tokenni o'zgartirish`, and a red disconnect row that confirms through the
  client's own popup rather than a dialog of ours.

Two role gates disagree, and it is deliberate on neither side: the UI hides
all four actions behind `canManageWorkspace` (owner/admin), while the API's
`IsWorkspaceMember` allows any of `WRITE_ROLES` (owner/admin/**editor**). An
editor cannot see the buttons but can call the endpoints.

`validate.ts` also exports `tokenMode` and `maskProviderToken`, which nothing
calls — the repository derives the mode itself with `token.includes("TEST")`
and the backend does its own masking. Editing those two functions changes
nothing; fix the caller instead.

**How the editor gets its list.** `frontend/src/app/flows/[flowId]/page.tsx`
reads the bot's connections server-side and hands `paymentProviders` to
`FlowEditor`, so `InvoiceField` can only offer providers that exist — offering
one with no token would produce an invoice that fails the moment a customer
taps "To'lash". Picking a provider also narrows the currency list to that
provider's own (`XTR` for Stars, `UZS` for Click/Payme/Uzum, `USD`/`EUR` for
Stripe) and carries the currency across when the old one is unsupported.

## Billing is not payments

`backend/apps/billing/` is what the **workspace** pays *us*:

```
GET       /api/billing/plans/          public plans
GET/POST  /api/billing/subscription/   POST changes the plan — owner only, 404 on an unknown key
GET       /api/billing/invoices/       this workspace's invoices
GET       /api/billing/usage/          used vs allowed
```

Where the two get confused:

- **Both have an `Invoice`.** `billing.models.Invoice` is a bill *we* issue to
  a workspace. The engine's "invoice" is a `sendInvoice` a bot sends a
  customer. They share no code and no table.
- **Both have `amount` + `currency`.** `PaymentRecord` is a customer's payment
  into a bot; `Invoice` is a workspace's subscription charge.
- **Neither is a payment processor.** Billing stores what was charged; nothing
  in `billing/` calls a provider. Connecting Click to a bot does nothing for
  the subscription.
- **Limits live on the plan as data.** `Plan.limits` is the source of both the
  gauge (`services.usage_report`) and the guard (`check_plan_allows`), so a
  screen can never say 40% while the next write is refused. `null`, or a key
  the plan never declared, is uncapped. A refusal is **402** `plan_limit`, not
  403 — nothing is wrong with the caller's permissions.
- **Enforcement is split on purpose.** `check_plan_allows` raises, for calls
  somebody is waiting on. `plan_allows` only answers true/false, for the
  runtime: a webhook that raised would be retried by Telegram forever, and a
  bot that goes silent because a counter is full is a worse failure than a
  contact that goes unfiled.
- **`frontend/src/features/billing/plans.ts` is marketing copy, not limits.**
  `PLAN_CATALOG` carries names, prices and feature bullets, and its
  `PlanLimits` keys (`aiTokens`) are not the backend's (`aiBlocks`,
  `messages`). The numbers a screen enforces come from
  `GET /api/billing/usage/` through `get-usage.ts` — never from the catalogue.
  `getUsageReport` says why in its own comment.

## Testing money without moving money

`TELEGRAM_OFFLINE=1` (forced in `config.settings.test`) makes
`TelegramClient.call` record the payload into `client.sent` and return a
plausible result instead of leaving the machine. Everything except Telegram's
own side is therefore exercisable end to end with no token, no merchant
account and no network:

- the whole webhook → `dispatch` → `runner` → `sendInvoice` payload path,
  including the exact `prices`, `currency`, `provider_token` and
  `reply_markup` that would have gone out;
- the pre-checkout answer, as a call assertion;
- `successful_payment` resuming the parked run and writing the two events;
- the payments tab's endpoints, since they read those events back.

What it cannot tell you: whether a real merchant token is valid, whether the
provider accepts the currency, or whether the ten seconds were met. Those only
exist against the live Bot API.

`backend/apps/engine/tests/test_blocks.py::InvoiceTests` already covers the
invoice path — Pay button first (`rows[0][0]["pay"]`), Stars whole units with
an empty token, billing through the *named* provider with two connected, the
run parking rather than walking past, the pre-checkout call, `paid` resuming,
the author's cancel button, the always-present `port:cancelled` row, an
unwired cancel still ending the run, and `type: "invoice"` meaning the same as
the older `message` + `contentKind: "invoice"`. The update fixtures are
`payment_update` and `pre_checkout_update` in `tests/base.py`.
`backend/apps/bots/tests.py` covers the connection endpoints and the history
(`PaymentConnectionTests`, `PaymentHistoryTests`).

```bash
cd backend
.venv/bin/python manage.py test apps.engine.tests.test_blocks.InvoiceTests \
    apps.bots.tests.PaymentConnectionTests apps.bots.tests.PaymentHistoryTests \
    --settings=config.settings.test
```

(`.venv/Scripts/python` on Windows, which is what `backend/README.md` writes.)
Whole suite: `.venv/bin/python manage.py test apps --settings=config.settings.test`.

Note that `backend/.env` ships `TELEGRAM_OFFLINE=0` on the local stand — see
the `stend` skill. Driving an invoice flow there sends a **real** invoice to a
real chat. The tests are the safe way to see the payload.
