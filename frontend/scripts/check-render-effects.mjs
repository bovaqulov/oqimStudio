/**
 * Finds writes that happen while a page is being rendered.
 *
 * A GET is fetched more times than the reader asked for: Next prefetches a
 * link on hover, React renders twice in development, a refresh renders again.
 * Anything a server component does during render therefore happens an
 * unpredictable number of times. `/join/<code>` redeemed a single-use invite
 * in its render function and the reader was told their own link was invalid —
 * it was, by the time the page they were looking at finished drawing. The
 * class is wider than that one screen: any POST, PATCH, PUT or DELETE reached
 * from a render is the same bug wearing different clothes.
 *
 * ## What it knows
 *
 * The seam makes this mechanical. Every backend call in the app goes through
 * `apiRequest` in `lib/api/server.ts`, and the HTTP method is a literal in the
 * options object, so "does this repository method write" is a text question
 * with a definite answer. From there:
 *
 *   1. a repository method containing a non-GET `method:` is a mutation;
 *   2. a `"use server"` export that reaches one is a mutation;
 *   3. a file that is neither a client component nor a server action module is
 *      render code, and must call neither.
 *
 * Passing an action to `<form action={…}>` is a reference, not a call, so it
 * does not match — which is exactly the distinction the fixed `/join` page
 * draws: read on GET, write on the button.
 *
 * ## Why a script and not an eslint rule
 *
 * The question spans files: the page calls `join`, and only the repository
 * knows `join` is a POST. Eslint judges one file at a time and would have to
 * be told the answer in a list somebody maintains by hand — which is the same
 * as not checking.
 *
 * Run: `npm run check:effects` (part of `npm run verify`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const WRITE_METHOD = /method:\s*"(?:POST|PATCH|PUT|DELETE)"/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
  }
}

const files = [...walk(SRC)];
const read = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
const name = (file) => relative(ROOT, file).split("\\").join("/");

/**
 * Comments blanked, newlines kept, so a line number still means something.
 *
 * Only block comments and whole-line `//` are removed: a naive `//` strip eats
 * the tail of every line holding a URL, and hiding a real call behind
 * `https://` is the one failure this check cannot afford.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*)/.test(line) ? "" : line))
    .join("\n");
}

// ---------------------------------------------------------------- mutations

/** `workspacesRepository.join`, `botsRepository.create`, … */
const mutatingMethods = new Set();

for (const file of files) {
  if (!/\/data\/[^/]+\.ts$/.test(name(file))) continue;
  const text = withoutComments(read.get(file));

  // `export const xRepository: XRepository = new ApiXRepository()`
  const instances = new Map();
  for (const [, constName, className] of text.matchAll(/export\s+const\s+(\w+)[^=]*=\s*new\s+(\w+)\s*\(/g)) {
    instances.set(className, constName);
  }

  // Class members sit at exactly two spaces of indent in this codebase; each
  // one owns the text up to the next member, which is enough to see its verbs.
  for (const [, className, body] of text.matchAll(/\bclass\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
    const exported = instances.get(className);
    if (!exported) continue;
    const members = [...body.matchAll(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)];
    members.forEach((member, index) => {
      const end = index + 1 < members.length ? members[index + 1].index : body.length;
      if (WRITE_METHOD.test(body.slice(member.index, end))) mutatingMethods.add(`${exported}.${member[1]}`);
    });
  }
}

/** Server actions that reach one — grown to a fixpoint, since actions call actions. */
const mutatingActions = new Set();
const actionModules = files.filter((file) => /^\s*"use server";/.test(read.get(file)));

for (let changed = true; changed; ) {
  changed = false;
  for (const file of actionModules) {
    const text = withoutComments(read.get(file));
    const exports = [...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)];
    exports.forEach((match, index) => {
      if (mutatingActions.has(match[1])) return;
      const end = index + 1 < exports.length ? exports[index + 1].index : text.length;
      const body = text.slice(match.index, end);
      const reaches =
        WRITE_METHOD.test(body) ||
        [...mutatingMethods, ...mutatingActions].some((symbol) =>
          new RegExp(`\\b${symbol.replace(".", "\\.")}\\s*\\(`).test(body),
        );
      if (reaches) {
        mutatingActions.add(match[1]);
        changed = true;
      }
    });
  }
}

// ------------------------------------------------------------- render files

/**
 * Render code: the app router's own files, and every server component.
 *
 * A `route.ts` counts only while GET is all it answers — a POST handler is a
 * form submission and is meant to write. Repositories are excluded because
 * they *are* the write layer, and `.ts` modules outside `app/` because a plain
 * module is not render code: whatever calls it is, and that is what gets
 * judged. The gap that leaves is a helper module wrapping a repository call —
 * nothing does that today, and the day something does, this check will not
 * see through it.
 */
function isRenderCode(file, text) {
  const path = name(file);
  if (/^\s*"use (client|server)";/.test(text)) return false;
  if (/\/data\//.test(path)) return false;
  if (/\/route\.ts$/.test(path)) {
    return /export\s+(?:async\s+)?function\s+GET\b/.test(text) &&
      !/export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.test(text);
  }
  return path.startsWith("src/app/") || path.endsWith(".tsx");
}

/**
 * The one way out, and it costs a sentence.
 *
 * Some writes really are safe to repeat — `ensureMainFlow` POSTs, but the
 * backend keeps the "exactly one main flow" rule, so a prefetch cannot make a
 * second one. That is a judgement, and a judgement nobody wrote down is
 * indistinguishable from an oversight six months later. The marker is
 * therefore not a bare disable: the text after the colon is the point of it.
 */
const ALLOW_MARKER = /render-effect-ok:\s*\S/;

/**
 * Is the call at `index` covered by a marker?
 *
 * The marker may sit on the call's own line or in the comment above it, and
 * "above" walks up past comments, blank lines and the `if (…) {` the call is
 * nested in — the comment explaining a guarded write is written above the
 * guard, not squeezed between the guard and the call. It stops at the first
 * line that is none of those, so a marker cannot be inherited from unrelated
 * code further up.
 */
function isAllowed(lines, index) {
  if (ALLOW_MARKER.test(lines[index] ?? "")) return true;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = (lines[cursor] ?? "").trim();
    if (ALLOW_MARKER.test(line)) return true;
    const isPreamble = line === "" || line.startsWith("//") || line.startsWith("*") || /[{(]$/.test(line);
    if (!isPreamble) return false;
  }
  return false;
}

const symbols = [...mutatingMethods, ...mutatingActions];
const problems = [];

for (const file of files) {
  const raw = read.get(file);
  if (!isRenderCode(file, raw)) continue;
  const lines = withoutComments(raw).split("\n");
  for (const symbol of symbols) {
    const call = new RegExp(`(?<![\\w$.])${symbol.replace(".", "\\.")}\\s*\\(`);
    lines.forEach((line, index) => {
      if (!call.test(line)) return;
      if (isAllowed(raw.split("\n"), index)) return;
      problems.push({ file: name(file), line: index + 1, symbol, text: line.trim() });
    });
  }
}

if (problems.length > 0) {
  for (const problem of problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.error(`${problem.file}:${problem.line}  calls ${problem.symbol}() while rendering`);
    console.error(`  ${problem.text}`);
  }
  console.error(
    `\n${problems.length} write(s) reached from a render. A prefetch, a double render and a refresh each ` +
      `run this again — move it behind a form action, a button, or a POST route handler.`,
  );
  process.exit(1);
}

console.log(
  `check:effects — ${symbols.length} mutating symbols (${mutatingMethods.size} repository, ` +
    `${mutatingActions.size} action), none reached from a render.`,
);
