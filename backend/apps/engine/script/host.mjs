/*
 * The Node side of the script sandbox — see `apps/engine/script/sandbox.py`.
 *
 * This file runs one author's script and writes one answer. Everything that
 * makes it safe to do so is imposed from outside it: the process is started
 * with `--permission` (no filesystem, network, subprocess, worker, addon or
 * inspector), with `--disallow-code-generation-from-strings` (no `eval`, no
 * `new Function`), with a heap cap, with an empty environment, and with a
 * parent holding a stopwatch. None of those are checks this file performs, and
 * that is the point: a boundary a script could talk its way past is not one.
 *
 * What this file adds is the last gap those flags leave. The permission model
 * stops `node:fs` from *doing* anything; it does not stop `node:os` from
 * naming the account the server runs as. So the loader is closed to everything
 * except the one module we are about to build.
 *
 * **One script, then this process is over.** The answer is written and
 * `process.exit` follows it on the next line; nothing here loops back to read
 * a second request, and `pool.py` never hands a process out twice. That is the
 * sixth boundary in `sandbox.py`, and the pool in front of this file was
 * written specifically so as not to spend it: a pooled worker is one that has
 * booted and is waiting on stdin, which is to say one that has not yet run
 * anybody's code and never will run more than one person's.
 */

import { registerHooks } from "node:module";

/*
 * Captured before the author's code exists.
 *
 * Their module shares this realm, so it can rewrite `JSON.stringify` or
 * `Array.prototype.map` under us. That is not an escape — the process has no
 * capabilities to escape *to* — but it is a way to garble the answer, and a
 * garbled answer would be read as a runtime fault in the wrong component.
 *
 * `stdin` and `note` join them because `globalThis.process` is replaced further
 * down and, since the pool arrived, is replaced *before* the request is read:
 * everything this file can do before a request exists is work a warm worker has
 * already paid for by the time one does.
 */
const stringify = JSON.stringify;
const parse = JSON.parse;
const now = Date.now;
const write = process.stdout.write.bind(process.stdout);
const note = process.stderr.write.bind(process.stderr);
const exit = process.exit.bind(process);
const stdin = process.stdin;

/** Separates the answer from anything the script printed. Written last, once. */
const SENTINEL = "\n<<<OQIM-SCRIPT-RESULT>>>";

/*
 * "I have booted; send me a script."
 *
 * On stderr rather than stdout, so that stdout stays exactly what it was — the
 * script's own printing followed by one sentinel — and `read_answer` does not
 * have to learn about a second protocol.
 *
 * The parent (`pool.py`) reads this line once, before any request is written,
 * and then stops looking for it; a script cannot forge it, because by the time
 * a script exists nobody is listening and `process.stderr.write` has already
 * been replaced with a no-op. It exists because ~90 ms of what a script call
 * used to cost was spent getting to this line, and a parent that pays it while
 * nobody is waiting turns a 92 ms call into a 7 ms one.
 */
const READY = "<<<OQIM-SCRIPT-READY>>>\n";

/*
 * The only import that resolves.
 *
 * `--permission` already refuses what the builtins would do. This refuses the
 * builtins themselves, so a script cannot read the machine's hostname or the
 * user account either — the class of leak that is not a capability and
 * therefore not covered by a capability model.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("data:text/javascript")) {
      const error = new Error(`«${specifier}» import qilinmaydi — skript ichida modul chaqirib bo'lmaydi.`);
      error.code = "OQIM_IMPORT_DENIED";
      throw error;
    }
    return next(specifier, context);
  },
});

function read(stream) {
  return new Promise((resolve, reject) => {
    let raw = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { raw += chunk; });
    stream.on("end", () => resolve(raw));
    stream.on("error", reject);
  });
}

function finish(payload) {
  write(SENTINEL + stringify(payload));
  // Nothing after this line runs, which is what makes the sentinel the last
  // thing on the stream: a `setTimeout` the script left behind cannot fire
  // after it and append a second answer.
  exit(0);
}

/*
 * `process`, replaced by something that knows nothing.
 *
 * The capability boundaries above stop a script from *doing* anything. They do
 * not stop it from *reading where it is*, and `process` is a directory of
 * exactly that: `env` carries whatever the operating system injected past an
 * empty environment, while `argv`, `cwd()` and `execPath` each spell out an
 * absolute path — which on a developer's machine contains their name and on a
 * server contains the deployment layout.
 *
 * Patching those fields one at a time invites the next release to add a
 * seventh, so the object is replaced instead of edited. Everything this file
 * still needs from the real one — writing the answer, exiting, the stdin it is
 * about to read — was captured as a binding at the top, before any of this, and
 * none of those bindings is reachable from the replacement.
 */
globalThis.process = Object.freeze({
  env: Object.freeze({}),
  argv: Object.freeze([]),
  platform: "sandbox",
  version: "",
  versions: Object.freeze({}),
  cwd: () => "/",
  exit: () => undefined,
  // A script that assumes it can print through the stream directly gets a
  // no-op rather than a crash — and, more to the point, cannot write anything
  // that looks like the sentinel onto the real stream.
  stdout: Object.freeze({ write: () => true }),
  stderr: Object.freeze({ write: () => true }),
});

const logs = [];
// Filled in from the request; the object below is installed before the request
// exists so that a warm worker has already built it.
let logLimit = 50;

/*
 * `console` is replaced rather than silenced. An author debugging a discount
 * calculation needs to see values, and the panel shows these lines back — but
 * they travel in the answer, not on the stream, so a script cannot print
 * something shaped like the sentinel and be believed.
 */
const toLine = (parts) =>
  parts
    .map((part) => {
      if (typeof part === "string") return part;
      try { return stringify(part); } catch { return String(part); }
    })
    .join(" ");

const record = (...parts) => {
  if (logs.length < logLimit) logs.push(toLine(parts).slice(0, 500));
};
globalThis.console = { log: record, info: record, warn: record, error: record, debug: record };

/*
 * ── The seam ─────────────────────────────────────────────────────────────
 *
 * Anything else the author's code is meant to find in scope — a stdlib, extra
 * globals — is installed *here*, on this line, and nowhere else. Two reasons
 * it is this line and not another:
 *
 *   after the replacements above, so a stdlib is written against the `process`
 *   and `console` a script actually sees rather than the real ones;
 *
 *   before the readiness marker below, so building it is work the pool pays
 *   for while nobody is waiting. A stdlib installed after the request arrived
 *   would put its own construction back onto the caller's clock, which is the
 *   cost this whole arrangement exists to remove.
 *
 * A module of one's own reaches here as a *static* `import` at the top of this
 * file, not a dynamic one: static specifiers are resolved while this module is
 * being instantiated, which is before its body runs and therefore before the
 * `registerHooks` above is registered. A dynamic `import("./x.mjs")` from this
 * line would be refused by that hook, exactly as a script's would be.
 * ─────────────────────────────────────────────────────────────────────────
 */

note(READY);

const request = parse(await read(stdin));
logLimit = request.logLines ?? 50;

/*
 * Which line of the body threw.
 *
 * The body is not one author's work: the bot's shared library is prepended to
 * the block's own source before any of it reaches here (see `compose.py`), so
 * "line 14" is a number only the parent can turn back into a place somebody
 * can look at. All this has to do is find it, and V8 has already written it
 * into the stack frame for the module built below — `data:text/javascript,…`
 * followed by `:<line>:<column>`.
 *
 * The offset is the wrapper line: the `export default async function` the body
 * is folded into is one line, and if it ever becomes two, every number
 * reported from here moves with it.
 *
 * This is also the one piece of evidence in this file the author's code can
 * reach — their module shares the realm, and `Error.prepareStackTrace` is
 * writable. Nothing here is worth forging: a stack that has been garbled
 * matches nothing and yields no line, and a forged one points at a line of
 * their own script. What it cannot do is outlive the run: this process answers
 * once and exits, so a patched `Error` is a patch on a realm that is about to
 * stop existing rather than something the next tenant inherits.
 */
const WRAPPER_LINES = 1;

function faultLine(error) {
  let stack;
  try {
    stack = String(error?.stack ?? "");
  } catch {
    return null;
  }
  for (const frame of stack.split("\n")) {
    // The URL carries the whole encoded source and `encodeURIComponent` leaves
    // parentheses alone, so the frame cannot be matched from its front — the
    // line and column at its very end are what identify it.
    if (!frame.includes("data:text/javascript,")) continue;
    const match = /:(\d+):(\d+)\)?\s*$/.exec(frame);
    if (!match) continue;
    const line = Number(match[1]) - WRAPPER_LINES;
    return Number.isInteger(line) && line > 0 ? line : null;
  }
  return null;
}

const started = now();
try {
  /*
   * The author's body becomes a real module, which is what gives it its own
   * scope without `eval`. It is written as the inside of an async function, so
   * `return` is how it answers and `await` is available for nothing in
   * particular — there is no I/O to await — but costs nothing to allow.
   */
  const source =
    "export default async function (inputs, hozir) {\n" + String(request.source ?? "") + "\n}";
  const module = await import("data:text/javascript," + encodeURIComponent(source));

  // `hozir` is a real Date, and always one. It was declared here from the
  // start and never filled in — `sandbox.py` sent no `now` key, so every
  // script that reached for it got `null`, which is the worst answer a named
  // argument can give: it looks like an absent value rather than a missing
  // wire, so the author blames their own code. The clock is the server's and
  // it is read once per run, so a script that asks twice gets the same answer
  // and a test can pin it.
  const value = await module.default(
    request.inputs ?? {},
    new Date(typeof request.now === "number" ? request.now : Date.now()),
  );

  let encoded;
  try {
    encoded = stringify(value === undefined ? null : value);
  } catch (error) {
    finish({
      ok: false,
      kind: "author",
      error: "Natijani saqlab bo'lmadi — faqat oddiy qiymatlar qaytaring (matn, son, ro'yxat, obyekt).",
      logs,
      durationMs: now() - started,
    });
  }

  if (encoded !== undefined && encoded.length > (request.outputBytes ?? 65536)) {
    finish({
      ok: false,
      kind: "author",
      error: "Natija juda katta. Kerakli maydonlarnigina qaytaring.",
      logs,
      durationMs: now() - started,
    });
  }

  finish({ ok: true, value: parse(encoded), logs, durationMs: now() - started });
} catch (error) {
  /*
   * Which half of `FAILURE_KINDS` this is decides the sentence the panel
   * prints, and the two are not interchangeable: "author" sends somebody to
   * re-read what they typed, "runtime" sends them to look at what it did while
   * running. A `SyntaxError` is the first and used to be reported as the
   * second, so a missing bracket was announced as «Kod ishlayotganda» — a
   * typo, described as a failure during execution that never began.
   *
   * A SyntaxError can only come from the author's own text here. The wrapper
   * around it is two fixed lines this file writes, and nothing else is parsed:
   * `--disallow-code-generation-from-strings` rules out `eval` and
   * `new Function`, and `registerHooks` refuses every import that is not the
   * one data: URL built above.
   */
  const authored = error?.code === "OQIM_IMPORT_DENIED" || error instanceof SyntaxError;
  finish({
    ok: false,
    kind: authored ? "author" : "runtime",
    error: String(error?.message ?? error).slice(0, 400),
    line: faultLine(error),
    logs,
    durationMs: now() - started,
  });
}
