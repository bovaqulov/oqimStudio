<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working here

`npm run verify` before you hand anything over — `check:comments`,
`check:effects`, `check:classes`, `typecheck`, `lint`. The repo-wide `scripts/verify.sh` runs
these plus the backend suite and a sweep of the stand; see the root
`CLAUDE.md` for what each one is defending against.

Two conventions the checks enforce, so that neither is a matter of memory:

- **No `*/` inside a block comment.** It ends the comment there, whatever the
  author meant, and the parse error lands on a later line that is fine. Write
  `features/<area>/data`, not the wildcard.
- **`cn` concatenates, it does not merge.** It is `clsx`, not
  `tailwind-merge`, so `cn("p-2", big && "p-4")` emits both and the stylesheet
  decides which wins — not the order you wrote them in. Give each branch its
  own value instead of layering one over another. A conflict that really is
  deliberate says `cn-override-ok: <why>` on the line.
- **Nothing is written during a render.** Server components run more often than
  the reader asked for. Repositories and `"use server"` actions do the writing,
  and a page reaches them through a form action or a button — never in the
  render function. If a write really is idempotent, say why on the line with
  `render-effect-ok:` and the check will believe you.
