"""How many scripts may run at once, and what happens to the ones that may not.

Apart from `test_script.py` because the subject is different: that file asks
what one script does, and every test here is about the *second* one — the slot
it takes, the tenant it is charged to, and what becomes of a slot whose holder
never comes back.

Two of these are worth reading as statements rather than as tests. That a slot
is a key in the shared cache is the difference between a cap on the deployment
and a cap on one Celery worker of sixteen; that a slot nobody releases expires
on its own is the difference between a worker being killed and a slot being
lost until somebody notices.
"""

import time
from unittest import mock, skipUnless

from django.core.cache import cache
from django.test import TestCase, override_settings

from apps.engine.script import ScriptLimits, acquire, is_available, lease_seconds, release, run_script
from apps.engine.script.concurrency import HOST, LEASE_MARGIN_SECONDS, WORKSPACE

from .base import *  # noqa: F401,F403

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")


class SlotTests(TestCase):
    """The lease itself, without a script under it."""

    def setUp(self) -> None:
        # Slots live in the cache, which outlives a test method.
        cache.clear()

    def test_a_slot_is_a_key_in_the_shared_cache_and_not_a_semaphore(self):
        """What the cap bounds follows from where the count is kept.

        Celery defaults its concurrency to the CPU count, so an in-process
        semaphore of eight would be eight per worker — and would read in a log
        exactly like a cap that works.
        """
        lease = acquire("ws1", ttl_seconds=7)

        self.assertEqual(len(lease.keys), 2, "one slot for the tenant, one for the host")
        for key in lease.keys:
            self.assertIsNotNone(cache.get(key))

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=4)
    def test_a_released_slot_is_free_again_at_once(self):
        first = acquire("ws1", ttl_seconds=7)
        self.assertFalse(acquire("ws2", ttl_seconds=7).granted, "the host had one slot and it was taken")

        release(first)

        self.assertTrue(acquire("ws2", ttl_seconds=7).granted)

    def test_every_slot_is_written_with_an_expiry(self):
        """A slot with no expiry is a slot a killed worker keeps forever."""
        with mock.patch("apps.engine.script.concurrency.cache") as counted:
            counted.add.return_value = True
            acquire("ws1", ttl_seconds=9)

        self.assertEqual({call.kwargs["timeout"] for call in counted.add.call_args_list}, {9})

    def test_a_slot_nobody_released_comes_back_on_its_own(self):
        """A worker killed mid-script never reaches its `finally`.

        Which is the case the whole shape of this is for: the lease is dropped
        here without being released, exactly as a `SIGKILL` would drop it, and
        the slot has to return without anybody being told.
        """
        with override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=4):
            acquire("ws1", ttl_seconds=1)
            self.assertFalse(acquire("ws2", ttl_seconds=1).granted)

            time.sleep(1.05)

            self.assertTrue(acquire("ws2", ttl_seconds=1).granted)

    def test_a_lease_outlives_the_script_it_covers(self):
        """Or it would expire under a process still running, and the host would
        quietly hold more scripts than its cap allows."""
        self.assertEqual(lease_seconds(2000), 2 + LEASE_MARGIN_SECONDS)
        self.assertGreater(lease_seconds(8000), 8)

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_a_tenant_at_its_own_ceiling_is_refused_before_the_host_is_touched(self):
        """The order is the fairness: traffic this exists to contain stops
        costing the shared counter a round trip as soon as it is contained."""
        acquire("ws1", ttl_seconds=7)

        self.assertEqual(acquire("ws1", ttl_seconds=7).refused, WORKSPACE)

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=2)
    def test_a_workspace_slot_taken_for_a_host_that_had_none_is_handed_straight_back(self):
        """The tenant did nothing wrong, and holding half their ceiling for the
        next several seconds would turn a busy host into one workspace's
        outage."""
        held = acquire("ws1", ttl_seconds=7)
        self.assertEqual(acquire("ws2", ttl_seconds=7).refused, HOST)

        release(held)

        # A host with room again, so what is being counted is ws2's own
        # ceiling and not the shared one it was refused at.
        with override_settings(SCRIPT_MAX_CONCURRENT=4):
            self.assertTrue(acquire("ws2", ttl_seconds=7).granted)
            self.assertTrue(acquire("ws2", ttl_seconds=7).granted, "ws2 kept both of its own slots")

    @override_settings(SCRIPT_MAX_CONCURRENT=4, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_a_quiet_workspace_is_not_charged_for_a_busy_one(self):
        """The whole point of the second ceiling. A host cap on its own buys a
        queue, and the busiest tenant wins a queue every time."""
        acquire("hot", ttl_seconds=7)
        self.assertFalse(acquire("hot", ttl_seconds=7).granted)

        self.assertTrue(acquire("quiet", ttl_seconds=7).granted)

    def test_a_caller_with_no_tenant_to_charge_takes_a_host_slot_only(self):
        lease = acquire(None, ttl_seconds=7)

        self.assertEqual(len(lease.keys), 1)

    def test_releasing_a_refusal_is_safe(self):
        """`slot` releases whatever it yielded, refusals included."""
        with override_settings(SCRIPT_MAX_CONCURRENT=0):
            refused = acquire(None, ttl_seconds=7)

        release(refused)
        release(refused)

        self.assertTrue(acquire(None, ttl_seconds=7).granted)

    def test_a_cache_nobody_can_reach_lets_the_script_run(self):
        """This is a capacity limit, not one of the sandbox's six boundaries.

        Failing closed on it would take arithmetic out of every bot in the
        product to protect a machine that is not under load.
        """
        with mock.patch("apps.engine.script.concurrency.cache") as broken:
            broken.add.side_effect = ConnectionError("redis is not there")
            # Loudly, though: the warning is the only way anybody finds out the
            # cap has stopped applying.
            with self.assertLogs("apps.engine.script.concurrency", "WARNING"):
                lease = acquire("ws1", ttl_seconds=7)

        self.assertTrue(lease.granted)
        self.assertEqual(lease.keys, (), "nothing was taken, so there is nothing to give back")

    def test_two_workspaces_never_share_a_ceiling(self):
        """Keys are digested rather than interpolated, and a digest is the
        reason two ids cannot collapse onto one tenant's ceiling."""
        first = acquire("bir ish maydoni", ttl_seconds=7)
        second = acquire("bir-ish-maydoni", ttl_seconds=7)

        self.assertTrue(first.granted)
        self.assertTrue(second.granted)
        self.assertNotEqual(first.keys[0], second.keys[0])


@SCRIPTS
class RefusedScriptTests(TestCase):
    """What a caller gets when there is no slot, and what happens to one after."""

    def setUp(self) -> None:
        cache.clear()

    @override_settings(SCRIPT_MAX_CONCURRENT=0)
    def test_a_full_host_is_a_refusal_and_not_a_wait(self):
        """The runtime is on a Telegram webhook's clock, and a queue in front
        of a two-second job outlives the request it was meant to save."""
        started = time.monotonic()
        result = run_script("return 1;")

        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "busy")
        self.assertLess(time.monotonic() - started, 0.5, "nothing here queues")

    @override_settings(SCRIPT_MAX_CONCURRENT=0)
    def test_the_refusal_is_a_sentence_the_author_can_act_on(self):
        result = run_script("return 1;")

        self.assertIn("urinib", result.error, "«try again» is the one thing they can do about it")

    @override_settings(SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=0)
    def test_a_tenant_at_its_ceiling_is_refused_by_name(self):
        result = run_script("return 1;", workspace_id="ws1")

        self.assertEqual(result.kind, "busy")
        self.assertIn("ish maydonida", result.error)

    @override_settings(SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=0)
    def test_a_full_ceiling_is_not_reported_as_a_deployment_without_node(self):
        """The two are neighbours and the author's next move is opposite:
        `unavailable` is permanent and theirs to do nothing about, `busy` is
        gone in a second."""
        self.assertEqual(run_script("return 1;", workspace_id="ws1").kind, "busy")

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_the_slot_is_given_back_when_the_script_throws(self):
        self.assertFalse(run_script("throw new Error('narx topilmadi');", workspace_id="ws1").ok)

        self.assertTrue(run_script("return 1;", workspace_id="ws1").ok, "a failed script is not a lost slot")

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_the_slot_is_given_back_when_the_script_is_killed_for_running_too_long(self):
        """The subprocess is killed rather than asked to stop, and the slot has
        to survive that — otherwise one endless loop costs the host a slot for
        the whole lease."""
        killed = run_script("while (true) {}", limits=ScriptLimits(timeout_ms=700), workspace_id="ws1")
        self.assertEqual(killed.kind, "timeout")

        self.assertTrue(run_script("return 1;", workspace_id="ws1").ok)

    @override_settings(SCRIPT_MAX_CONCURRENT=1, SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=1)
    def test_the_slot_is_given_back_when_the_sandbox_itself_breaks(self):
        """`finally`, not a happy path. A bug in `_run` must not cost the
        deployment a slot for as long as the lease lasts."""
        with mock.patch("apps.engine.script.sandbox._run", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                run_script("return 1;", workspace_id="ws1")

        self.assertTrue(run_script("return 1;", workspace_id="ws1").ok)

    def test_a_cache_nobody_can_reach_still_answers_the_script(self):
        with mock.patch("apps.engine.script.concurrency.cache") as broken:
            broken.add.side_effect = ConnectionError("redis is not there")
            with self.assertLogs("apps.engine.script.concurrency", "WARNING"):
                result = run_script("return 40 + 2;")

        self.assertEqual(result.value, 42)
