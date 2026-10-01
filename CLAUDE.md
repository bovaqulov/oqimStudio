# Oqim Studio

Telegram bot automation studio: a visual flow editor and the runtime that
actually answers messages. Two applications in one repository.

```
otchyot/
  frontend/   Next.js 16 + React 19 + Tailwind 4 — the interface (Uzbek)
  backend/    Django 6 + DRF + Channels + Celery — API, webhooks, flow runtime
```

## Working in `frontend/`

@frontend/AGENTS.md

```bash
cd frontend
npm run dev         # :3000
npm run verify      # the four checks below, in the order that fails fastest
npm run typecheck   # tsc --noEmit
npm run lint
```

Feature-first layout under `src/features/*`; the domain types those folders
export (`ModuleKey`, `FlowRecord`, `AnalyticsReport`, `AuthUser`, …) are the
contract the backend serialises to, camelCase included.

## Working in `backend/`

See `backend/README.md` for the full picture.

```bash
cd backend
.venv/Scripts/python manage.py runserver                            # :8000, ASGI
.venv/Scripts/python manage.py test apps --settings=config.settings.test
```

`TELEGRAM_OFFLINE=1` (the default in `.env.example`, forced in tests) means no
Bot API call leaves the machine, so the whole runtime can be driven without a
token.

## Between the two

The frontend reads and writes through the Django API — there is no in-memory
data left. `frontend/src/lib/api/server.ts` is the only place that knows the
base URL, the credential and the tenant header; every repository under
`features/<area>/data` goes through it, server-side.

Two rules worth knowing before editing either side:

- **The credential never reaches the browser.** Signing in is a server action
  that writes the backend's token into an httpOnly cookie. A client component
  that imports a repository — or a feature barrel that re-exports one — pulls
  `server-only` into the browser bundle and fails the build; import the action
  module directly instead.
- **Payload names match on purpose.** The serializers emit the same camelCase
  the TypeScript types describe, so a screen and an endpoint can only disagree
  if one of them changed without the other.

## Before you say it works

```bash
scripts/verify.sh              # backend, frontend, and the stand that is running
scripts/verify.sh --no-stand   # the checkout only
```

One command and not six, because the ways this tree breaks do not overlap and
no single tool sees them all — and because several agents edit it at once, so
"is it broken, and was it me" has to be one question you can ask cheaply,
before you start as well as after. Every check in it is there because it cost a
session:

- **`check:comments`** — `*/` inside a block comment ends the comment. A JSDoc
  line naming a wildcard path (`` `features/*/data` ``) closed one early, the
  rest of the sentence became code, and Turbopack reported the error on a
  later, innocent line. It reads the bytes instead of the AST on purpose:
  eslint on such a file reports `Unterminated template literal` at the last
  line and runs no rule at all, so a rule is dead code in the one case it was
  written for.
- **`check:effects`** — a GET is fetched more times than the reader asked for:
  a hover prefetches, development renders twice, a refresh renders again.
  `/join/<code>` redeemed a single-use invite during render, so whatever
  fetched the page first spent it and the screen told the reader their own link
  was invalid. Read in render; write behind a form action, a button or a POST
  handler. It knows which repository methods write by reading the HTTP method
  out of `apiRequest` — which is the payoff for every backend call going
  through one seam. A write that genuinely is safe to repeat says so on the
  line: `render-effect-ok: <why>`, and the reason after the colon is the point
  of it.
- **migrations against models** — a model changed without the migration beside
  it passes every test, because the test database is built from the models
  themselves. It fails on the one machine that has data on it.
- **the stand that is running** — typecheck and lint read the source; neither
  can see the server actually answering. A Turbopack cache still serving
  exports the source deleted leaves both clean and the browser broken. The
  sweep signs in and opens eleven pages, and it judges them by the error digest
  in the body rather than by the status code: a server component that throws is
  caught by the error boundary above it and answers a perfectly ordinary 200.

The stand itself — tunnels, the four places that hold their hostnames, the
webhooks — is `.claude/skills/stend/`, and `scripts/verify.sh` only reads what
that script writes.
