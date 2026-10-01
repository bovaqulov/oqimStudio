/**
 * Finds one `cn(...)` call handing Tailwind two classes that fight.
 *
 * `cn` is `clsx` and nothing else — read `src/lib/utils/cn.ts`. It concatenates;
 * it does not merge. So `cn("p-2", big && "p-4")` emits **both** classes when
 * `big`, and which one wins is decided by the order Tailwind wrote them into
 * the stylesheet, not by the order they appear in the call. Authors who have
 * used `tailwind-merge` — which is what most projects put behind a function
 * with this name — write that line expecting the last one to win, and it does
 * not. The failure is silent: no error, no warning, and a padding that is
 * simply wrong on the branch nobody screenshotted.
 *
 * ## Why not just install tailwind-merge
 *
 * Because that changes what every existing `cn` call in the tree renders, and
 * some of them layer classes on purpose. Swapping the implementation to fix a
 * dozen sites would silently re-render several hundred. The conflict is worth
 * catching where it is written; the merge is a separate decision, and this
 * check is what would make it safe to take.
 *
 * ## What it reads
 *
 * Only string literals inside a `cn(` call — the parts a scan can be sure
 * about. A class arriving through a variable or a lookup table is invisible
 * here and always will be; this is a net for the common shape, not a proof.
 *
 * A conflict that is deliberate says so on the line:
 *
 *     cn("p-2", wide && "p-6") // cn-override-ok: the wide branch replaces it,
 *                              // and both live in the same media query
 *
 * The reason after the colon is the point of it — the same bargain
 * `check:effects` strikes with `render-effect-ok:`.
 *
 * Run: `npm run check:classes`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const EXTENSIONS = [".ts", ".tsx"];

/** Says "this conflict is meant", and why. */
const WAIVER = /cn-override-ok:/;

/**
 * Which utility a class belongs to, or null for one this check has no opinion
 * about.
 *
 * Two classes conflict when they name the same property for the same variant.
 * The variant matters as much as the property: `p-2 md:p-6` is not a conflict,
 * it is responsive design, and a check that flagged it would be turned off
 * within a day. So the variant prefix is part of the key.
 *
 * The families here are the ones where a conflict is both common and silent.
 * Colour is deliberately absent — `text-danger-fg` beside `text-[13px]` is two
 * different properties sharing a prefix, and telling them apart reliably needs
 * the theme rather than a regex.
 */
const FAMILIES = [
  [/^-?p-/, "padding"],
  [/^-?px-/, "padding-x"],
  [/^-?py-/, "padding-y"],
  [/^-?pt-/, "padding-top"],
  [/^-?pr-/, "padding-right"],
  [/^-?pb-/, "padding-bottom"],
  [/^-?pl-/, "padding-left"],
  [/^-?m-/, "margin"],
  [/^-?mx-/, "margin-x"],
  [/^-?my-/, "margin-y"],
  [/^-?mt-/, "margin-top"],
  [/^-?mr-/, "margin-right"],
  [/^-?mb-/, "margin-bottom"],
  [/^-?ml-/, "margin-left"],
  [/^gap-x-/, "gap-x"],
  [/^gap-y-/, "gap-y"],
  [/^gap-/, "gap"],
  [/^min-w-/, "min-width"],
  [/^max-w-/, "max-width"],
  [/^min-h-/, "min-height"],
  [/^max-h-/, "max-height"],
  [/^w-/, "width"],
  [/^h-/, "height"],
  [/^rounded-(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee)-/, (bare) => `radius-${bare.split("-")[1]}`],
  [/^rounded(-|$)/, "radius"],
  [/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table)$/, "display"],
  [/^(static|fixed|absolute|relative|sticky)$/, "position"],
  [/^flex-(row|row-reverse|col|col-reverse)$/, "flex-direction"],
  // One family per CSS property, never per prefix. `items-center` and
  // `justify-center` are align-items and justify-content — a check that called
  // them one family flagged every centred box in the product and would have
  // been switched off the same afternoon.
  [/^items-/, "align-items"],
  [/^justify-/, "justify-content"],
  [/^self-/, "align-self"],
  [/^content-/, "align-content"],
  [/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, "font-weight"],
  [/^overflow-x-/, "overflow-x"],
  [/^overflow-y-/, "overflow-y"],
  [/^overflow-/, "overflow"],
  [/^z-/, "z-index"],
  [/^opacity-/, "opacity"],
];

/**
 * `text-` is two properties wearing one prefix.
 *
 * `text-[13px]` is a size and `text-[var(--island-muted)]` is a colour, and
 * they sit beside each other constantly. Only an arbitrary value that reads as
 * a *length* is treated as a size; everything else — a named colour, a token,
 * anything through `var()` — this check has no opinion about, because telling
 * a theme colour from a theme size needs the theme.
 */
const FONT_SIZE = /^text-(xs|sm|base|lg|xl|\d?xl)$|^text-\[[-\d.]+(px|rem|em|ch|%|pt)\]$/;

/** The `md:`, `hover:`, `dark:` part — two classes only fight inside one. */
function split(className) {
  const cut = className.lastIndexOf(":");
  return cut === -1 ? ["", className] : [className.slice(0, cut + 1), className.slice(cut + 1)];
}

function familyOf(bare) {
  if (FONT_SIZE.test(bare)) return "font-size";
  // First match wins, so the more specific pattern is listed first —
  // `gap-x-2` has to be seen as `gap-x` before `gap-` claims it.
  for (const [pattern, name] of FAMILIES) {
    if (pattern.test(bare)) return typeof name === "function" ? name(bare) : name;
  }
  return null;
}

/**
 * The arguments of one `cn(` call, split on the commas that belong to it.
 *
 * Depth-counted so a comma inside a nested call, an object, an array or a
 * template hole does not end an argument. Strings are skipped whole for the
 * same reason: a comma inside a class string is not punctuation.
 */
function args(body) {
  const found = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      found.push(body.slice(start, index));
      start = index + 1;
    }
  }
  found.push(body.slice(start));
  return found;
}

/**
 * What one argument can contribute, as a list of mutually exclusive
 * possibilities.
 *
 * This is the whole difference between a useful check and a noisy one.
 * `cond ? "p-2" : "p-4"` emits exactly one of those two, ever — flagging it
 * would be flagging the normal way to write a conditional style. So a ternary
 * becomes two alternatives that are never compared with each other, while two
 * *separate* arguments can both land and are compared.
 *
 * The `?` is found at depth zero and outside strings, and an argument with
 * none is a single alternative. Optional chaining (`a?.b`) and nullish
 * coalescing are not ternaries; both are excluded by requiring a matching `:`
 * at the same depth.
 */
function alternatives(argument) {
  let depth = 0;
  let quote = "";
  let question = -1;
  for (let index = 0; index < argument.length; index += 1) {
    const char = argument[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (depth !== 0) continue;
    else if (char === "?" && argument[index + 1] !== "." && argument[index + 1] !== "?") {
      if (question === -1) question = index;
    } else if (char === ":" && question !== -1) {
      // Recursed on both arms, because `a ? x : b ? y : z` is three exclusive
      // possibilities and not two. Read as two, the else arm holds `y` and `z`
      // together and every chained conditional class in the product — which is
      // how a chat bubble picks its alignment — reads as a conflict.
      return [
        ...alternatives(argument.slice(question + 1, index)),
        ...alternatives(argument.slice(index + 1)),
      ];
    }
  }
  return [argument];
}

/**
 * The call body with its comments blanked out.
 *
 * Not cosmetic. A comment inside a `cn(` call routinely holds a comma — this
 * repo's do, because they are sentences — and a comma at depth zero is how an
 * argument ends. Left in, one explained ternary is read as four arguments and
 * its two arms stop being exclusive, which turns the most carefully written
 * call sites in the tree into the noisiest findings.
 *
 * Replaced with spaces rather than removed, so every offset still points at the
 * character it did.
 */
function withoutComments(text) {
  let out = "";
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += text[index + 1] ?? "";
        index += 1;
      } else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") {
        out += " ";
        index += 1;
      }
      out += "\n";
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let blank = index; blank < stop; blank += 1) out += text[blank] === "\n" ? "\n" : " ";
      index = stop - 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** The class names in one piece of source text, from its string literals only. */
function classesIn(text) {
  const found = [];
  for (const literal of text.matchAll(/"([^"\\\n]*)"/g)) {
    for (const className of literal[1].split(/\s+/)) {
      if (className) found.push(className);
    }
  }
  return found;
}

/**
 * One `cn(` body, reduced to the slots it can fill.
 *
 * A slot is a set of alternatives, and at most one alternative of a slot ever
 * lands; two different slots can both land. That is the whole model, and it is
 * what separates `a ? "p-2" : "p-4"` (one slot, safe) from
 * `"p-2", a && "p-4"` (two slots, a conflict).
 *
 * **An alternative holding a nested `cn(` is skipped entirely.** `clsx`
 * flattens a nested call into the same string, so its classes really are in
 * play and a conflict there is real — but reading it needs the expression tree,
 * and an attempt at that turned every carefully written call site in the tree
 * into a finding. A check that cries wolf is a check somebody deletes. So this
 * is deliberately blind there, and says so: what it misses is a conflict this
 * check will never report, not a conflict it will report wrongly.
 */
function slotsOf(body) {
  const slots = [];
  for (const argument of args(body)) {
    const here = [];
    for (const alternative of alternatives(argument)) {
      here.push(/\bcn\(/.test(alternative) ? [] : classesIn(alternative));
    }
    if (here.some((classes) => classes.length)) slots.push(here);
  }
  return slots;
}

/** From just past an opening `(`, the balanced body and where it ended. */
function bodyAt(text, from) {
  let depth = 1;
  let index = from;
  let quote = "";
  while (index < text.length && depth > 0) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    index += 1;
  }
  return { body: text.slice(from, index - 1), end: index };
}

/**
 * Every top-level `cn(` call in a file, with the line it starts on.
 *
 * Top-level only: `start.lastIndex` jumps past the whole call, so a nested
 * `cn(` is never yielded twice — `slotsOf` recurses into it as part of its
 * parent, which is what it is at run time.
 */
function* calls(source) {
  const start = /\bcn\(/g;
  let found;
  while ((found = start.exec(source))) {
    const { body, end } = bodyAt(source, found.index + found[0].length);
    yield { body, line: source.slice(0, found.index).split("\n").length, end };
    start.lastIndex = end;
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) yield path;
  }
}

const problems = [];
let scanned = 0;

for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes("cn(")) continue;
  /*
   * Scanned with the comments blanked out, and this is not tidiness — it is
   * the difference between a working check and one that reads half a file as
   * a single call. `withoutComments` keeps every offset, so lines and slices
   * still point where they did.
   *
   * The reason it matters here is the language: the comments in this repo are
   * Uzbek, and Uzbek is full of apostrophes — `qo'shish`, `o'zgaruvchi`. A
   * paren-matcher that skips string literals reads that apostrophe as an
   * opening quote and runs to the next one, hundreds of lines away, swallowing
   * every call in between into one.
   */
  const source = withoutComments(raw);
  scanned += 1;
  const lines = raw.split("\n");

  for (const call of calls(source)) {
    // The whole call's text, so a waiver written on any of its lines counts —
    // a multi-line `cn(` has no single line to hang the comment on.
    const through = source.slice(0, call.end).split("\n").length;
    if (lines.slice(call.line - 1, through).some((line) => WAIVER.test(line))) continue;

    /*
     * A family claimed by one slot and set differently by another is the
     * conflict: both can land, and which wins is decided by the stylesheet.
     * Inside a single alternative the same family twice is a conflict too —
     * that one is a plain typo, `"px-3.5 px-2"` in one string.
     */
    const claimed = new Map();
    for (const slot of slotsOf(call.body)) {
      const reachable = new Map();
      for (const alternative of slot) {
        const inside = new Map();
        for (const className of alternative) {
          const [variant, bare] = split(className);
          const family = familyOf(bare);
          if (!family) continue;
          const key = `${variant}${family}`;
          const twice = inside.get(key);
          if (twice && twice !== className) {
            problems.push({ file: relative(ROOT, file), line: call.line, a: twice, b: className });
          }
          inside.set(key, className);
          reachable.set(key, className);
        }
      }
      for (const [key, className] of reachable) {
        const previous = claimed.get(key);
        if (previous && previous !== className) {
          problems.push({ file: relative(ROOT, file), line: call.line, a: previous, b: className });
        }
        claimed.set(key, className);
      }
    }
  }
}

if (problems.length) {
  console.error(`check:classes — ${problems.length} ta cn() chaqiruvida bir-biriga zid sinf bor.\n`);
  console.error("`cn` — bu clsx, tailwind-merge emas: ikkalasi ham chiqadi va qaysi biri");
  console.error("yutishini stylesheet tartibi hal qiladi, chaqiruvdagi tartib emas.");
  console.error("Ataylab bo'lsa, o'sha qatorga sababi bilan `cn-override-ok:` yozing.\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}  ${problem.a}  ↔  ${problem.b}`);
  }
  process.exit(1);
}

console.log(`check:classes — ${scanned} ta faylda zid Tailwind sinfi yo'q.`);
