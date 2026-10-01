"""Node processes that were started before anybody asked for one.

Measured on this machine, with `bench_script_call.py` beside this note in the
report that introduced it: a script call cost **92 ms**, of which **70 ms** was
`node` starting up and another dozen was reaching the line in `host.mjs` that
reads stdin. The author's four lines of arithmetic were under a millisecond of
it. That number is why `apps/engine/hooks.py` has three hooks and not five, why
an expression batch is one call for a whole block rather than one per
placeholder, and why nothing in the runtime dares call the sandbox per step.

**What this does, and — more to the point — what it does not.**

It moves the launch off the caller's clock. A pooled worker is a process that
has been started, has registered its loader hook, has replaced `process` and
`console`, and is now blocked reading stdin. It has run no author code. It
*cannot* have run any: the request that would carry some has not arrived. When
one does, that worker gets it, answers it, and exits — `host.mjs` writes the
sentinel and calls `process.exit` on the next line, and nothing in this module
ever hands a process out twice.

So the sixth boundary in `sandbox.py` — «a separate process: whatever happens
in there, happens in there» — is not weakened, replaced or traded for the
speed. It is untouched. One script still gets one process, all six flags still
apply to it, its heap ceiling is still its own, and the stopwatch still kills
it. The only thing that changed is *when* the process was created, and a
process created earlier is the same process.

That distinction is the whole design, so it is worth saying what the other road
looked like. A **resident** pool — one worker answering many scripts, each in a
fresh `node:vm` context — would cost about 2 ms a call instead of 7. It would
also make the isolation of one tenant from the next depend on `node:vm`, which
Node's own documentation opens by saying is not a security mechanism. Today a
context escape buys an attacker nothing, because the process it lands in
contains one script and no capabilities; in a resident pool the same bug buys
them the next tenant's run — a global to plant, a prototype to patch, a
`setTimeout` to leave behind, an `Error.prepareStackTrace` to keep (`host.mjs`
notes that the author's module can already reach that one). Five milliseconds
is not worth owing that debt, and this arrangement collects thirteen fourteenths
of the available win without opening the account at all.

**Nothing here is required to work.** Every path out of `checkout` ends in a
process that has booted and is waiting for a request; the warm path just found
one lying ready. A pool that cannot spawn, a keeper thread that will not start,
a `SCRIPT_POOL_SIZE` of zero, a machine where the readiness handshake never
arrives — each falls through to spawning one on the spot, which is precisely
what this module replaced. It fails slow, never closed.

**What it costs when idle.** A booted worker is ~40 MB resident and no CPU. The
shelves are demand-driven: nothing is spawned until the first script of this
process's life is run, a shelf is retired once `WANT_SECONDS` pass with nothing
asked of it, and the keeper thread exits with the last shelf — so a deployment
that never runs a script holds nothing and runs nothing. At the defaults that
is at most `SCRIPT_POOL_SIZE` × `MAX_WARM_RECIPES` = four processes, ~160 MB,
on a box actively running scripts.

The size is a setting and the flags in `sandbox` are not, and the difference is
the same one `concurrency` draws: those flags are what a script may *reach*,
and a deployment that can weaken them from a config file has no sandbox, while
this is what a box can *afford* to hold warm, which only the box knows.
"""

from __future__ import annotations

import atexit
import logging
import os
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass

from django.conf import settings

logger = logging.getLogger(__name__)

#: What a booted worker writes to stderr to say it is waiting for a request.
#:
#: The mirror of `sandbox.SENTINEL`, and on the other stream on purpose: stdout
#: stays exactly what it was — the script's own printing, then one answer — so
#: `read_answer` never has to know this handshake happened.
READY = b"<<<OQIM-SCRIPT-READY>>>"

#: How many booted workers to hold per recipe. Two, because the point is to
#: have one ready for the *next* call while the current one is out, and a third
#: only helps a burst that the concurrency caps are already bounding.
DEFAULT_POOL_SIZE = 2

#: How many distinct recipes may be kept warm at once.
#:
#: A recipe is the whole argv, heap ceiling included, so this is also the answer
#: to "the limits differ per call". Nothing is resized and nothing is
#: approximated: a worker is only ever handed to a call that would have spawned
#: exactly that command line. In practice every caller in the product asks for
#: the default 64 MB, so there is one shelf; a call with a different ceiling
#: spawns cold the first time and warms its own shelf if it keeps coming.
MAX_WARM_RECIPES = 2

#: How long a recipe stays warm after the last call that used it. Long enough
#: to cover a quiet minute between two customers, short enough that a box which
#: has stopped running scripts stops holding processes.
WANT_SECONDS = 120

#: How long a freshly spawned worker gets to say it is ready.
#:
#: Ten times a boot on a badly loaded machine, and — the binding constraint —
#: small enough that this plus `REAP_TIMEOUT_S` still fits inside
#: `concurrency.LEASE_MARGIN_SECONDS`. That margin is the gap between a
#: script's own stopwatch firing and its slot's lease expiring, and `release`
#: deletes a slot by key without asking whose it is: a call that outlives its
#: lease hands back a slot that by then belongs to somebody else, and two
#: scripts share one. Waiting for a worker to boot is time the code this
#: replaced never spent, so it is time that has to be found inside the margin
#: rather than added to the end of it.
READY_TIMEOUT_S = 3

#: How long the keeper sleeps between passes when it has nothing to spawn.
KEEPER_INTERVAL_S = 5

#: How long a killed process gets to actually die before we stop waiting on it.
#: `kill` is `SIGKILL`, so this is a formality — but it is a formality inside
#: the same lease budget as `READY_TIMEOUT_S`, and the two are added together
#: in `test_script_pool.py` against `LEASE_MARGIN_SECONDS`.
REAP_TIMEOUT_S = 1


@dataclass
class Worker:
    """One booted process that has not been given a script yet.

    It stops being a `Worker` the moment `sandbox` writes a request into it:
    from there it is one script's process, it answers once, and it exits. There
    is deliberately no `release` on this class, because there is nothing a
    caller could give back.
    """

    process: subprocess.Popen
    #: Whatever it wrote to stderr before announcing itself. Normally empty;
    #: kept because `sandbox._no_answer` reads stderr to tell a heap exhaustion
    #: from a crash, and a line printed during boot is evidence too — losing it
    #: to the handshake would make the pool a place diagnostics go missing.
    notes: str = ""
    @property
    def alive(self) -> bool:
        return self.process.poll() is None


@dataclass
class _Recipe:
    """A command line worth keeping workers for, and until when."""

    command: tuple[str, ...]
    cwd: str
    env: dict[str, str]
    until: float = 0.0


_lock = threading.Lock()
_shelves: dict[tuple[str, ...], deque[Worker]] = {}
_recipes: dict[tuple[str, ...], _Recipe] = {}
_keeper: threading.Thread | None = None
_wake = threading.Event()
_generation = 0
_owner_pid = os.getpid()


def pool_size() -> int:
    """How deep a shelf may be. Zero turns pooling off and nothing else.

    Read on every call rather than at import, so the number lives in one place
    and `override_settings` in a test moves the real one — and read with a
    default, because a deployment that has never heard of this setting must
    still get the pool rather than a crash on the first script it runs.
    """
    try:
        size = int(getattr(settings, "SCRIPT_POOL_SIZE", DEFAULT_POOL_SIZE))
    except (TypeError, ValueError):
        return DEFAULT_POOL_SIZE
    return max(0, size)


def shelved(command: tuple[str, ...] | None = None) -> list[Worker]:
    """What is warm right now — everything, or one recipe's shelf.

    A snapshot and a copy, so a caller reading it cannot be tripped by the
    keeper filling a shelf underneath them. It exists for the tests and for
    whoever is one day looking at a box wondering what those `node` processes
    are, which is the same question.
    """
    with _lock:
        if command is not None:
            return list(_shelves.get(command, ()))
        return [worker for shelf in _shelves.values() for worker in shelf]


def checkout(command: tuple[str, ...], *, cwd: str, env: dict[str, str]) -> Worker:
    """A booted process running `command`, ready to be handed one script.

    Warm when the shelf had one, spawned here when it did not — and the caller
    cannot tell the difference, because there is none: both have run the same
    boot and neither has seen a line of anybody's code.

    Raises `OSError` only where `subprocess.Popen` would today: a `node` that
    will not start, or one that starts and never speaks. `sandbox` already
    answers that with «Skript muhitini ishga tushirib bo'lmadi».
    """
    _adopt()
    warm = None
    try:
        _want(command, cwd, env)
        warm = _take(command)
    except Exception:  # noqa: BLE001 - a broken pool is a slow call, never a failed one
        logger.warning("script pool unusable — spawning cold", exc_info=True)
    return warm if warm is not None else _start(command, cwd, env)


def retire_all() -> None:
    """Kill every warm worker and stop the keeper.

    Registered at exit so a `manage.py test` run, a `runserver` reload or a
    Celery worker shutting down leaves no `node` behind. Safe to call twice and
    safe to call from a test: the next `checkout` starts the whole thing again
    from nothing.
    """
    global _keeper, _generation

    with _lock:
        _generation += 1
        shelves = list(_shelves.values())
        _shelves.clear()
        _recipes.clear()
        keeper, _keeper = _keeper, None
    _wake.set()

    for shelf in shelves:
        for worker in shelf:
            _retire(worker.process)
    if keeper is not None and keeper is not threading.current_thread():
        # Short, and not fatal if it lapses: the keeper is a daemon thread, it
        # checks the generation before shelving anything, and anything it does
        # shelve past this point is retired by the check in `_shelve`.
        keeper.join(timeout=REAP_TIMEOUT_S)


atexit.register(retire_all)


def _adopt() -> None:
    """Forget everything inherited across a `fork`.

    Celery's prefork pool and gunicorn both fork after Django has loaded, and a
    forked child inherits this module's dictionaries — pipes and all — without
    inheriting the right to wait on those processes: they are the parent's
    children, not its own. Killing them here would kill workers the parent is
    about to use, so the child closes its copies of the pipes and forgets them.
    """
    global _owner_pid, _keeper

    if os.getpid() == _owner_pid:
        return
    with _lock:
        if os.getpid() == _owner_pid:  # pragma: no cover - another thread won
            return
        _owner_pid = os.getpid()
        # The keeper thread does not survive `fork` either — only the calling
        # thread does — so the handle is stale rather than joinable.
        _keeper = None
        stale = [worker for shelf in _shelves.values() for worker in shelf]
        _shelves.clear()
        _recipes.clear()
    for worker in stale:
        close(worker.process)


def _want(command: tuple[str, ...], cwd: str, env: dict[str, str]) -> None:
    """Note that this recipe is in use, and make sure somebody is filling it."""
    global _keeper

    if not pool_size():
        return
    with _lock:
        recipe = _recipes.pop(command, None) or _Recipe(command=command, cwd=cwd, env=dict(env))
        recipe.until = time.monotonic() + WANT_SECONDS
        # Re-inserted at the end, so the dictionary's own order is a
        # least-recently-used list and the eviction below needs no bookkeeping.
        _recipes[command] = recipe
        while len(_recipes) > MAX_WARM_RECIPES:
            evicted = next(iter(_recipes))
            del _recipes[evicted]
            # Its shelf is left for the keeper's next pass rather than killed
            # under the lock; `_retire_stale` is where processes die.
        if _keeper is None:
            _keeper = threading.Thread(target=_keep, name="oqim-script-pool", daemon=True)
            _keeper.start()
    _wake.set()


def _take(command: tuple[str, ...]) -> Worker | None:
    """A live warm worker for `command`, or None.

    Dead ones are dropped on the way past. A warm worker can die where nobody
    was watching — the operating system's own memory killer, an operator's
    `pkill node` — and handing one out would turn that into a broken script for
    whoever asked next.
    """
    while True:
        with _lock:
            shelf = _shelves.get(command)
            if not shelf:
                return None
            worker = shelf.popleft()
        if worker.alive:
            _wake.set()  # one gone; ask for a replacement
            return worker
        close(worker.process)


def _start(command: tuple[str, ...], cwd: str, env: dict[str, str]) -> Worker:
    """Spawn one and wait for it to say it is ready.

    The cold path, and also every path on a deployment where pooling is off.
    Waiting for the handshake here rather than only in the keeper is what makes
    the two paths the same thing: a cold worker and a warm one are handed to
    `sandbox` in identical states, so there is one behaviour to reason about
    and one set of stderr notes to carry.
    """
    process = subprocess.Popen(  # noqa: S603 - the command is built in `sandbox`, from constants
        list(command),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        cwd=cwd,
    )
    return _await_ready(process)


def _await_ready(process: subprocess.Popen) -> Worker:
    """Block until the worker announces itself, dies, or runs out of patience.

    Death is *not* an error here. A `host.mjs` that cannot compile, a `node`
    that refuses its own flags — those exit at once with something on stderr,
    and the honest thing is to hand the corpse to `sandbox` and let
    `_no_answer` report it exactly as it did before this module existed. Only
    silence is fatal, and only after `READY_TIMEOUT_S`.

    Read with `os.read` on the raw descriptor rather than `readline`, because
    `Popen.communicate` reads the descriptor the same way: a `TextIOWrapper`
    that buffered ahead of the marker would be holding bytes that
    `communicate` then never sees.
    """
    seen = bytearray()
    fd = process.stderr.fileno()

    def listen() -> None:
        while READY not in seen:
            try:
                chunk = os.read(fd, 4096)
            except OSError:  # pragma: no cover - the pipe closed under us
                return
            if not chunk:  # EOF: it died before it was ready
                return
            seen.extend(chunk)
            if len(seen) > 16384:  # a worker shouting at boot is not a reason to grow
                return

    listener = threading.Thread(target=listen, name="oqim-script-ready", daemon=True)
    listener.start()
    listener.join(READY_TIMEOUT_S)
    if listener.is_alive():
        # Alive, silent, and past its budget. Killing it closes the pipe, which
        # is also what lets the listener thread finish and go away.
        _retire(process)
        raise OSError("script worker never became ready")

    notes = bytes(seen).replace(READY, b"").decode("utf-8", "replace")
    return Worker(process=process, notes=notes)


def _keep() -> None:
    """Fill the shelves, retire what nobody wants, and go away when idle.

    One thread for the whole pool. It is the only place a warm worker is
    spawned, so the request path never waits on more than the one process it
    is about to use.
    """
    global _keeper

    while True:
        try:
            _retire_stale()
            if _fill_one():
                continue  # keep going until every shelf is at depth
        except Exception:  # noqa: BLE001 - the pool is an optimisation; it may not take the process down
            logger.warning("script pool keeper failed a pass", exc_info=True)

        with _lock:
            if not _recipes and not any(_shelves.values()):
                # Nothing wanted and nothing held: stop, and let the next
                # `_want` start a fresh one. Both halves of this decision are
                # inside the lock that `_want` takes, which is what stops a
                # thread from exiting past a caller that has just asked for it.
                _keeper = None
                return
        _wake.wait(KEEPER_INTERVAL_S)
        _wake.clear()


def _fill_one() -> bool:
    """Spawn one worker for whichever shelf is short, or answer False.

    One at a time, checking the world again between each, so a `retire_all` or
    an eviction does not have to wait out a batch.
    """
    size = pool_size()
    with _lock:
        recipe = next(
            (
                candidate
                for candidate in _recipes.values()
                if len(_shelves.get(candidate.command, ())) < size
            ),
            None,
        )
        generation = _generation
    if recipe is None:
        return False

    try:
        worker = _start(recipe.command, recipe.cwd, recipe.env)
    except (OSError, ValueError):
        # A machine that cannot spawn one is a machine that will answer every
        # call cold. Say so once per pass and let the interval slow us down.
        logger.warning("script pool could not warm a worker", exc_info=True)
        return False
    _shelve(recipe.command, worker, generation)
    return True


def _shelve(command: tuple[str, ...], worker: Worker, generation: int) -> None:
    """Put a newly booted worker on its shelf, unless the world moved."""
    with _lock:
        stale = (
            generation != _generation
            or command not in _recipes
            or len(_shelves.setdefault(command, deque())) >= pool_size()
        )
        if not stale:
            _shelves[command].append(worker)
    if stale:
        # Spawned into a pool that no longer wants it — `retire_all` ran, or the
        # recipe was evicted while this one was booting. It has run no code and
        # never will.
        _retire(worker.process)


def _retire_stale() -> None:
    """Kill the workers on shelves nobody has asked for lately."""
    cutoff = time.monotonic()
    doomed: list[Worker] = []
    with _lock:
        for command in list(_recipes):
            if _recipes[command].until <= cutoff:
                del _recipes[command]
        for command in list(_shelves):
            if command not in _recipes:
                doomed.extend(_shelves.pop(command))
                continue
            live = deque(worker for worker in _shelves[command] if worker.alive)
            doomed.extend(worker for worker in _shelves[command] if not worker.alive)
            _shelves[command] = live
    for worker in doomed:
        _retire(worker.process)


def _retire(process: subprocess.Popen) -> None:
    """Kill one worker and reap it. Never raises — this is cleanup."""
    try:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=REAP_TIMEOUT_S)
    except Exception:  # noqa: BLE001
        logger.warning("script worker would not die", exc_info=True)
    finally:
        close(process)


def close(process: subprocess.Popen) -> None:
    """Let go of the three pipes, without touching the process itself.

    Public because `sandbox` needs it too, and split from `_retire` because
    `_adopt` needs exactly this half: a forked child holds copies of
    descriptors it must release and children it must not kill. Closing a pipe
    that `communicate` already closed is a no-op, which is what lets it be
    called from a `finally` on every path.
    """
    for pipe in (process.stdin, process.stdout, process.stderr):
        try:
            if pipe is not None:
                pipe.close()
        except Exception:  # noqa: BLE001 - a descriptor that is already gone
            pass
