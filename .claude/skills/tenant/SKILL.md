---
name: tenant
description: Who may see and do what in Oqim Studio — tenant isolation (WorkspaceScopedMixin, IsWorkspaceMember, X-Workspace-Id), the four roles and the rule that nobody hands out a role above their own, every sign-in path (password, Telegram Login Widget, Mini App initData, the Start-button nonce), invites and /join/<code>, and the rate limits on the endpoints reachable without an account. Use when adding or reviewing a tenant-scoped endpoint, when permissions or roles are involved, when a sign-in fails or loops, when an invite link will not redeem, when a caller sees 403 or 404 and the difference matters, or when the user says something like "ruxsat yo'q", "taklif havolasi ishlamadi", "kira olmayapman".
---

# Who may see what

Two files hold the whole boundary: `backend/apps/common/tenancy.py` decides which
workspace a request acts on, and `backend/apps/workspaces/models.py` decides what
the caller may do there. Everything else — every viewset, every socket, every
server action — leans on those two and adds nothing of its own.

## Resolving the tenant

`resolve_workspace(request)` reads `X-Workspace-Id`, or `?workspaceId=` when a
caller cannot set headers (a WebSocket handshake, a pasted curl), and then looks
that id up **in the caller's own memberships** — never in `Workspace.objects`.
The lookup is the isolation: there is no code path where an id from the wire
reaches a queryset before a membership row has vouched for it.

With no header at all it returns the first membership, and `memberships_of`
orders explicitly by `joined_at, workspace_id`. "Whichever row came back first"
would make the default tenant depend on SQLite's mood.

Three answers, and they are three on purpose:

| Situation | Answer | Code |
| --- | --- | --- |
| Header names a workspace the caller is not in (or none) | `404` | `not_found` |
| Caller belongs to no workspace at all | `403` | `permission_denied` |
| Member, but analyst, on a write | `403` | `permission_denied` |

Collapsing the first two into one answer was rejected, and the reason is in
`lib/api/server.ts`: `apiFind` turns a 404 into `undefined` so a screen can draw
"nothing here", while a 403 throws and lands on an error boundary. One answer
for both would make a stale workspace cookie — the ordinary case after somebody
is removed from a team — render a crash page instead of an empty one. The
inverse is worse: a 404 for "you may read but not write" tells an analyst the
bot they are looking at does not exist.

**The session endpoint does not follow this rule, and the module docstring is
wrong about it.** `tenancy.py` says a hand-edited header "simply falls back to a
workspace the caller does belong to" — that is `_session_payload` in
`accounts/views.py`, which silently falls back to `memberships[0]`.
`resolve_workspace` raises `NotFound`. So `GET /api/auth/session/` with a
foreign id answers 200 for the caller's first workspace while every other
endpoint answers 404 for the same header. Both behaviours are deliberate — the
session is what *chooses* the tenant, so it cannot fail on a bad choice — but
they are not the same behaviour, and only the session one is tested
(`accounts/tests.py::SessionWorkspaceTests`).

## Adding a tenant-scoped endpoint

Write `queryset = Model.objects.all()` and add the mixin:

```python
class ThingViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    permission_classes = [IsWorkspaceMember]
    queryset = Thing.objects.all()
```

`get_queryset` filters by the resolved workspace and `perform_create` stamps it.
`self.workspace` and `self.membership` are memoised for the request. A model
that reaches its tenant through a different column sets `workspace_field`.

What a new endpoint must **not** do:

- **Filter by hand.** `Model.objects.filter(workspace_id=request.data["workspaceId"])`
  is the whole bug: the id came from the caller. If the mixin does not fit —
  function views under `analytics/`, `billing/`, `marketplace/` — call
  `resolve_workspace(request)` and use what it returns, never what was sent.
- **Take a workspace id as a body field or a URL segment.** Nothing in the API
  does; the header is the only channel, so there is one thing to audit.
- **Drop `IsWorkspaceMember` because "this one is read-only".** The class is
  what makes an analyst's `POST` a 403, and a viewset that only lists today
  grows an `@action` tomorrow.

On the frontend, the mirror-image mistake is quiet rather than loud: `apiRequest`
sends `X-Workspace-Id` **only if the repository passes `workspaceId`**. Forget it
and the backend falls back to the caller's first membership — a 200 carrying
another workspace's rows, no error anywhere. Every method in
`features/*/data/*-repository.ts` that touches tenant data passes it; keep that
true.

Sockets check membership once, at handshake (`realtime/consumers.py::_is_member`,
`invited=False`), and are one-way. Anything a client wants to *do* goes back
through the REST API, where permissions already live.

## The four roles

`workspaces/models.py`: `Role` (owner, admin, editor, analyst), `RANK`
(4/3/2/1) and `WRITE_ROLES = {owner, admin, editor}`. `IsWorkspaceMember` is
`SAFE_METHODS → any member`, everything else → `role in WRITE_ROLES`. That is
the whole read/write rule, in one class rather than a check copied into thirty
views.

Managing *people* needs more than write: `members`, `invite-link` and
`/api/members/<id>/` all require owner or admin.

**Nobody hands out a role above their own.** The rule is spelled out three
times, all in `apps/workspaces/views.py`, with no shared helper:

1. `WorkspaceViewSet.members` (POST — the email invite)
2. `WorkspaceViewSet.invite_link` (POST — the link invite)
3. `MembershipViewSet.partial_update` (PATCH — changing an existing member)

A fourth grant path needs a fourth copy. There is a natural home for it that is
currently dead code: `outranks()` in `features/workspace/roles.ts` is exported
and imported by nothing — the team screen only disables the `owner` option and
otherwise lets the backend refuse. Nothing is broken by that (the backend is the
enforcement), but a reviewer who assumes the UI filters by rank is wrong.

Two things the code does that the comments next to it do not say:

- **Equal rank is allowed.** `MembershipViewSet._actor` refuses on
  `target.rank > actor.rank`, so an admin can demote *and remove* another admin.
  The comment above it claims "two admins may not demote each other into a
  stalemate"; `>` is not `>=`, and they can.
- **An owner can demote themselves to analyst**, leaving the workspace with zero
  owners. `destroy` refuses to remove a member whose role is `owner`, but the
  demotion happens first and then there is no owner to protect. A workspace in
  that state cannot be deleted (`perform_destroy` requires `Role.OWNER`) and
  nobody can be promoted back above admin. The team screen locks the owner row,
  so this is reachable only through the API — which is exactly the reach a token
  from `/api/auth/login/` has.

## Signing in

Three doors, one account. However the proof arrives it names a Telegram id, and
`telegram_views._user_for_telegram` maps that id onto exactly one `User`.

**Password.** `POST /api/auth/login/` returns both a session cookie and a DRF
token; `_session_payload` carries the user, the memberships, the active
workspace and the role *in that workspace*. Wrong password and unknown account
give the same `invalid_credentials` — telling them apart is a free
account-existence oracle. Session auth also enforces CSRF on unsafe methods,
which is half of why the token exists.

**The Login Widget.** `POST /api/auth/telegram/` takes the payload exactly as
Telegram signed it and checks the HMAC in `accounts/telegram_auth.py`. The
secret is `sha256(bot_token)` — the *digest*, not the token — over the six
signed fields sorted and joined by newlines; anything older than a day is
refused, because `auth_date` is signed for exactly that reason. Pass the payload
through untouched: `telegramLoginAction` adds, removes and reorders nothing,
since a "helpful" normalisation makes a valid login look forged.

The widget only renders on the domain registered with @BotFather (`/setdomain`).
Served anywhere else it draws its own English error inside a cross-origin
iframe — text no stylesheet can reach and no script can read. So
`GET /api/auth/telegram/config/` asks Telegram itself
(`_widget_domain_registered` fetches `oauth.telegram.org/embed/<bot>` and looks
for `tgme_widget_login`), caches the answer 15 min on success and 60 s on
refusal, and the sign-in screen shows the password form instead. A dev tunnel
changes hostname on every reconnect, so `domain_mismatch` there is normal, not a
bug — see the `stend` skill.

**Mini App.** `POST /api/auth/telegram/webapp/` verifies `initData` with a
*different* secret: `HMAC(key="WebAppData", bot_token)`, not the token's digest.
Confusing the two is the classic way to ship a check that always fails — or one
that always passes. Both readings of Telegram's newer `signature` field are
tried, because clients disagree about whether it belongs in the hashed string
and accepting either narrows nothing (the HMAC still has to match).

**The Start button.** `TelegramLoginRequest`, in `accounts/models.py` and
`bot_login.py`, is the way in with no domain in it: the panel opens
`t.me/<bot>?start=<nonce>`, the person presses Start, the bot's own webhook
approves the nonce, and the panel's poll exchanges it for a session.

What makes it safe is the nonce and nothing else, so it behaves like a one-time
password. It is `secrets.token_urlsafe(32)` — 256 bits, nothing to guess. It
lives five minutes (`BOT_LOGIN_TTL`), long enough to switch apps and short
enough that a link left in a tab overnight is not a way in. It is worth exactly
one session: `telegram_bot_status` claims it with a conditional
`UPDATE … WHERE consumed_at IS NULL`, so two polls arriving together produce one
session and one `consumed`, not two sessions. And it is worthless on its own —
approving it requires being the person Telegram authenticated in that chat. The
webhook itself is gated by a `secret_token` derived from `SECRET_KEY`
(`bot_login.webhook_secret`), so it rotates with the deployment and is not a
third thing to configure.

**The identity a Telegram-only account gets.** Telegram hands over no email
address, so `_user_for_telegram` creates `tg<id>@telegram.local` — a placeholder
that cannot collide with a real inbox — calls `set_unusable_password()`, and
sets `email_verified=True` from the start. That last part reads backwards until
you ask what verification proves: a clicked link proves somebody could open one
mailbox once. Telegram proved an account identity and keeps proving it on every
sign-in. Skipping the mail is not a shortcut around a check, it is declining to
run a weaker check after a stronger one has passed. Somebody who later wants a
password sets a real address in settings.

## Invites

Two shapes, one `Invite` row, single use either way — `join_workspace` stamps
`accepted_at` and `is_usable` refuses it afterwards. A link left open in a group
chat is open to whoever finds it next month, so a second person gets a second
link, never a longer-lived one. `INVITE_TTL` is 14 days.

- **Email invite** — `POST /api/workspaces/<id>/members/`. Creates the `Invite`
  *and* a `Membership` with `invited=True`, so the seat is held and the team
  screen can show "Taklif yuborilgan" against a name no account exists for yet.
- **Link invite** — `POST /api/workspaces/<id>/invite-link/`. Names no
  recipient, so there is nobody to hold a seat for and no `Membership` row until
  somebody redeems it. `invites.py` builds the two links it comes back with: the
  `/join/<code>` URL and `t.me/share/url?...`, Telegram's own share sheet with
  the chat picker up and the message already written. The message text is built
  next to the URL because the two have to agree about which workspace they name.

`Membership.invited` is a held seat in two places and not in a third: it blocks
the address under `uniq_membership_email`, and the team screen counts it in
`seatsLeft`, but `billing/services.py` counts `invited=False` only. The screen
and the plan therefore disagree by the number of outstanding invitations.

**⚠ Redeeming is a POST, and it used to be a GET.** The first version of
`/join/<code>` redeemed while rendering, on the theory that the reader had
already pressed a button — the link. The code is single use, so whatever fetched
the page first spent it: a link prefetch, a double render in development, a
refresh. The screen that finally drew reported the reader's own fresh invite as
"bunday taklif kodi topilmadi" — accurately, about a code it had just consumed
itself. That is why `invite_preview` exists at all:
`GET /api/workspaces/invite/<code>/` reads the workspace name, the role, whether
the code is usable and whether the reader is already a member, and changes
nothing. `POST /api/workspaces/join/` is the only thing that spends it, driven
by `acceptInviteAction` from a form. Never move a redemption into a loader,
a `page.tsx`, or anything a prefetch can reach.

Two things about redemption that are not obvious from the code:

- **The code is a bearer token; the address on it is not checked.**
  `join_workspace` matches an existing membership by `request.user.email` and
  otherwise creates a new one — it never compares `invite.email` to the
  redeemer. A code minted for `jasur@sunrise.uz` and forwarded to anybody else
  grants that person the invited role, and Jasur's pending seat stays held
  forever. Intended for link invites, unexamined for email ones.
- **An existing member keeps their role.** The role is only set on the branch
  that constructs a new `Membership`, so redeeming an admin link as an analyst
  does not promote anybody. `joined_at` *is* reset, which can change which
  workspace a header-less request defaults to.

`Invite.code` defaults to `new_id()` — `secrets.token_hex(8)`, 64 bits. The
docstring on `new_secret()` in `apps/common/models.py` describes exactly this
case ("nowhere near enough for something that stands in a URL as the only thing
between the public internet and an endpoint") and is not what the model uses.
Same for `VerificationToken.token`, which is a password-reset link.

## Rate limits

`IpRateThrottle` counts by client address whether or not the caller is signed
in. Not DRF's `AnonRateThrottle`: that one steps aside the moment a request
carries a credential, and "mail me another verification code" comes from an
account that already has one.

| Scope | Rate | Endpoints |
| --- | --- | --- |
| `auth` | 12/min | signup, login, verify-email, reset-password, telegram, telegram/webapp, telegram/start |
| `auth-email` | 5/min | forgot-password, resend-verification |
| `auth-poll` | 600/min | telegram/status |

Over it: `429` with code `rate_limited`, which the frontend's `AuthErrorCode`
already renders. No ceiling at all on `telegram/config/`, `reset-password/<token>/`
(a GET that returns a masked address for a valid token), `workspaces/invite/<code>/`
or `workspaces/join/` — the last three are guessing oracles over 64-bit codes.

**The buckets are shared, not per-visitor.** The panel calls Django from its own
server and `lib/api/server.ts` forwards no client address; `NUM_PROXIES` is
unset. DRF therefore sees one client for every browser in the world, and the
12/min login ceiling is the whole deployment's. `auth-poll` was raised to 600
after two people signing in at once gave each other 429s; `auth` and
`auth-email` have the same problem and have not been raised. The durable fix is
per-client identity — forward the address and set `NUM_PROXIES` — after which
all three come back down.

Counters live in the cache, which is Redis in production and **LocMemCache in
dev and test** (`config/settings/dev.py`, `test.py`). Tying the login screen to
a running broker would make the API unusable while Redis is down, which is a
normal state on a laptop. Two consequences: a throttle test must
`cache.clear()` in `setUp` or it inherits the previous test's counter, and in
dev each Django process has its own allowance.

`DEV_EXPOSE_AUTH_CODES` returns verification and reset codes in the response
body, and it is `DEBUG` — but `dev.py` turns `DEBUG` off the moment
`PUBLIC_BASE_URL` is not localhost, unless `DJANGO_DEBUG_PUBLIC=1` is set by
name. That is the only thing standing between a tunnelled stand and
"forgot-password hands out a working reset token for any address it knows".
Do not re-derive `DEV_EXPOSE_AUTH_CODES` from `base.DEBUG`.

## Tests

```bash
cd backend && .venv/bin/python manage.py test apps.workspaces apps.accounts --settings=config.settings.test
```

`apps/workspaces/tests.py` is new and covers the invite **link** only: that the
payload names both URLs and encodes the join URL into the Telegram one, that it
holds no seat, that redeeming makes a member at the invite's role, that it works
exactly once, that reading the preview three times does not spend it, that a
spent code reads as unusable rather than missing, that an editor cannot mint one
and that an admin cannot mint an owner link.

`apps/accounts/tests.py` is older and larger — signup/login/verify/reset,
throttling, the session's active workspace and role, the widget, the Mini App,
the domain probe, and the whole bot-Start flow including a nonce being worth one
session. The brief that this skill was written from claimed accounts had no
tests; it has a substantial suite. What it does not have is below.

**Untested, roughly in the order a reviewer should care:**

1. **Cross-tenant reads.** No test anywhere asks whether workspace A's token can
   fetch workspace B's bots, flows, contacts or analytics. `bots/tests.py` has
   one 404 for a foreign *project* on a PATCH and `accounts/tests.py` has one
   ignored session header; `tenancy.py` itself has no test file. This is the
   product's core claim and it is asserted nowhere.
2. **`IsWorkspaceMember` and `WorkspaceScopedMixin` directly.** The analyst
   read/write pair is exercised once, incidentally, in `bots/tests.py`. The
   404-vs-403 distinction, the no-memberships 403 and the `?workspaceId=`
   fallback path have no coverage at all.
3. **`MembershipViewSet`.** Nothing tests role changes or removals: not the
   equal-rank behaviour, not owner self-demotion, not `owner_locked`, not that
   `/api/members/<id>/` 404s for another tenant's membership row.
4. **The email invite.** `members` POST, the held seat, `member_exists`, and the
   fact that a stranger holding the code takes the invited role while the seat
   stays pending.
5. **Unverified accounts.** `User.email_verified` is set and read but never
   *enforced* by the API — an unverified account with a membership can create
   projects through its token. The gate is the route guard reading `oqim_session`,
   a base64 cookie the browser can rewrite. Either the model's docstring ("the
   API refuses tenant data until then") is wrong or a permission is missing;
   a test would force the decision.
6. **`logout`, `PATCH /api/auth/session/`, `resend-verification`,
   `reset-password/<token>/`.** Four endpoints in `accounts/views.py` with no
   test. The first deletes the DRF token, which is what actually ends a script's
   access.
7. **The workspace serializer's slug collision loop** and
   `CreateWorkspaceSerializer` making the creator an owner.

When adding tests here, use `config.settings.test`: in-memory SQLite, LocMem
cache, `TELEGRAM_OFFLINE` forced, `DEV_AUTO_VERIFY_EMAIL`/`DEV_EXPOSE_AUTH_CODES`
off so the unshortened flow is what runs. Never point a test at
`backend/db.sqlite3` — it is the user's real stand.
