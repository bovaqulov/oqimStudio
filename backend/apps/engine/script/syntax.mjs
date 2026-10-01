/**
 * Where a file stops parsing — a line number and nothing else.
 *
 * `host.mjs` runs an author's code and reports the line a *throw* came from,
 * which it reads out of the stack V8 wrote. A file that does not compile has
 * no stack: the module never exists, so the SyntaxError a dynamic `import()`
 * rejects with carries Node's own internal frames and no trace at all of the
 * source it failed on. Checked on this machine: `error.stack` is
 * `SyntaxError: Unexpected token '='` followed by seven `node:internal/…`
 * lines, and the error's only own properties are `stack` and `message`.
 *
 * So a missing brace could be reported — but never pointed at, which is the
 * one thing the panel was built to do. `vm.Script` compiles the same text and
 * throws an error whose stack *begins* with `<filename>:<line>`, because it is
 * compiling rather than importing. That is what this reads.
 *
 * **Nothing here runs.** `new vm.Script` parses and compiles; it does not
 * execute, and no `runInContext` follows. That is what makes this safe to
 * point at a file the six boundaries in `sandbox.py` would otherwise be
 * holding — there is nothing to hold, because there is no execution. The
 * hardening flags are passed anyway, and `vm.Script` still compiles under
 * `--disallow-code-generation-from-strings`: that flag stops `eval` and
 * `new Function`, which reach the *calling* scope, and a `vm.Script` does not.
 *
 * Called only when something has already failed, and only to locate it — never
 * to decide whether a file is broken. `sandbox.check_syntax` is what decides,
 * by running the real thing.
 */

import vm from "node:vm";

/**
 * The wrapper, and why the number moves by one.
 *
 * The author's text is the *body of an async function* — that is the contract
 * `host.mjs` folds it into, and it is what makes a top-level `return` the way
 * a script answers. A bare `vm.Script` would refuse that `return` as a syntax
 * error of its own and report a fault in a file that is fine, so the same
 * wrapper goes on here. It is one line, so every line the compiler names is
 * one more than the line the author is looking at.
 */
const OPEN = "(async function () {\n";
const CLOSE = "\n})";
const WRAPPER_LINES = 1;

/** The name the compiler prints before the line. Short, and not a path. */
const FILENAME = "oqim";

let source = "";
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  source = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).source ?? "");
} catch {
  process.stdout.write(JSON.stringify({ line: null }));
  process.exit(0);
}

let line = null;
try {
  new vm.Script(OPEN + source + CLOSE, { filename: FILENAME });
} catch (error) {
  // The first line of the stack, and only ever that one. V8 writes the
  // location there — `oqim:3` — before the source excerpt and the caret. The
  // frames after it are Node's own and name this file, not the author's.
  const first = String(error?.stack ?? "").split("\n")[0] ?? "";
  const match = new RegExp("^" + FILENAME + ":(\\d+)$").exec(first.trim());
  if (match) {
    const found = Number(match[1]) - WRAPPER_LINES;
    // A fault on the wrapper's own line is a fault this file caused, and
    // pointing at line 0 of somebody's script is worse than pointing nowhere.
    if (Number.isInteger(found) && found > 0) line = found;
  }
}

process.stdout.write(JSON.stringify({ line }));
