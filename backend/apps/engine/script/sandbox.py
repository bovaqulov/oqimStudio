"""Running an author's JavaScript, without letting it reach the machine.

A flow can already ask a question, branch on the answer and write it down. What
it cannot do is *arithmetic* worth the name — a tiered discount, a delivery
window, a total across a basket — and every one of those ends with somebody
asking for a place to write a few lines of code.

The architecture note in this repository argued for a purpose-built language
instead, on the grounds that sandboxing a general one is a race you lose over
time. The decision went the other way, so the job became making that race
winnable: not by inspecting the script, which is hopeless, but by giving the
process it runs in nothing worth reaching.

Six boundaries, and each one is a boundary somebody else enforces:

  1. ``--permission``                  no filesystem, network, subprocess,
                                       worker thread, native addon, inspector
                                       or WASI. Node's own model, refused by
                                       the runtime rather than checked by us.
  2. ``--disallow-code-generation``    no ``eval``, no ``new Function``.
  3. a resolve hook (``host.mjs``)     no ``node:`` builtins at all — closing
                                       the leaks a capability model does not
                                       cover, such as the account name the
                                       server runs as.
  4. an empty environment              the one hole ``--permission`` leaves is
                                       ``process.env``, and only the parent can
                                       shut it.
  5. a heap ceiling and a stopwatch    a script that will not stop is killed
                                       rather than reasoned with.
  6. a separate process                whatever happens in there, happens in
                                       there.

The battery in ``tests/test_script_sandbox.py`` is the statement of all six.
It is a security contract, not a unit test: if one of those lines starts
passing, the boundary it names is gone.

The sixth is the one to read twice now that ``pool`` exists. A pool is normally
the thing that spends it — a process reused is a process that carries one
tenant's globals, timers and prototype patches into the next tenant's run — and
this one is built so that it does not: what it holds is processes that have
*booted* and not yet been given a script, and a process that has been given one
answers it and exits. Every worker still runs exactly one script. What was
bought is the ~70 ms of `node` starting up, which used to sit on the clock of
whoever was waiting in a chat; what was not sold is any part of the six.

Nothing here raises. A broken script is a block taking one of its exits, the
same as a question with no answer — never an exception climbing into the
runtime and taking a customer's conversation down with it.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from . import pool
from .concurrency import lease_seconds, slot
from .limits import BUSY, ScriptLimits, ScriptResult

logger = logging.getLogger(__name__)

#: The Node side of this. Beside the module on purpose — the two are one thing.
HOST_SCRIPT = Path(__file__).with_name("host.mjs")

#: Parses a file to find where it stops parsing. Never runs one — see the
#: module's own docstring for why that is what makes it safe.
SYNTAX_SCRIPT = Path(__file__).with_name("syntax.mjs")

#: How long the locator gets. It compiles and returns; a second is a machine
#: under load, not a script running away, and there is no script running.
SYNTAX_TIMEOUT_S = 5

#: Separates the answer from anything the script printed. Written once, last.
SENTINEL = "\n<<<OQIM-SCRIPT-RESULT>>>"

#: The flags that do the work.
#:
#: Written out here rather than read from settings, deliberately: a deployment
#: that can weaken these from a config file is a deployment where the sandbox
#: is a suggestion. Changing them is a code change, reviewed like one.
NODE_FLAGS = ("--permission", "--disallow-code-generation-from-strings", "--no-warnings")

#: The child's whole environment.
#:
#: Empty, and `PATH` is not in it either: the binary is resolved to an absolute
#: path before exec, so nothing needs looking up. It matters because a `PATH`
#: on a developer's machine reads `/Users/<name>/…` and on a server reads the
#: deployment layout — neither is information a tenant's script should be able
#: to print. The operating system injects one or two of its own variables past
#: this; `host.mjs` empties `process.env` again on the far side for that reason.
CHILD_ENV: dict[str, str] = {}


def is_available() -> bool:
    """Whether this machine can run a script at all."""
    return bool(shutil.which("node")) and HOST_SCRIPT.exists()


def check_syntax(source: str) -> str | None:
    """Why this file cannot be stored, or None when it can.

    One sentence, in the language the panel answers in, with the line in it
    where the sandbox reported one.

    It exists because a file that does not parse used to save cleanly. An audit
    found `const = obj.model` sitting in a bot's library five days after
    somebody typed it: the «Tekshirish» button would have found it, nobody had
    pressed it, and every Kod block in that bot had been dead since. A check
    that has to be asked for is a check that reports the fault to whoever
    already knew.

    Only `author` faults refuse the save. A machine with no Node on it answers
    `unavailable`, and a deployment that cannot run scripts must still be able
    to *store* them — refusing there would make the panel unusable on exactly
    the servers that need the code kept somewhere.
    """
    if not source.strip():
        return None
    result = run_script(source)
    if result.kind != "author":
        return None
    # A syntax error arrives with no line, and it is the one fault that always
    # has one. V8 gives a dynamic `import()` no location at all when the module
    # fails to compile — checked, and `syntax.mjs` says what it found — so the
    # number is asked for separately, and only once something is already known
    # to be wrong. A save is a button; a second process launch on the failing
    # path buys the underline the panel exists to draw.
    line = result.line if result.line is not None else syntax_line(source)
    where = "" if line is None else f" ({line}-qator)"
    return f"{result.error}{where}"


def syntax_line(source: str) -> int | None:
    """Which line of `source` stops it compiling, or None.

    Locates; never judges. `check_syntax` above decides whether a file is
    broken by running the real thing under all six boundaries, and this is
    asked afterwards for the one thing that answer cannot carry. A `None` here
    costs the author a message without an underline, which is exactly what they
    had before — so every failure in this function is silent on purpose.
    """
    node = shutil.which("node")
    if not node or not SYNTAX_SCRIPT.exists():
        return None
    try:
        completed = subprocess.run(
            [node, *NODE_FLAGS, str(SYNTAX_SCRIPT)],
            input=json.dumps({"source": source}),
            capture_output=True,
            text=True,
            timeout=SYNTAX_TIMEOUT_S,
            env=CHILD_ENV,
            cwd=str(SYNTAX_SCRIPT.parent),
        )
        return read_line(json.loads(completed.stdout or "{}").get("line"))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def run_script(
    source: str,
    inputs: dict[str, Any] | None = None,
    *,
    limits: ScriptLimits | None = None,
    workspace_id: str | None = None,
) -> ScriptResult:
    """Runs `source` with `inputs` in scope and returns what it answered.

    The script is the *body* of an async function: it reads `inputs` and ends
    with `return`. That shape is what lets somebody write four useful lines
    without first learning what a module is — and it is also why nothing here
    needs `eval`, since the body is wrapped and imported as a real module on
    the far side.

    `workspace_id` is who to charge the slot to. The cap lives here rather than
    at the two call sites deliberately: the runtime and the editor's test panel
    reach the same Node processes on the same box, and a limit one of them can
    forget to ask for is a limit that holds until somebody writes a third
    caller. What it bounds and how a slot comes back after a crash is
    `concurrency`; passing nothing means a caller with no tenant to charge —
    a management command, a test — and takes a host slot only.

    A full cap is a refusal, not a wait. The runtime is on a Telegram
    webhook's clock, and a queue in front of a two-second job is a queue that
    outlives the request it was meant to save.
    """
    limits = limits or ScriptLimits()
    node = shutil.which("node")
    if not node or not HOST_SCRIPT.exists():
        return ScriptResult(ok=False, kind="unavailable", error="Bu serverda skript ishga tushirilmaydi.")

    # Claimed after the availability check, so a deployment without Node does
    # not spend a slot to discover it, and released by the context manager
    # however `_run` ends — a raise included, which is what makes the slot
    # survive a bug in this module rather than only a bug in the script.
    with slot(workspace_id, ttl_seconds=lease_seconds(limits.timeout_ms)) as lease:
        if not lease.granted:
            return ScriptResult(ok=False, kind=BUSY, error=lease.reason)
        return _run(node, source, inputs, limits)


def _run(node: str, source: str, inputs: dict[str, Any] | None, limits: ScriptLimits) -> ScriptResult:
    """One script, in one process, under one stopwatch — the slot is already held.

    The process comes from `pool`, which either had one booted and waiting or
    starts one here. Either way it is a process that has run nothing, it is
    given this one script, and it is over when the script is: `host.mjs` exits
    on the line after it writes the answer, and a script that will not stop is
    killed below. Nothing is handed back.
    """
    request = json.dumps(
        {
            "source": source or "",
            "inputs": to_plain(inputs or {}),
            # The clock the script sees as `hozir`, read here rather than in the
            # child. `host.mjs` has declared that argument since it was written
            # and this key was never sent, so it arrived as `null` on every run
            # — a named argument that is always empty is worse than no argument,
            # because the author reads it as their own mistake.
            "now": int(time.time() * 1000),
            "logLines": limits.log_lines,
            "outputBytes": limits.output_bytes,
        }
    )
    # The whole command line is the pool's key, heap ceiling and all, so a warm
    # worker can only ever be handed to a call that would have spawned exactly
    # it. That is what "the limits differ per call" comes to here: nothing is
    # resized and nothing is reused across ceilings — a call asking for a
    # different `--max-old-space-size` simply does not match this shelf.
    command = (node, *NODE_FLAGS, f"--max-old-space-size={limits.memory_mb}", str(HOST_SCRIPT))

    started = time.monotonic()
    try:
        worker = pool.checkout(command, cwd=str(HOST_SCRIPT.parent), env=CHILD_ENV)
    except OSError as error:  # pragma: no cover - a broken install, not a script
        logger.warning("script host failed to start: %s", error)
        return ScriptResult(ok=False, kind="unavailable", error="Skript muhitini ishga tushirib bo'lmadi.")

    process = worker.process
    try:
        stdout, stderr = process.communicate(request, timeout=limits.timeout_ms / 1000)
    except subprocess.TimeoutExpired:
        # Kill *this* worker and no other. One script per process is what makes
        # that sentence true: there is nothing else in here to take down with
        # it, and the pool has no claim on a process it has handed out.
        _kill(process)
        return ScriptResult(
            ok=False,
            kind="timeout",
            error=f"Skript {limits.timeout_ms} ms ichida tugamadi — sikl cheksiz bo'lishi mumkin.",
            duration_ms=limits.timeout_ms,
        )
    except (OSError, ValueError) as error:  # pragma: no cover - the pipes, not the script
        # A warm worker that died between the shelf and this line leaves a
        # closed pipe rather than an answer. It is the same fact `_no_answer`
        # reports, said by the operating system instead of by an exit code.
        _kill(process)
        logger.warning("script host could not be reached: %s", error)
        return ScriptResult(ok=False, kind="runtime", error="Skript kutilmaganda to'xtadi.")
    finally:
        pool.close(process)

    elapsed = int((time.monotonic() - started) * 1000)
    answer = read_answer(stdout)

    if answer is None:
        # Whatever it said at boot is prepended: the handshake read those bytes
        # off the pipe before `communicate` existed, and stderr is the only
        # evidence a killed process leaves.
        return _no_answer(process.returncode, worker.notes + (stderr or ""), limits, elapsed)

    logs = tuple(str(line) for line in answer.get("logs", []))
    if answer.get("ok"):
        return ScriptResult(ok=True, value=answer.get("value"), logs=logs, duration_ms=elapsed)
    return ScriptResult(
        ok=False,
        kind=str(answer.get("kind") or "runtime"),
        error=str(answer.get("error") or "Skript xato berdi."),
        line=read_line(answer.get("line")),
        logs=logs,
        duration_ms=elapsed,
    )


def read_line(reported: Any) -> int | None:
    """The reported line, or None unless it is plainly one.

    `host.mjs` reads it off `error.stack`, which the author's own module shares
    a realm with and can rewrite, so this is a value derived from something a
    tenant controls. Anything that is not a positive integer is dropped rather
    than passed on to arithmetic in `compose.locate` — `True` is an `int` in
    Python and would have translated into a confident "line 1 of the library".
    """
    if isinstance(reported, bool) or not isinstance(reported, int):
        return None
    return reported if reported > 0 else None


#: Node's exit code for "you awaited something that will never resolve".
#:
#: It is worth naming because the process leaves *no* evidence otherwise: the
#: event loop empties, Node exits at once, and stderr is blank. Reported as a
#: timeout it would send the author looking for a loop that is not there; as
#: "stopped unexpectedly" it would send them nowhere at all.
UNSETTLED_PROMISE_EXIT = 13


def _kill(process: subprocess.Popen) -> None:
    """End a worker that is still running, and wait for it to actually go.

    Bought back from `subprocess.run`, which did this inside itself. It is
    written out here because the killing is now the interesting half: the
    process being killed holds one script belonging to one tenant, so this is
    the whole blast radius of a runaway loop, and the `wait` is what stops a
    timed-out script from leaving a zombie behind on every hot flow in the
    product.
    """
    try:
        process.kill()
        # `communicate` and not `wait`, which is the documented idiom: the
        # child is already dead of a `SIGKILL`, but the reader threads Windows
        # uses to drain those pipes are not, and `wait` does not join them.
        process.communicate(timeout=pool.REAP_TIMEOUT_S)
    except Exception:  # noqa: BLE001 - cleanup; the slot is released either way
        logger.warning("script host would not die", exc_info=True)


def _no_answer(returncode: int | None, stderr: str, limits: ScriptLimits, elapsed: int) -> ScriptResult:
    """No sentinel came back, so the process died before it could write one.

    A killed process cannot report on itself, so the only evidence is the exit
    code and whatever reached stderr on the way down.
    """
    if "heap out of memory" in stderr or "Allocation failed" in stderr:
        return ScriptResult(
            ok=False,
            kind="memory",
            error=f"Skript {limits.memory_mb} MB dan ko'p xotira so'radi.",
            duration_ms=elapsed,
        )
    if returncode == UNSETTLED_PROMISE_EXIT:
        return ScriptResult(
            ok=False,
            kind="author",
            error="Skript hech qachon bajarilmaydigan `await` ustida to'xtadi — kutilayotgan qiymat hech qayerdan kelmaydi.",
            duration_ms=elapsed,
        )
    logger.warning("script host produced no result (rc=%s): %s", returncode, stderr[-400:])
    return ScriptResult(ok=False, kind="runtime", error="Skript kutilmaganda to'xtadi.", duration_ms=elapsed)


def read_answer(stdout: str) -> dict[str, Any] | None:
    """The payload after the last sentinel, or None when there is not one.

    The *last*, because a script may print whatever it likes — including
    something shaped exactly like the sentinel — and the host writes its own
    only after the script has finished, then exits, so nothing can follow it.
    """
    if not stdout:
        return None
    index = stdout.rfind(SENTINEL)
    if index == -1:
        return None
    try:
        payload = json.loads(stdout[index + len(SENTINEL) :])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def to_plain(value: Any, depth: int = 0) -> Any:
    """`value`, reduced to what JSON can carry.

    A run's context holds dates, decimals and model instances; a script is
    given the readable shadow of those rather than the objects themselves —
    which is a capability decision as much as a serialisation one, since a
    model instance in scope is a database connection in scope.

    Depth is capped because a context can hold a cycle, and a stack overflow
    here would be a crash in the runtime rather than in the sandbox.
    """
    if depth > 8:
        return None
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(key): to_plain(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_plain(item, depth + 1) for item in value]
    return str(value)
