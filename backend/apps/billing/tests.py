"""Plan limits — the gauge and the guard, which have to agree."""

from __future__ import annotations

import ast
from io import StringIO
from pathlib import Path

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.billing.models import Plan, Subscription, default_limits
from apps.billing.services import (
    RESOURCES,
    PlanLimitExceeded,
    ai_blocks_in,
    ai_blocks_used,
    check_graph_allows,
    check_plan_allows,
    limit_message,
    lock_reason,
    plan_allows,
    plan_limit,
    scripts_used,
    usage_report,
)
from apps.notifications.models import Notification
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

AI_GRAPH = [
    {"id": "n1", "type": "start"},
    {"id": "n2", "type": "ai"},
    {"id": "n3", "type": "ai"},
]


class PlanLimitTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t", enabled_modules=["dms"]
        )
        self.plan = Plan.objects.create(
            key="start",
            name="Start",
            limits={"bots": 1, "flows": 2, "messages": 5000, "contacts": 3, "members": 2, "aiBlocks": 0},
        )
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)

    def _flow(self, name: str = "Oqim", nodes=None, *, enabled: bool = True) -> Flow:
        # Enabled by default: the AI cap counts what the workspace is *running*,
        # so a paused flow is deliberately invisible to it.
        return Flow.objects.create(
            workspace=self.workspace,
            project=self.project,
            bot=self.bot,
            module_key="dms",
            name=name,
            nodes=nodes or [],
            enabled=enabled,
        )

    def test_the_gauge_reads_the_plans_own_limits(self):
        self._flow()
        Contact.objects.create(workspace=self.workspace, bot=self.bot, telegram_user_id=1, chat_id=1)

        report = usage_report(self.workspace)
        rows = {row["key"]: row for row in report["metrics"]}

        self.assertEqual(report["planName"], "Start")
        self.assertEqual(rows["flows"]["used"], 1)
        self.assertEqual(rows["flows"]["limit"], 2)
        self.assertEqual(rows["contacts"]["used"], 1)
        self.assertEqual(rows["contacts"]["limit"], 3)
        self.assertEqual(rows["aiBlocks"]["limit"], 0, "the entry plan has no AI blocks")

    def test_a_limit_the_plan_does_not_declare_is_not_a_limit(self):
        self.plan.limits = {"flows": 1}
        self.plan.save(update_fields=["limits"])

        self.assertIsNone(plan_limit(self.workspace, "contacts"))
        self.assertTrue(plan_allows(self.workspace, "contacts", adding=10_000))

    def test_null_means_uncapped(self):
        self.plan.limits = {"flows": None}
        self.plan.save(update_fields=["limits"])
        self._flow("Bir")
        self._flow("Ikki")

        check_plan_allows(self.workspace, "flows")  # no raise

    def test_the_last_one_under_the_cap_is_allowed(self):
        self._flow("Bir")

        self.assertTrue(plan_allows(self.workspace, "flows"), "one more fits into two")
        check_plan_allows(self.workspace, "flows")

    def test_one_over_the_cap_is_refused_with_the_plan_named(self):
        self._flow("Bir")
        self._flow("Ikki")

        with self.assertRaises(PlanLimitExceeded) as caught:
            check_plan_allows(self.workspace, "flows")

        self.assertEqual(caught.exception.status_code, 402)
        self.assertEqual(caught.exception.code, "plan_limit")
        message = str(caught.exception.detail)
        self.assertIn("Start", message, "the reader has to know which plan refused")
        self.assertIn("2", message, "and what the limit is")

    def test_plan_allows_never_raises(self):
        """The runtime asks this one — a webhook that raised would be retried forever."""
        for index in range(3):
            Contact.objects.create(workspace=self.workspace, bot=self.bot, telegram_user_id=index, chat_id=index)

        self.assertFalse(plan_allows(self.workspace, "contacts"))

    def test_a_workspace_without_a_subscription_still_has_its_plan(self):
        self.workspace.subscription.delete()
        self.workspace.refresh_from_db()

        self.assertEqual(plan_limit(self.workspace, "flows"), 2, "the plan key is enough to price a tenant")

    def test_a_workspace_on_no_plan_at_all_is_uncapped(self):
        self.workspace.subscription.delete()
        self.workspace.plan_key = "nothing-like-this"
        self.workspace.save(update_fields=["plan_key"])
        self.workspace.refresh_from_db()

        self.assertTrue(plan_allows(self.workspace, "flows", adding=99))

    def test_an_unknown_resource_is_a_mistake_not_an_allowance(self):
        with self.assertRaises(ValueError):
            plan_limit(self.workspace, "aiToken")

    # ------------------------------------------------------------------ AI blocks

    def test_ai_blocks_are_counted_out_of_the_graph(self):
        self.assertEqual(ai_blocks_in(AI_GRAPH), 2)
        self.assertEqual(ai_blocks_in([]), 0)
        self.assertEqual(ai_blocks_in(None), 0)

        self._flow("AI bor", AI_GRAPH)
        self.assertEqual(ai_blocks_used(self.workspace), 2)

    def test_a_paused_flows_ai_blocks_are_not_counted(self):
        """Nobody's message reaches a flow that is switched off.

        Counting drafts made the cap unescapable: a workspace that had once
        drawn two AI blocks could not switch anything on again, ever.
        """
        self._flow("Qoralama", AI_GRAPH, enabled=False)

        self.assertEqual(ai_blocks_used(self.workspace), 0)

    def test_a_flow_with_no_ai_blocks_is_never_refused(self):
        """QA hit this: a keyword flow the wizard built, with no AI in it at
        all, was refused because *another* flow was already over the cap."""
        self._flow("AI bor", AI_GRAPH)

        # No exception: this graph adds nothing to the thing being capped.
        check_graph_allows(self.workspace, [{"id": "m1", "type": "message", "text": "salom"}], flow_id=None)

    def test_a_graph_with_ai_blocks_is_refused_on_a_plan_without_them(self):
        flow = self._flow("AI bor")

        with self.assertRaises(PlanLimitExceeded) as caught:
            check_graph_allows(self.workspace, AI_GRAPH, flow_id=flow.id)

        self.assertIn("AI bloklari", str(caught.exception.detail))
        self.assertEqual(caught.exception.field, "nodes")

    def test_a_graph_without_ai_blocks_saves_on_the_same_plan(self):
        flow = self._flow("AI yo'q")

        check_graph_allows(self.workspace, [{"id": "n1", "type": "message"}], flow_id=flow.id)

    def test_resaving_a_flow_does_not_count_its_own_blocks_twice(self):
        self.plan.limits = {**self.plan.limits, "aiBlocks": 2}
        self.plan.save(update_fields=["limits"])
        flow = self._flow("AI bor", AI_GRAPH)

        check_graph_allows(self.workspace, AI_GRAPH, flow_id=flow.id)

        with self.assertRaises(PlanLimitExceeded):
            # A *second* flow with the same two blocks is what the cap is about.
            check_graph_allows(self.workspace, AI_GRAPH, flow_id=None)


class ScriptPlanTests(TestCase):
    """Which plan a flow may carry its own JavaScript on.

    Scripting sits on the same boundary AI blocks do, because it is the same
    purchase: a Node process we start on the tenant's behalf while a customer
    waits. One boundary is one sentence to explain, and the alternative — a
    second line drawn somewhere else — is a second thing a reader can only
    discover by being refused.

    Refused where it is spent, which is switching the flow on. Saving a script
    is never refused: deleting the code that breaks the plan is itself a save,
    and a panel that will not store what is in front of an author is a panel
    that loses their work. What stops them writing one at all is the lock in
    the editor, and `lock_reason` is the sentence both halves say.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="s@b.uz", password="Parol12345", name="S", email_verified=True)
        self.workspace = Workspace.objects.create(id="sw", name="SW", slug="sw", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="sp", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="sb", workspace=self.workspace, project=self.project, handle="@s", token="t", enabled_modules=["dms"]
        )
        self.plan = Plan.objects.create(key="start", name="Free", limits={"flows": 9, "scripts": 0})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _flow(self, name: str, *, script: str = "", enabled: bool = True) -> Flow:
        return Flow.objects.create(
            workspace=self.workspace,
            project=self.project,
            bot=self.bot,
            module_key="dms",
            name=name,
            nodes=[{"id": "n1", "type": "message", "text": "salom"}],
            script=script,
            enabled=enabled,
        )

    def test_only_running_flows_count_towards_the_script_limit(self):
        """A paused flow's hooks never fire — the AI block's rule, word for word."""
        self._flow("Kodli", script="function onFlowStart(ctx) {}")
        self._flow("Qoralama", script="function onFlowStart(ctx) {}", enabled=False)
        self._flow("Kodsiz")

        self.assertEqual(scripts_used(self.workspace), 1)

    def test_a_flow_with_no_code_is_never_refused_on_this(self):
        check_graph_allows(self.workspace, [{"id": "n1", "type": "message"}], flow_id=None, script="")

    def test_whitespace_is_not_a_script(self):
        """The panel writes a cleared file back as newlines, and that is not code."""
        check_graph_allows(self.workspace, [{"id": "n1", "type": "message"}], flow_id=None, script="\n\n  \n")

    def test_a_flow_carrying_code_is_refused_on_a_plan_that_has_none(self):
        with self.assertRaises(PlanLimitExceeded) as caught:
            check_graph_allows(self.workspace, [], flow_id=None, script="function onFlowStart(ctx) {}")

        self.assertEqual(caught.exception.status_code, 402)
        self.assertEqual(caught.exception.field, "script")
        self.assertIn("oqim skriptlari", str(caught.exception.detail))

    def test_the_script_is_read_off_the_row_when_the_caller_does_not_pass_it(self):
        """`flows.views.enable` hands over the graph and not the file."""
        flow = self._flow("Kodli", script="function onFlowStart(ctx) {}", enabled=False)

        with self.assertRaises(PlanLimitExceeded):
            check_graph_allows(self.workspace, flow.nodes, flow_id=flow.id)

    def test_switching_on_a_flow_with_code_is_refused_through_the_api(self):
        """The lock in the editor is the primary; this is what it is a lock on."""
        flow = self._flow("Kodli", script="function onFlowStart(ctx) {}", enabled=False)

        answer = self.client.post(f"/api/flows/{flow.id}/enable/", {"enabled": True}, format="json")

        self.assertEqual(answer.status_code, 402)
        flow.refresh_from_db()
        self.assertFalse(flow.enabled, "refused before the row moved, not after")

    def test_the_same_flow_switches_on_once_the_plan_covers_it(self):
        self.plan.limits = {**self.plan.limits, "scripts": None}
        self.plan.save(update_fields=["limits"])
        flow = self._flow("Kodli", script="function onFlowStart(ctx) {}", enabled=False)

        answer = self.client.post(f"/api/flows/{flow.id}/enable/", {"enabled": True}, format="json")

        self.assertEqual(answer.status_code, 200)

    def test_switching_a_flow_off_is_never_refused(self):
        """Nobody may be trapped in a state they are being billed for."""
        flow = self._flow("Kodli", script="function onFlowStart(ctx) {}")

        answer = self.client.post(f"/api/flows/{flow.id}/enable/", {"enabled": False}, format="json")

        self.assertEqual(answer.status_code, 200)


class LockAndRefusalAgreeTests(TestCase):
    """The two sentences a plan says, and the promise that they are about the same plan.

    One is `limit_message`, raised at somebody who has already pressed
    something. The other is `lock_reason`, printed on a control nobody has
    pressed yet — a palette row, a disabled button — which is the whole of what
    M-16 was: «AI javob» sat unlocked in the palette while the limits screen
    said the plan did not have it, and the refusal arrived on «Yoqish», about a
    flow the author had already built.

    Two sentences and not one because the moments differ: the refusal counts
    what was attempted, and a lock counting an attempt nobody made would read
    as an accusation. What they may never differ about is the plan and the
    resource, which is what this holds them to.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="l@b.uz", password="Parol12345", name="L", email_verified=True)
        self.workspace = Workspace.objects.create(id="lw", name="LW", slug="lw", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.plan = Plan.objects.create(key="start", name="Boshlang'ich", limits={"aiBlocks": 0, "flows": 1})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)

    def test_a_limit_with_room_locks_nothing(self):
        self.assertEqual(lock_reason(self.workspace, "flows", used=0, limit=1), "")

    def test_a_plan_that_does_not_cap_this_locks_nothing(self):
        self.assertEqual(lock_reason(self.workspace, "contacts"), "")

    def test_a_resource_the_plan_has_none_of_says_so_and_says_where(self):
        sentence = lock_reason(self.workspace, "aiBlocks", used=0, limit=0)

        self.assertIn("Boshlang'ich", sentence, "which plan")
        self.assertIn("AI bloklari", sentence, "which resource")
        self.assertIn("To'lov", sentence, "and where the answer is changed")

    def test_a_limit_that_is_simply_full_reads_as_full(self):
        sentence = lock_reason(self.workspace, "flows", used=1, limit=1)

        self.assertIn("hammasi ishlatilgan", sentence)
        # Not «1 ta oqimlar»: after a numeral the noun is singular in Uzbek.
        self.assertNotIn("1 ta oqimlar", sentence)

    def test_both_sentences_name_the_same_plan_and_the_same_resource(self):
        for resource in ("aiBlocks", "flows"):
            with self.subTest(resource):
                limit = self.plan.limits[resource]
                lock = lock_reason(self.workspace, resource, used=limit, limit=limit)
                refusal = limit_message(self.workspace, resource, total=limit + 1, limit=limit)

                self.assertTrue(lock, "the lock has something to say at the ceiling")
                for word in ("Boshlang'ich", RESOURCES[resource]["noun"]):
                    self.assertIn(word, lock)
                    self.assertIn(word, refusal)

    def test_every_usage_row_carries_both_sentences(self):
        rows = {row["key"]: row for row in usage_report(self.workspace)["metrics"]}

        for key, row in rows.items():
            with self.subTest(key):
                self.assertTrue(row["whenFull"], "a full bar has to say what it costs")
                self.assertIn("lockReason", row)
        self.assertTrue(rows["aiBlocks"]["lockReason"], "a plan with none of something locks it")
        self.assertEqual(rows["contacts"]["lockReason"], "", "an uncapped row locks nothing")


class LimitsThatFillUpAreAnnouncedTests(TestCase):
    """A full bar with an empty bell.

    The audit found a workspace at `1 / 1 bot` and `5 / 5 oqim`, «Tarif
    chegarasi» switched on, and no notification of any kind — because the only
    two calls that ever warned were in the runtime and both were about
    `messages`. Every other limit filled up in silence and then refused, which
    is the first the workspace heard of it.

    `check_plan_allows` is where that is fixed, because it is the one place
    every countable create already passes through, and it is holding the count
    the sentence needs.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="w@b.uz", password="Parol12345", name="W", email_verified=True)
        self.workspace = Workspace.objects.create(id="ww", name="WW", slug="ww", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="wp", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="wb", workspace=self.workspace, project=self.project, handle="@w", token="t", enabled_modules=["dms"]
        )
        self.plan = Plan.objects.create(key="start", name="Free", limits={"flows": 2, "bots": 1})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        # LocMemCache outlives one test and every throttle here is keyed by a
        # workspace id — the same reason `apps.notifications.tests` clears it.
        cache.clear()

    def _flow(self, name: str) -> Flow:
        return Flow.objects.create(
            workspace=self.workspace, project=self.project, bot=self.bot, module_key="dms", name=name, nodes=[]
        )

    def test_a_comfortable_limit_says_nothing(self):
        check_plan_allows(self.workspace, "flows")

        self.assertEqual(Notification.objects.count(), 0)

    def test_the_create_that_fills_a_limit_is_announced(self):
        self._flow("Bir")

        check_plan_allows(self.workspace, "flows")  # the second of two: allowed, and it fills the plan

        notification = Notification.objects.get()
        self.assertEqual(notification.kind, Notification.Kind.BILLING)
        self.assertIn("Free", notification.text, "which plan")
        self.assertIn("oqim yarata olmaysiz", notification.text, "and what stops")
        self.assertEqual(notification.href, "/billing/usage")

    def test_the_refusal_is_announced_too_and_still_refuses(self):
        self._flow("Bir")
        self._flow("Ikki")

        with self.assertRaises(PlanLimitExceeded):
            check_plan_allows(self.workspace, "flows")

        self.assertEqual(Notification.objects.count(), 1, "the loudest moment a limit has is worth a record")

    def test_the_same_limit_is_not_announced_twice_in_a_day(self):
        self._flow("Bir")

        for _ in range(5):
            try:
                check_plan_allows(self.workspace, "flows")
            except PlanLimitExceeded:
                pass

        self.assertEqual(Notification.objects.count(), 1)

    def test_an_uncapped_limit_is_never_announced(self):
        self.plan.limits = {**self.plan.limits, "flows": None}
        self.plan.save(update_fields=["limits"])
        for name in ("Bir", "Ikki", "Uch"):
            self._flow(name)

        check_plan_allows(self.workspace, "flows")

        self.assertEqual(Notification.objects.count(), 0)


class UsageEndpointTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        plan = Plan.objects.create(key="start", name="Start", limits={"contacts": 3, "aiBlocks": 0})
        Subscription.objects.create(workspace=self.workspace, plan=plan)

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_the_limits_screen_reads_what_the_api_enforces(self):
        payload = self.client.get("/api/billing/usage/").data
        rows = {row["key"]: row for row in payload["metrics"]}

        self.assertEqual(payload["planKey"], "start")
        self.assertEqual(rows["contacts"]["limit"], 3)
        self.assertEqual(rows["aiBlocks"]["limit"], 0)
        self.assertIsNone(rows["messages"]["limit"], "a key the plan omits is not a cap")


#: The three functions that make a limit real. A comparison written by hand
#: somewhere, or a number pasted into a view, is deliberately not one of them:
#: the point of the check below is that there is one vocabulary for this, and a
#: cap enforced outside it is a cap the gauge cannot be held to.
GUARDS = frozenset({"plan_allows", "check_plan_allows", "refusal_reason"})

#: The one limit key nothing refuses on, and what stands in its place.
#:
#: `contacts` used to be the other entry and is closed: `apps.engine.dispatch`
#: asks `plan_allows` before an unknown chat becomes a row, and a workspace
#: with no room left goes on answering while the row goes unwritten.
#:
#: `messages` is not a gap of the same kind and is not waiting for one to be
#: filled. The number moves *after* a send that has already left the machine,
#: so by the time it moves there is nothing left to refuse; refusing earlier
#: would be a bot going quiet mid-conversation because a counter filled, which
#: is the one failure the module docstring names as worse than the overage.
#: What stands in place of a refusal is
#: `apps.notifications.services.warn_about_usage`, reached from
#: `apps.engine.runner._count_message`: the workspace is told once when the
#: limit is nearly gone and once when it is past, and nothing stops. That is
#: deliberately not a guard, so this key stays here rather than disappearing
#: into `_guarded_resources` and reading as enforcement it is not.
#:
#: The screen knows: `usage_report` marks each row `enforced`, and `UsageMeter`
#: prints a different sentence for a bar that is full because nothing is being
#: refused. `test_the_screen_and_this_list_name_the_same_unenforced_keys` binds
#: the two, so a key cannot move here without the meter learning about it.
UNGUARDED = {
    "messages": "never refused, by design — warned instead, apps.notifications.services.warn_about_usage",
}


def _guarded_resources() -> dict[str, list[str]]:
    """Every limit key some shipping module hands to a guard, and the files that do.

    Read out of the syntax rather than grepped: `check_plan_allows(ws, "bots")`
    is a call with a string in it, and that is a thing an AST can be sure of
    where a regular expression is only fairly confident. Tests and migrations
    are left out — a limit that only a test ever checks is not enforced.
    """
    root = Path(__file__).resolve().parents[1]
    found: dict[str, list[str]] = {}
    for path in sorted(root.rglob("*.py")):
        parts = set(path.parts)
        if "migrations" in parts or "tests" in parts or path.name == "tests.py" or path.name.startswith("test_"):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name not in GUARDS:
                continue
            named = node.args[1] if len(node.args) > 1 else None
            if named is None:
                named = next((kw.value for kw in node.keywords if kw.arg == "resource"), None)
            if isinstance(named, ast.Constant) and isinstance(named.value, str):
                found.setdefault(named.value, []).append(str(path.relative_to(root)))
    return found


class DeclaredLimitsAreEnforcedTests(TestCase):
    """A limit nobody checks is the bug that arrives without a symptom.

    Every key in this table is a bar the billing screen draws and a sentence
    the price list makes. `bots`, `members`, `contacts` and `messages` were all
    drawn and none of the four was ever checked, so a Free workspace read
    `1 / 1 bot` and connected the second one anyway — the customer was told
    something untrue and the paid tier bought nothing.

    Nothing about that failed. It cannot fail: the gauge reads the plan and the
    guard is simply absent, so both halves are internally consistent and the
    only witness is a customer who notices they are getting more than they paid
    for. Hence a test that asserts on the *code* rather than on behaviour —
    behaviour cannot testify to a check that was never written.
    """

    def test_every_key_the_default_plan_declares_is_a_key_something_counts(self):
        """An undeclared key is uncapped; a *misdeclared* one is uncapped and invisible."""
        self.assertEqual(sorted(set(default_limits()) - set(RESOURCES)), [])

    def test_every_plan_the_deployment_seeds_declares_only_counted_keys(self):
        """The price list is data, and `aiblocks` for `aiBlocks` would cap nothing."""
        call_command("seed_demo", days=0, stdout=StringIO())

        rows = {plan.key: sorted(set(plan.limits) - set(RESOURCES)) for plan in Plan.objects.all()}

        self.assertTrue(rows, "the seed writes the price list this asserts about")
        self.assertEqual({key: extra for key, extra in rows.items() if extra}, {})

    def test_the_screen_and_this_list_name_the_same_unenforced_keys(self):
        """One fact, two readers, and they used to disagree silently.

        A limit that is counted but never refused needs the *screen* to say so
        — a full bar reading "yangi so'rovlar rad etilyapti" over a limit
        nothing refuses tells a workspace its bots have stopped when they have
        not. So `usage_report` carries `enforced` per row, and this asserts the
        rows it marks unenforced are exactly the keys this file already calls
        unguarded. Adding a guard means deleting the key from `UNGUARDED`, and
        this fails until `COUNTED_NOT_REFUSED` loses it too.
        """
        from apps.billing.services import COUNTED_NOT_REFUSED

        self.assertEqual(set(UNGUARDED), set(COUNTED_NOT_REFUSED))

    def test_every_usage_row_says_whether_going_over_is_refused(self):
        user = User.objects.create_user(
            email="meter@b.uz", password="Parol12345", name="A", email_verified=True
        )
        workspace = Workspace.objects.create(id="mtr", name="M", slug="mtr", owner=user)

        rows = {row["key"]: row for row in usage_report(workspace)["metrics"]}

        self.assertTrue(rows, "the resource table is not empty")
        for key, row in rows.items():
            with self.subTest(key):
                self.assertIn("enforced", row)
                self.assertEqual(row["enforced"], key not in UNGUARDED)

    def test_every_counted_limit_has_code_that_refuses_on_it(self):
        guarded = _guarded_resources()
        missing = sorted(set(RESOURCES) - set(guarded) - set(UNGUARDED))

        self.assertEqual(
            missing,
            [],
            "the plan declares these, the billing screen draws them, and no call refuses on them: "
            f"{missing}. Add a `check_plan_allows` on the path that creates one — or, if it is a "
            "runtime path that must not raise, a `plan_allows`/`refusal_reason` and a line in "
            "`UNGUARDED` saying where it will go.",
        )

    def test_the_one_deliberate_gap_is_still_the_only_one(self):
        """Named so that closing one is a deliberate edit here, not a silent drift."""
        self.assertEqual(sorted(UNGUARDED), ["messages"])

    def test_the_runtime_refuses_the_limit_only_it_can_see(self):
        """`contacts` moves on a webhook, so its guard cannot live on a view.

        Pinned by file: the check belongs where an unknown chat becomes a row,
        and a `plan_allows` anywhere else would be counting a thing it is not
        about to create.
        """
        self.assertIn("engine/dispatch.py", _guarded_resources().get("contacts", []))

    def test_no_guard_asks_about_a_resource_nothing_counts(self):
        """`plan_limit` raises on an unknown key — but only if that line ever runs.

        A typo'd resource in a path nobody exercises is a check that reads as
        enforcement in review and raises `ValueError` the first time a customer
        reaches it.
        """
        unknown = sorted(set(_guarded_resources()) - set(RESOURCES))

        self.assertEqual(unknown, [])
