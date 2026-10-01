---
name: api-shartnoma
description: The contract between the Next.js frontend and the Django backend in Oqim Studio — lib/api/server.ts, camelCase serializers, the one error shape, the tenant header and the token. Use when adding an endpoint or a field end to end, when a build fails on `server-only` or "cannot be imported from a Client Component", when a screen renders `undefined` for a field the API demonstrably sends, when an API error has to be caught or branched on, or when the API has to be driven by hand with curl because no browser is available.
---

# The API contract

Two applications, one contract, and **nothing checks it**. There is no OpenAPI
document and no code generator; `apiRequest` ends in `return payload as T`, so
TypeScript believes whatever the DTO type claims. A field renamed on one side
does not fail the build — it renders as `undefined` in production.

Three things break across this seam, in this order of frequency:

1. a client component reaches a repository and drags `server-only` into the
   browser bundle — this one *does* fail the build, loudly;
2. a name matches in review and not on the wire — silent `undefined`;
3. a timestamp is read as data when the repository already turned it into an
   Uzbek sentence.

## The one door: `frontend/src/lib/api/server.ts`

Every repository under `features/*/data` calls through this module and nothing
else knows the base URL, the credential, the tenant header or what an error
looks like coming back.

| | |
| --- | --- |
| `apiRequest<T>(path, opts)` | One call. Throws `ApiError`. `204` resolves to `undefined`. |
| `apiList<T>(path, opts)` | Unwraps DRF's `{count, results}` **or** a bare array — some endpoints are `@api_view`s that return a plain list. |
| `apiFind<T>(path, opts)` | Same as `apiRequest`, but a 404 resolves to `undefined`. The shape every `getById` is written against. |

`RequestOptions`: `workspaceId`, `params`, `body`, `method`, `token`.

- **`workspaceId` becomes `X-Workspace-Id`** — and only when truthy. Forgetting
  it does not error: the backend falls back to the caller's *first* membership
  and answers with a different tenant's rows. Verified against the running
  stand. Every repository method takes the workspace id as its first argument
  for exactly this reason; keep that signature.
- **`cache: "no-store"`, always.** Tenant data is never shared between readers,
  so there is nothing a cache entry could be safely keyed by. The alternative —
  keying the Next data cache on the workspace id — buys a cache that has to be
  invalidated correctly on every write or it shows one company another's
  numbers. Writes revalidate paths (`revalidatePath` in the feature's
  `actions.ts`); reads are never cached.
- **`token: null`** is how login and signup call an endpoint that has no cookie
  yet. Omitting the option reads `oqim_token` from the cookie jar.
- **20 s timeout.** A refused connection, dead DNS or a silent socket all become
  `ApiError(503, "backend_unreachable")` with a message written for a reader
  rather than `ECONNREFUSED`. Without it those arrive as a bare `TypeError` and
  every screen reports "unexpected error"; with it a page can say *the server is
  restarting* instead of *something went wrong*.

**Lists are capped at 50.** `DEFAULT_PAGINATION_CLASS` is
`apps/common/pagination.py` — `LimitOffsetPagination`, `default_limit = 50`,
`max_limit = 500` — and it applies whether or not the caller asks. Every
ModelViewSet list therefore returns `{count, next, previous, results}` with at
most 50 rows. `apiList` hands back the 50 and says nothing. A screen that must
show more passes `params: { limit: 200 }`.

**`apiFind` branches on the status, not on the code, and it has to.** A 404 from
the router or from `get_object_or_404` arrives with code `"error"` — the
exception handler reads `code`/`default_code` off the original `Http404`, which
carries neither. Only a deliberately raised `NotFound` (the tenancy one) says
`"not_found"`. Do not write `error.code === "not_found"`.

`frontend/src/lib/api/client.ts` is the *browser* half and talks to this Next
app's own route handlers, not to Django. Its header comment ("served by this app
from the in-memory repositories") is stale — there are no in-memory repositories
left. It is used by `useResource` and, through it, by `AnalyticsPanel` only.

## The credential never reaches the browser

Signing in is a server action (`features/auth/actions.ts`). The backend answers
with a DRF token; `persist()` writes it into the httpOnly `oqim_token` cookie
and returns an `AuthSession` containing nothing worth stealing. An XSS anywhere
in this app cannot walk away with a workspace.

That is enforced by a marker: `lib/api/server.ts` and every `data/*-repository.ts`
begin with `import "server-only"`, whose non-server build is a module that
throws on import — *"This module cannot be imported from a Client Component
module."* Turbopack surfaces it as a build failure, which is the point: the rule
cannot be forgotten quietly.

The trap is the **feature barrel**. `features/flows/index.ts` re-exports
`./data/flows-repository`, so a client component importing anything by value
from `@/features/flows` pulls the repository, `lib/api/server`, and
`server-only` with it.

```tsx
"use client";
// FAILS THE BUILD — the barrel re-exports the repository
import { createModuleFlowAction, type ModuleKey } from "@/features/flows";
```

```tsx
"use client";
// Correct: types through the barrel (erased), values from the module itself
import type { ModuleKey } from "@/features/flows";
import { createModuleFlowAction } from "@/features/flows/actions";
```

`import type` is safe from any barrel — it is erased before bundling, so it
never reaches the module graph. Only value imports pull `server-only`.

Real examples in the tree, each with the reason written next to it:

- `features/flow-kit/components/FlowStudio.tsx` — `import type { ModuleKey }` from
  the barrel, `createModuleFlowAction` from `@/features/flows/actions`.
- `features/flow-kit/components/FlowChatPreview.tsx` — same split against
  `@/features/flows/runtime-actions`.
- `features/bots/components/settings/BotSettingsScreen.tsx` — imports
  `@/features/workspace/roles` directly, because `@/features/workspace`
  re-exports the workspaces repository.
- `features/bots/languages.ts` — a plain data module whose doc comment says to
  import it directly and why.
- `lib/i18n/LocaleProvider.tsx` — mounted by every screen, so its comment
  forbids touching `lib/api/server` or any `data` repository, barrel included.

The barrels are not going to stop re-exporting repositories; server components
and server actions are the majority of their callers. The convention is the fix:
**from a client component, import the module, never the barrel.**

A client component that needs *fresh* data has two sanctioned routes, and
neither is a `fetch` to Django: call a server action, or call a Next route
handler that calls the repository server-side —
`app/api/analytics/route.ts` is the one example, and it takes the tenant from
`getSession()` rather than from the request, so no query parameter can ask for
another workspace's numbers.

## Payload names match on purpose

Serializers spell the camelCase name and point `source=` at the snake_case
field:

```python
workspaceId = serializers.CharField(source="workspace_id", read_only=True)
updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
layoutMode = serializers.ChoiceField(source="layout_mode", choices=["simple", "pro"], required=False)
```

The alternative — a camelCase↔snake_case renderer, or a translation layer in the
frontend — was rejected: with names spelled out, a serializer file read next to
the matching `types.ts` *is* the contract, and `grep layoutMode` finds every
place in both applications that touches the field. See the module docstrings of
`apps/flows/serializers.py` and `apps/bots/serializers.py`.

### Adding a field, end to end

Worked example: `layoutMode`, which exists in the tree in exactly these five
places.

1. **Model** — `apps/flows/models.py`: `layout_mode = models.CharField(...)`,
   with a **default** so rows written before the field still load.
   `manage.py makemigrations flows` → `apps/flows/migrations/0002_flow_layout_mode.py`.
2. **Serializer** — `apps/flows/serializers.py`: add the camelCase name with
   `source=`, and add it to `Meta.fields`. Decide writability deliberately:
   `Meta.read_only_fields` on `FlowSummarySerializer` holds `id`, `enabled` and
   `runs` because each has an owner other than a PATCH — `enabled` has an
   endpoint with a rule behind it, `runs` belongs to the runtime.
3. **Repository DTO + method** — `features/flows/data/flows-repository.ts`: the
   DTO type, the mapping function, and the method that writes it
   (`setLayoutMode` → `PATCH /api/flows/<id>/` with `body: { layoutMode: mode }`).
   Add the method to the exported `FlowsRepository` interface too; screens depend
   on the interface, never on the class.
4. **Domain type** — `features/flows/types.ts`: the field on `FlowRecord`, with
   the doc comment explaining what it means. Optional (`?`) if any stored row
   can lack it.
5. **Screen / store / action** — `features/flow-builder/store/useFlowEditorStore.ts`
   reads `flow.layoutMode ?? "simple"` and writes through
   `features/flows/graph-actions.ts`.

Then verify both directions, because neither compiler will:

```bash
cd frontend && npm run typecheck && npm run lint
cd backend && .venv/bin/python manage.py test apps --settings=config.settings.test
```

and read the field back off the wire with curl (below). Seeing the key in the
JSON is the only proof step 2 and step 3 agree.

**Graphs are the exception to all of this.** `nodes` and `edges` pass through
untouched — the editor owns the block schema, and a backend that re-validated
every field of every block type would have to be redeployed before the editor
could ship a new option. What the backend enforces is the graph's *shape*, not
its contents. Adding a block field means editing the frontend only; see the
`oqim-blok` skill.

## The error shape

One shape for the whole API, built in `backend/apps/common/exceptions.py`:

```json
{"error": {"code": "plan_limit", "message": "…", "field": "botId"}}
```

`api_exception_handler` wraps DRF's own handler and normalises two very
different things — DRF's bare field map for validation, and `{"detail": …}` for
everything else — into that one shape, so the interface has one error renderer
instead of two parsers. It also renames DRF's `throttled` to `rate_limited`,
and stamps `validation_error` on any `ValidationError` that is not an `ApiError`.

Raise from a view or serializer:

```python
raise ApiError("bot_project_mismatch", "Bot bu loyihaga tegishli emas", field="botId")
raise ApiError("project_not_found", "Loyiha topilmadi", field="projectId", status_code=404)
```

On the frontend the same three fields land on `ApiError` in `lib/api/server.ts`
(`message`, `status`, `code`, `field`), plus `isNotFound` and `isUnreachable`.

**Messages are written for the reader, in Uzbek, on the backend.** A 402 plan
limit is the backend answering, not failing, so its message is passed through
verbatim — see the comment in `features/flow-kit/actions.ts`. Do not re-word a
backend message in a component.

The full code vocabulary is open-ended (roughly forty strings across
`apps/*/views.py` and `apps/*/serializers.py`; `grep -rn 'ApiError(' backend/apps`
lists them). What matters is the short list the frontend actually *branches* on:

| code | status | where it is handled |
| --- | --- | --- |
| `plan_limit` | 402 | `TemplateStrip`, `TemplateGallery`, `FlowWizard` — the one refusal with somewhere to go, so it renders a link to `/billing` |
| `invalid_credentials`, `email_taken`, `weak_password`, `invalid_token`, `expired_token`, `rate_limited`, `server_error` | various | `AuthErrorCode` in `features/auth/types.ts`; the screens put `field` under the right input |
| `network_error` | — | frontend-only, from a failed action |
| `backend_unreachable` | 503 | frontend-only, synthesised by `apiRequest` when the fetch itself throws |

Everything else is rendered as a message. Adding a code the interface branches
on means adding it to `AuthErrorCode` or to the component that reads
`error.code` — a code nothing branches on needs neither.

## Tenancy on the wire

`X-Workspace-Id` (or `?workspaceId=`, which a WebSocket handshake and a copy-pasted
curl can set more easily) is resolved in `backend/apps/common/tenancy.py` and
**validated against the caller's memberships** before any queryset is touched. A
workspace the caller is not in is a `404 not_found` — the honest answer to "that
workspace, for you, does not exist" — and a read-only role (`analyst`) attempting
an unsafe method is a `403`; `WRITE_ROLES` is owner/admin/editor. Sent nothing,
the request silently acts on the caller's first membership. The Next side sets
the header from the `oqim_ws` cookie via `getSession()` in
`features/workspace/session.ts`. The rest — roles, invites, the switcher —
belongs to the tenancy skill, not here.

## Auth: cookie or token

Both come back from `POST /api/auth/login/`, and
`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES` accepts both:

- **Session cookie** — what a browser gets. Django's `SessionAuthentication`
  enforces CSRF on unsafe methods, so a caller holding the cookie must also send
  `X-CSRFToken`.
- **`Authorization: Token <key>`** — no CSRF, no cookie jar, works from a shell
  and from a WebSocket query string (`?token=`). This is what the Next server
  uses, and it is why the token exists at all.

`POST /api/auth/logout/` **deletes the token row**, not just the session. A
sign-out in the browser therefore invalidates the key a terminal was holding;
mint a new one.

## The dates are already sentences

Repositories pre-format timestamps during DTO mapping. This is deliberate — it
runs once on the server, where the data arrives, instead of in twenty
components, and a server-rendered string cannot produce a hydration mismatch the
way `Intl` across Node and a browser can. The cost is that **a domain field
typed `string` may already be a rendered Uzbek phrase, not data.**

```ts
// features/bots/data/bots-repository.ts
updatedAt: `${formatRelative(dto.updatedAt)} yangilangan`,   // "3 kun oldin yangilangan"
```

```ts
// features/bots/types.ts — nothing here warns you
updatedAt: string;
```

What is already formatted, by helper (`lib/utils/date.ts`):

- `formatRelative` → "3 kun oldin": `Flow.updatedAt`, `Bot.webhook.checkedAt`,
  `Bot.webhook.lastErrorAgo`, `BotActivityEntry.when`, `Contact.lastSeenAt`,
  `Notification.time`, project activity `when`, template `updatedAt` and review
  `when`.
- `formatInstant` → "12 mart 2026": `Bot.connectedAt`, `Contact.firstSeenAt`,
  `Bot.webhook.lastErrorAt`, `Workspace.createdAt`, `Member.joinedAt`, invite
  `expiresAt`, `Subscription.renewsAt`, payment-history `occurredAt`,
  `Project.createdAt`.
- Whole sentences: `Bot.updatedAt`, and `MyTemplate.meta` on the marketplace's
  own-templates card ("12 o'rnatish · bepul · 3 kun oldin yangilangan").

Consequences before you touch any of it:

- Do not call a date function on one of these. `new Date("3 kun oldin")` is
  `Invalid Date`; sorting by it sorts alphabetically.
- To translate the interface, the phrase has to move out of the repository or
  the repository has to learn the locale — the string is baked in before any
  component sees it. Changing the wording means editing the repository, not the
  screen.
- A new date field: decide in the DTO mapping which of the two it is, and say so
  in the type's doc comment. `formatRelative` for an age ("is this still
  happening?"), `formatInstant` for a date that is a date.
- The raw ISO instant is gone by the time a component runs. Anything needing it
  must keep a second field.

## Driving it by hand

The way to verify a change when no browser is available. Log in for a token —
the response carries one:

```bash
API=http://127.0.0.1:8000
TK=$(curl -s -X POST "$API/api/auth/login/" -H 'Content-Type: application/json' \
     -d '{"email":"aziza@sunrise.uz","password":"Parol12345"}' \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
```

For an account with no usable password — one created through Telegram login —
mint it from the shell instead:

```bash
cd backend && .venv/bin/python manage.py shell -c "
from rest_framework.authtoken.models import Token
from apps.accounts.models import User
u = User.objects.filter(telegram_id__isnull=False).first()
print(Token.objects.get_or_create(user=u)[0].key)"
```

Then every call is the token plus the tenant:

```bash
curl -s "$API/api/flows/" -H "Authorization: Token $TK" -H "X-Workspace-Id: sunrise-agency" | python3 -m json.tool
curl -s "$API/api/flows/?workspaceId=sunrise-agency&withGraph=1&limit=200" -H "Authorization: Token $TK"
curl -s -X PATCH "$API/api/flows/<id>/" -H "Authorization: Token $TK" \
     -H "X-Workspace-Id: sunrise-agency" -H 'Content-Type: application/json' \
     -d '{"layoutMode":"pro"}'
```

Three answers worth recognising, all reproduced against the running stand:

```
{"error":{"code":"not_found","message":"Ish maydoni topilmadi"}}                    # 404, header names a workspace you are not in
{"error":{"code":"validation_error","message":"…","field":"projectId"}}             # 400, DRF field error, normalised
{"error":{"code":"not_authenticated","message":"Authentication credentials …"}}     # 403, no token at all
```

The point of the round trip is the **key names**. A screen showing `undefined`
and a `curl` showing `layout_mode` where the type says `layoutMode` is step 2 of
the checklist, unfinished — and it is the one failure no build, no lint and no
test in this repository will report.
