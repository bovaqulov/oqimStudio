"""The pool in front of the sandbox, and the boundary it was built not to spend.

`test_script_sandbox.py` is the statement of the six boundaries. This file is
about the sixth of them — «a separate process: whatever happens in there,
happens in there» — because a pool is normally the thing that ends it. Reusing
a process is how a pool gets its speed, and a reused process is one that
carries a tenant's globals, prototype patches, timers and retained memory into
the next tenant's run.

So the arrangement being tested is the other one: what `pool.py` holds is
processes that have *booted* and have not been given a script, and a process
that has been given one answers it and exits. Every worker still runs exactly
one script. Half the tests below are therefore not about the pool working —
they are about the boundary still being where `sandbox.py` says it is, written
here rather than in the security file because they are statements about this
module, and because that file may not be edited to accommodate anything.

The other half is the pool's own failure surface, which is new: a worker that
died on the shelf, a runaway killed inside a process the pool once owned, a
machine that cannot spawn, a lease this must not outlive.

Timings are asserted only as ratios against a launch measured in the same test,
never as absolute milliseconds — this suite runs on whatever box it is given,
usually while several other things are running on it.
"""

import shutil
import subprocess
import sys
import threading
import time
from unittest import mock, skipUnless

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.engine.script import ScriptLimits, acquire, is_available, lease_seconds, release, run_script
from apps.engine.script import pool
from apps.engine.script.concurrency import LEASE_MARGIN_SECONDS

from .base import *  # noqa: F401,F403

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

#: How long a test will wait for the keeper thread to fill a shelf. Long, and
#: never actually spent: the wait ends the moment the shelf is full.
SETTLE_S = 15


class PoolTestCase(TestCase):
    """Every test here starts with an empty pool and leaves one behind.

    The shelves outlive a test method the way the cache does, and a warm worker
    left over from the test before would make a cold measurement look warm and
    a "never handed out twice" assertion look true for the wrong reason.
    """

    def setUp(self) -> None:
        cache.clear()
        pool.retire_all()
        self.addCleanup(pool.retire_all)

    def warm_up(self) -> None:
        """Run one script — which is what asks the pool to exist — and wait."""
        self.assertTrue(run_script("return 1;").ok)
        self.settle()

    def settle(self, least: int | None = None) -> None:
        """Block until the shelf is full — or holds `least`, when that is less.

        A full shelf and not merely a stocked one, because a test that makes
        two calls against one warm worker is measuring a warm call and a cold
        one and calling the average a result.
        """
        least = pool.pool_size() if least is None else least
        deadline = time.monotonic() + SETTLE_S
        while time.monotonic() < deadline:
            if len(pool.shelved()) >= least:
                return
            time.sleep(0.02)
        self.fail(f"pool never warmed up: {len(pool.shelved())} shelved, wanted {least}")

    def handed_out(self) -> list:
        """Records the process behind every `checkout` while it is patched in."""
        given: list = []
        real = pool.checkout

        def spy(*args, **kwargs):
            worker = real(*args, **kwargs)
            given.append(worker.process)
            return worker

        patch = mock.patch.object(pool, "checkout", spy)
        patch.start()
        self.addCleanup(patch.stop)
        return given


@SCRIPTS
class PoolCostTests(PoolTestCase):
    """The claim this whole thing is for: a call stops costing a launch."""

    def test_two_pooled_calls_cost_less_than_one_cold_launch(self):
        """Measured against `node` starting up and doing nothing at all.

        A ratio rather than a number of milliseconds, because a launch and a
        pooled call scale together on a loaded box and only their ratio is a
        fact about this change. Before it, two calls cost at least two launches
        by construction — there was no way to make a call without one.
        """
        node = shutil.which("node")
        launch = min(
            self.time_of(lambda: subprocess.run([node, "-e", ""], capture_output=True))
            for _ in range(3)
        )
        self.warm_up()

        two = self.time_of(lambda: (run_script("return 1;"), run_script("return 2;")))

        self.assertLess(
            two,
            launch,
            f"two pooled calls took {two:.0f} ms and one bare `node` launch takes {launch:.0f} ms",
        )

    def test_the_first_call_of_a_process_is_the_one_that_pays(self):
        """Nothing is spawned speculatively.

        A deployment that never runs a script must never hold a `node`, so the
        shelves are demand-driven: the pool learns which command line to keep
        warm from the first call that uses one.
        """
        self.assertEqual(pool.shelved(), [], "an untouched process holds nothing")

        self.assertTrue(run_script("return 1;").ok)
        self.settle()

        self.assertGreaterEqual(len(pool.shelved()), 1)

    @override_settings(SCRIPT_POOL_SIZE=0)
    def test_a_deployment_with_pooling_switched_off_still_answers(self):
        """The fallback is the code that was here before, and it is one setting
        away — a box that cannot afford idle processes gets slow calls, never
        no calls."""
        self.assertEqual(run_script("return 40 + 2;").value, 42)

        self.assertEqual(pool.shelved(), [], "nothing was kept warm")

    def time_of(self, work) -> float:
        started = time.monotonic()
        work()
        return (time.monotonic() - started) * 1000


@SCRIPTS
class PoolIsolationTests(PoolTestCase):
    """The sixth boundary, restated for a world with a pool in it.

    Each of these would pass on the code this replaced, and that is the point:
    they are here so that the *next* change — a resident worker, a `vm` context
    per run, anything that answers two scripts in one process — cannot be made
    without one of them going red.
    """

    def test_a_worker_is_never_handed_out_twice(self):
        """The mechanism under every other test in this class.

        Reuse is what a pool normally is, and the reason this one is not: two
        calls are two processes, and each is finished with by the time its
        answer is read.
        """
        given = self.handed_out()
        self.warm_up()

        run_script("return 1;")
        run_script("return 2;")

        self.assertEqual(len({process.pid for process in given}), len(given), "no pid twice")
        for process in given:
            self.assertIsNotNone(process.poll(), "each worker exited with its own script")

    def test_a_global_one_script_sets_is_invisible_to_the_next(self):
        self.warm_up()
        self.assertTrue(run_script("globalThis.qoldiq = 'meniki'; return 1;").ok)

        second = run_script("return globalThis.qoldiq ?? null;")

        self.assertTrue(second.ok, second.error)
        self.assertIsNone(second.value, "it ran, and it found nothing left behind")

    def test_a_patched_prototype_does_not_outlive_its_script(self):
        """`host.mjs` captures what it needs so a script cannot garble its own
        answer. Nothing captures anything on behalf of the *next* script, and
        nothing has to: the realm it ran in is gone."""
        self.warm_up()
        self.assertTrue(run_script("Array.prototype.map = () => ['buzildi']; return 1;").ok)

        self.assertEqual(run_script("return [1, 2].map((n) => n * 2);").value, [2, 4])

    def test_a_timer_left_running_cannot_reach_the_next_script(self):
        self.warm_up()
        self.assertTrue(run_script("setInterval(() => { globalThis.tegdi = 1; }, 1); return 1;").ok)
        time.sleep(0.1)

        second = run_script("return globalThis.tegdi ?? null;")

        self.assertTrue(second.ok, second.error)
        self.assertIsNone(second.value, "the timer's realm ended with the script that made it")

    def test_a_rewritten_prepare_stack_trace_does_not_follow_the_next_author(self):
        """`host.mjs::faultLine` reads a line off `error.stack`, and notes that
        the author's module shares the realm and can rewrite how that is built.
        It costs them a line number in their own run; it must not cost the next
        author theirs."""
        self.warm_up()
        run_script("Error.prepareStackTrace = () => 'yolg\\'on'; throw new Error('birinchi');")

        result = run_script("const a = 1;\nthrow new Error('shu yerda');")

        self.assertEqual(result.line, 2)

    def test_a_script_that_times_out_does_not_touch_one_running_beside_it(self):
        """The kill is the thing a pool makes dangerous.

        Killing a *dedicated* process ends one script. Killing a *pooled* one
        would end whatever else was in it — which on a shared box is another
        tenant's conversation, stopped by a loop they did not write. One script
        per process is what makes the kill precise, and this is the test that
        says so.
        """
        self.warm_up()
        answers: dict[str, object] = {}

        def alongside():
            answers["alongside"] = run_script(
                "await new Promise((done) => setTimeout(done, 1500)); return 'tugadi';",
                limits=ScriptLimits(timeout_ms=9000),
                workspace_id="ws-tinch",
            )

        def runaway():
            answers["runaway"] = run_script(
                "while (true) {}",
                limits=ScriptLimits(timeout_ms=700),
                workspace_id="ws-shovqin",
            )

        threads = [threading.Thread(target=alongside), threading.Thread(target=runaway)]
        threads[0].start()
        time.sleep(0.2)  # the neighbour is well inside its own script by now
        threads[1].start()
        for thread in threads:
            thread.join(timeout=30)

        self.assertEqual(answers["runaway"].kind, "timeout")
        self.assertTrue(answers["alongside"].ok, answers["alongside"].error)
        self.assertEqual(answers["alongside"].value, "tugadi")


@SCRIPTS
class PoolFailureTests(PoolTestCase):
    """A worker that dies, hangs or was never born.

    All of it ends the same way: a process nobody kept, and a caller that still
    gets an answer. The pool is an optimisation and is never allowed to become
    a reason a script did not run.
    """

    def test_a_worker_that_died_on_the_shelf_is_not_handed_out(self):
        """Warm workers sit idle for minutes, which is long enough for the
        operating system's memory killer or somebody's `pkill node` to reach
        one. Handing out the corpse would turn that into a broken script for
        whoever asked next, and they would have no way to tell."""
        self.warm_up()
        for worker in pool.shelved():
            worker.process.kill()
            worker.process.wait(timeout=5)

        self.assertEqual(run_script("return 40 + 2;").value, 42)

    def test_a_timed_out_worker_is_actually_killed(self):
        """`subprocess.run` used to do this inside itself, and the pool took
        that away by handing out a `Popen`. A runaway loop that is merely
        abandoned keeps a core busy for the life of the deployment."""
        given = self.handed_out()
        self.warm_up()

        result = run_script("while (true) {}", limits=ScriptLimits(timeout_ms=700))

        self.assertEqual(result.kind, "timeout")
        self.assertIsNotNone(given[-1].poll(), "the runaway process is gone, not just let go of")

    def test_a_kill_leaves_the_pool_able_to_serve_the_next_call(self):
        self.warm_up()
        self.assertEqual(
            run_script("while (true) {}", limits=ScriptLimits(timeout_ms=700)).kind, "timeout"
        )

        self.assertEqual(run_script("return 40 + 2;").value, 42)
        self.settle()

    def test_a_pool_that_throws_is_a_slow_call_and_not_a_failed_one(self):
        """Every path out of `checkout` has to end in a booted process. A bug
        in the shelf bookkeeping is allowed to cost the launch it was saving;
        it is not allowed to cost the answer."""
        with mock.patch.object(pool, "_take", side_effect=RuntimeError("javon buzildi")):
            with self.assertLogs("apps.engine.script.pool", "WARNING"):
                result = run_script("return 40 + 2;")

        self.assertEqual(result.value, 42)

    @override_settings(SCRIPT_POOL_SIZE=0)
    def test_a_worker_that_never_says_it_is_ready_is_killed_rather_than_waited_on(self):
        """A `node` that starts and then wedges would otherwise hold the caller
        for as long as it liked — with a concurrency slot in its hand."""
        with mock.patch.object(pool, "READY_TIMEOUT_S", 0.3):
            with mock.patch.object(pool, "_retire", wraps=pool._retire) as retired:
                started = time.monotonic()
                with self.assertRaises(OSError):
                    pool.checkout(
                        (sys.executable, "-c", "import time; time.sleep(30)"),
                        cwd=".",
                        env={},
                    )

        self.assertLess(time.monotonic() - started, 5, "it did not wait for the process")
        self.assertTrue(retired.called, "and it did not leave it running either")

    def test_a_wedged_worker_is_reported_as_a_sandbox_that_will_not_start(self):
        """Which is the sentence `run_script` already had for a broken install
        — and, as ever, a value rather than an exception."""
        with mock.patch.object(pool, "checkout", side_effect=OSError("node yo'q")):
            result = run_script("return 1;")

        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "unavailable")

    def test_nothing_is_left_running_when_the_pool_is_retired(self):
        """Registered at exit, so a `manage.py test`, a `runserver` reload or a
        Celery worker shutting down leaves no `node` on the box."""
        self.warm_up()
        processes = [worker.process for worker in pool.shelved()]
        self.assertGreaterEqual(len(processes), 1)

        pool.retire_all()

        self.assertEqual(pool.shelved(), [])
        for process in processes:
            self.assertIsNotNone(process.poll(), "a retired worker is a dead worker")


@SCRIPTS
class PoolSlotTests(PoolTestCase):
    """The accounting in `concurrency`, which this change must not disturb.

    A slot is a key with a lease, and `release` deletes it by name without
    asking whose it is. That is safe only while a call cannot outlive its own
    lease — which is a property the pool can break in a way the code it
    replaced could not, because waiting for a worker to boot is time that was
    never spent before.
    """

    def test_the_pool_cannot_hold_a_slot_past_its_lease(self):
        """The arithmetic, asserted rather than commented.

        `LEASE_MARGIN_SECONDS` is the whole gap between a script's stopwatch
        firing and its slot coming back on its own. Everything the pool adds
        around the script — waiting for a worker to boot, waiting for a killed
        one to die — has to fit inside it, or a call hands back a slot that by
        then belongs to somebody else and two scripts share one.
        """
        self.assertLess(pool.READY_TIMEOUT_S + pool.REAP_TIMEOUT_S, LEASE_MARGIN_SECONDS)

    def test_a_timed_out_call_comes_back_inside_its_own_lease(self):
        """The same fact, measured on a real runaway rather than on constants."""
        started = time.monotonic()

        result = run_script(
            "while (true) {}", limits=ScriptLimits(timeout_ms=700), workspace_id="ws1"
        )

        self.assertEqual(result.kind, "timeout")
        self.assertLess(time.monotonic() - started, lease_seconds(700))

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_warming_a_shelf_spends_no_slot(self):
        """An idle worker is not a running script and must not be counted as
        one. A pool that took a slot per warm process would hold the host's
        whole ceiling while nothing at all was happening — the cap would read
        as full on a box that is asleep."""
        self.warm_up()
        self.assertGreaterEqual(len(pool.shelved()), 1)

        self.assertTrue(run_script("return 1;", workspace_id="ws1").ok)

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_a_pooled_call_gives_its_slot_back_however_it_ends(self):
        """One slot for the host and one for the tenant, and at a ceiling of
        one there is no room to lose either."""
        for source, note in (
            ("return 1;", "answered"),
            ("throw new Error('narx topilmadi');", "threw"),
            ("while (true) {}", "was killed"),
            ("return (((", "would not compile"),
        ):
            with self.subTest(note=note):
                run_script(source, limits=ScriptLimits(timeout_ms=700), workspace_id="ws1")

                lease = acquire("ws1", ttl_seconds=7)
                self.assertTrue(lease.granted, f"the slot did not come back after a script that {note}")
                release(lease)
