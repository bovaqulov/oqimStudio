"""How many scripts may run at once, and whose they are.

The six boundaries in `sandbox` are each *per script*: one process, one heap,
one stopwatch. None of them says anything about the second script, or the
hundredth. A block that costs a Node process and two seconds of a core is
cheap once and is the whole machine at forty — and the machine is shared, so
the tenant who pays for it is not the tenant who spent it.

Two ceilings, because they answer two different questions:

  the **host** cap    what this deployment may be asked to spend at once. A
                      script is a Node process: its own baseline plus the 64 MB
                      heap `ScriptLimits` allows is on the order of 100 MB
                      resident, and a script that is running is a core that is
                      not answering anything else.
  the **workspace**   what any one tenant may take of that. The host cap alone
  cap                 buys no fairness at all — it buys a queue, and the
                      busiest tenant wins a queue every time. This is the half
                      that stops a script block in one workspace's hot flow
                      from starving every other workspace on the box.

**What a slot bounds, exactly.** One numbered key in the Django cache — Redis
in production, shared by Daphne and by every Celery worker that talks to it. So
the host cap bounds *the deployment reaching that Redis*, not one process and
not one worker. Under `manage.py test` and on a laptop the cache is
`LocMemCache` and the same code bounds one process, which is all there is to
bound there. What it deliberately is *not* is an in-process semaphore: Celery
defaults its concurrency to the CPU count, so a semaphore of eight would be
eight per worker — a hundred and twenty-eight on a sixteen-core box, and a
number that reads in a log exactly like a cap that works.

**A slot that is never given back.** Every slot is its own key with its own
expiry, and that shape is the whole reason this is not a counter. A counter
incremented and decremented is a counter that a `SIGKILL` between the two
leaves permanently short, and no TTL repairs it: refreshing the counter's
expiry on each claim means a busy host never expires it, and letting it lapse
wholesale hands every slot back at once while the scripts holding them are
still running. A numbered key expires alone — a worker killed mid-script leaves
slot 3 held, and slot 3 comes back by itself once the lease runs out, with
nobody told and nothing to clean up.

Nothing is renewed while a script runs, and nothing needs to be: `sandbox`
kills the subprocess at `limits.timeout_ms`, so the lease is longer than the
thing it covers by construction (`lease_seconds`).

**What the second ceiling costs.** Measured against a Redis on the same
machine: taking and giving back both slots is ~1.05 ms and the workspace half
of that is ~0.39 ms, against ~92 ms to spawn the Node process it is about to
spawn. Four tenths of one percent — which is what makes fairness worth having
here rather than an optimisation to argue about, and is also why the workspace
key is one `add` and not an index that has to be kept.

**Nothing here raises, and nothing here fails closed.** A cache that cannot be
reached lets the script run. This is a capacity limit and not one of the six
boundaries — a script refused here reaches nothing it would otherwise have
reached — so turning a Redis blip into "no bot in the product can do
arithmetic" would be spending an outage to protect a machine that is not under
load. The warning in the log is how anybody finds out the cap is off.

The numbers live in settings, unlike the flags in `sandbox`, and the
difference is worth stating because the two modules sit side by side: those
flags are what a script may *reach* and a deployment that can weaken them from
a config file has no sandbox, while these are what a box can *afford*, which
only the box knows.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import random
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

#: Which ceiling refused. Carried on the lease so the caller can say which.
HOST = "host"
WORKSPACE = "workspace"

#: What the author reads. Both say the same two things — it is not your code,
#: and it will work in a moment — because those are the only two facts they can
#: act on. Which ceiling was hit is in the log, where it belongs: a tenant
#: cannot do anything about the host being busy, and telling them the number
#: would only invite them to ask for it to be raised.
REFUSALS = {
    HOST: "Server hozir band — bir vaqtning o'zida juda ko'p skript ishlayapti. "
    "Bir necha soniyadan so'ng qayta urinib ko'ring.",
    WORKSPACE: "Bu ish maydonida bir vaqtning o'zida juda ko'p skript ishlayapti. "
    "Bir necha soniyadan so'ng qayta urinib ko'ring.",
}

#: All of this module's keys start here, so a deployment can see what it holds
#: (`SCAN MATCH oqim:script:slot:*`) and drop the lot after an incident.
KEY_PREFIX = "oqim:script:slot:"
HOST_PREFIX = f"{KEY_PREFIX}host:"

#: How far a lease outlives the script it covers.
#:
#: The lease has to be longer than the script's own wall clock or it could
#: expire underneath a process that is still running, which would let the host
#: quietly exceed its cap. It has to be short or a killed worker's slot stays
#: out of circulation. Five seconds is the gap between "the stopwatch fired"
#: and "the subprocess is reaped and the key deleted" on a box healthy enough
#: to be worth protecting — and it is also the margin that keeps `release` from
#: deleting somebody else's slot (see there).
LEASE_MARGIN_SECONDS = 5


def lease_seconds(timeout_ms: int) -> int:
    """How long one slot is held before it comes back on its own."""
    return math.ceil(timeout_ms / 1000) + LEASE_MARGIN_SECONDS


@dataclass(frozen=True)
class Lease:
    """The slots one script holds, or the ceiling that had none left."""

    #: The keys to give back when the script is done. Empty on a refusal — and
    #: also empty when the cache could not be reached, where the script runs
    #: uncounted and there is nothing to release.
    keys: tuple[str, ...] = ()
    #: `HOST`, `WORKSPACE`, or "" when the script may run.
    refused: str = ""

    @property
    def granted(self) -> bool:
        return not self.refused

    @property
    def reason(self) -> str:
        """The sentence an author reads. Empty when nothing was refused."""
        return REFUSALS.get(self.refused, "")


@contextmanager
def slot(workspace_id: str | None = None, *, ttl_seconds: int) -> Iterator[Lease]:
    """Holds a slot for the body, and gives it back however the body ends.

    A refusal is yielded rather than raised, and the body decides: a caller
    that must not throw into the runtime cannot be handed an exception, and
    `sandbox` is exactly that caller.
    """
    lease = acquire(workspace_id, ttl_seconds=ttl_seconds)
    try:
        yield lease
    finally:
        release(lease)


def acquire(workspace_id: str | None, *, ttl_seconds: int) -> Lease:
    """Claims a slot for one script, or says which ceiling is full.

    `workspace_id` is optional and its absence means something specific: a
    caller with no tenant to charge — a management command, a test — takes a
    host slot only. It is not a way for a request to opt out, because the two
    call sites that serve tenants both know their workspace.
    """
    try:
        return _acquire(workspace_id, ttl_seconds)
    except Exception:  # noqa: BLE001 - the cache is the only thing that can fail here
        # Fail open, loudly. A script that cannot be counted still has to run
        # (see the module docstring); the warning is the only way anybody
        # learns that the cap stopped applying. A slot claimed just before the
        # failure is left to its own expiry rather than chased.
        logger.warning("script slots unavailable — running uncapped", exc_info=True)
        return Lease()


def release(lease: Lease) -> None:
    """Gives back whatever `lease` actually holds.

    Safe on a refusal and safe twice: deleting a key that is not there is a
    no-op. The case worth naming is the one that would be a bug — a lease whose
    TTL already ran out is a slot somebody else may now hold, and deleting it
    would release a script that is still running. `LEASE_MARGIN_SECONDS` is
    what makes that impossible: a holder cannot reach this line more than five
    seconds after its own stopwatch fired without the whole box being wedged.
    Checking the value before deleting would need a compare-and-delete the
    Django cache API cannot express, and a Lua script for a race that needs a
    five-second stall is machinery bought too early.
    """
    if not lease.keys:
        return
    try:
        cache.delete_many(list(lease.keys))
    except Exception:  # noqa: BLE001 - a slot left to expire is the tolerable half of this
        logger.warning("script slot could not be released — leaving it to expire", exc_info=True)


def _acquire(workspace_id: str | None, ttl_seconds: int) -> Lease:
    held: list[str] = []

    if workspace_id:
        # Read here rather than at import, so a number is one place and
        # `override_settings` in a test moves the real one.
        limit = settings.SCRIPT_MAX_CONCURRENT_PER_WORKSPACE
        # The tenant's own ceiling is tested first, and the order is not
        # arbitrary: a workspace already at its limit is refused without
        # touching the shared keys at all, so the traffic this exists to
        # contain is also the traffic that stops costing the host anything.
        key = _claim(_workspace_prefix(workspace_id), limit, ttl_seconds)
        if key is None:
            logger.info("script refused: workspace %s is already running %s", workspace_id, limit)
            return Lease(refused=WORKSPACE)
        held.append(key)

    key = _claim(HOST_PREFIX, settings.SCRIPT_MAX_CONCURRENT, ttl_seconds)
    if key is None:
        # The workspace slot is handed back now rather than left to expire.
        # The tenant did nothing wrong, and holding a slice of their ceiling
        # for the next several seconds would turn a busy host into one
        # workspace's outage.
        release(Lease(keys=tuple(held)))
        logger.info("script refused: the host is already running its maximum")
        return Lease(refused=HOST)
    held.append(key)

    return Lease(keys=tuple(held))


def _claim(prefix: str, limit: int, ttl_seconds: int) -> str | None:
    """The first free slot under `prefix`, or None when every one is taken.

    `cache.add` is the entire mechanism: it writes only if the key is absent,
    which on Redis is a single `SET NX EX` — one round trip that tests and
    takes the slot together, so two workers racing for the last one cannot both
    come away holding it.

    The walk starts at a random offset. Callers all probing 0, 1, 2… would
    queue behind slot 0 and spend a round trip per collision to learn what the
    caller ahead of them already knew; spread out, the first probe usually
    lands while the host has room at all. Worst case is `limit` round trips to
    a Redis on the same network — noise beside spawning the Node process this
    is about to spawn.
    """
    if limit <= 0:
        return None
    start = random.randrange(limit)
    for step in range(limit):
        key = f"{prefix}{(start + step) % limit}"
        # The pid is written rather than a `1` so that a slot nobody released
        # can be traced back to the process that held it. Nothing reads it.
        if cache.add(key, os.getpid(), timeout=ttl_seconds):
            return key
    return None


def _workspace_prefix(workspace_id: str) -> str:
    """`workspace_id`, as something a cache key may safely contain.

    Digested rather than interpolated. Django validates every key against
    memcached's grammar whatever the backend is, and that grammar refuses
    spaces and control characters, while a workspace id is a `CharField` —
    readable handles today, and the schema promises nothing about tomorrow.
    Stripping the offending characters instead would let two ids collapse onto
    one key, and two tenants sharing one ceiling is the exact failure this
    module exists to prevent.
    """
    digest = hashlib.blake2s(workspace_id.encode("utf-8"), digest_size=8).hexdigest()
    return f"{KEY_PREFIX}ws:{digest}:"
