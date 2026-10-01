/**
 * Finds block comments that close themselves early.
 *
 * `*` followed by `/` ends a block comment wherever it appears, including in
 * the middle of a sentence. A JSDoc line that mentions a path with a wildcard
 * segment — `features/` star `/data` — therefore ends the comment at the
 * wildcard, and everything the author still meant as prose becomes code. This
 * has taken the whole app down once: every route 500'd, and the error the
 * bundler printed named a *later* line that was perfectly fine.
 *
 * ## Why a text scan and not an eslint rule
 *
 * Because the parser is the thing that has already been confused. Once the
 * comment ends early the file usually stops parsing, so eslint reports
 * `Parsing error: Unterminated template literal` at the last line and never
 * runs a single rule on that file — a custom rule would be dead code in
 * exactly the case it was written for. This reads the bytes instead, so it
 * still works on a file nothing can parse, and it names the line that actually
 * did it.
 *
 * Run: `npm run check:comments` (part of `npm run verify`).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ROOTS = ["src", "scripts"];
const CONFIG_FILES = ["next.config.ts", "eslint.config.mjs", "postcss.config.mjs"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Files this check itself has to talk about `*` `/` in. */
const ALLOW = new Set(["scripts/check-comments.mjs"]);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) yield path;
  }
}

/**
 * The two shapes an early close takes, both judged one line at a time.
 *
 * Line-at-a-time is deliberate: tracking comment state across a file means
 * lexing strings and regex literals correctly, and getting *that* wrong on a
 * file that is already broken is how a checker becomes noise. Both patterns
 * below are anchored on the comment's own punctuation, so a line of ordinary
 * code cannot match either.
 */
function findings(text) {
  const problems = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    // (a) A JSDoc body line — one that starts with `*` and is not the closing
    //     `*/` — that contains a close with more of the sentence after it.
    const body = /^(\s*\*)(?!\/)/.exec(line);
    if (body) {
      const closes = line.indexOf("*/", body[0].length);
      if (closes !== -1 && line.slice(closes + 2).trim() !== "" && !line.slice(0, closes).includes("/*")) {
        problems.push({
          line: index + 1,
          column: closes + 1,
          text: line.trim(),
          why: "this ends the comment, and the rest of the line becomes code",
        });
        return;
      }
    }

    // (b) The opening line doing it: a comment that opens once and closes
    //     twice has closed somewhere its author did not mean it to.
    const opens = line.indexOf("/*");
    if (opens !== -1) {
      const first = line.indexOf("*/", opens + 2);
      if (first !== -1 && line.indexOf("*/", first + 2) !== -1) {
        problems.push({
          line: index + 1,
          column: first + 1,
          text: line.trim(),
          why: "the comment closes twice on this line — the first one is the accident",
        });
      }
    }
  });

  return problems;
}

const files = [
  ...ROOTS.flatMap((dir) => {
    const path = join(ROOT, dir);
    try {
      return statSync(path).isDirectory() ? [...walk(path)] : [];
    } catch {
      return [];
    }
  }),
  ...CONFIG_FILES.map((name) => join(ROOT, name)),
];

let failures = 0;
for (const file of files) {
  const name = relative(ROOT, file).split("\\").join("/");
  if (ALLOW.has(name)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const problem of findings(text)) {
    failures += 1;
    console.error(`${name}:${problem.line}:${problem.column}  ${problem.why}`);
    console.error(`  ${problem.text}`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} block comment(s) end early. Rewrite the path without the wildcard ` +
      `(\`features/<area>/data\`) or split the star and the slash.`,
  );
  process.exit(1);
}
console.log(`check:comments — ${files.length} files, no block comment ends early.`);
