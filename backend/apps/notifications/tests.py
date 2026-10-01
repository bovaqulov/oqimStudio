"""Notification tests: who sees what, and what "read" costs.

The bell is a small endpoint over a table with two audiences in it — rows
addressed to one person and rows addressed to the whole workspace — and the
queryset that separates them is one `Q()`. Everything below exists because
getting that expression wrong is silent: nobody is refused anything, the wrong
people simply see somebody else's notice.

`read-all` gets its own attention for the same reason in reverse. It is an
`UPDATE ... WHERE`, so a queryset that is too wide does not leak a row, it
quietly marks other people's notifications as read for them.
"""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.analytics.models import Event, Metric
from apps.billing.models import Plan, Subscription
from apps.billing.services import usage_report
from apps.notifications.models import Notification, NotificationSettings
from apps.notifications.services import ALWAYS_WARN, ALWAYS_WARN_SENTENCE, notify, warn_about_usage
from apps.workspaces.models import Membership, Role, Workspace


def make_tenant(slug: str, email: str):
    user = User.objects.create_user(email=email, password="Parol12345", name=slug, email_verified=True)
    workspace = Workspace.objects.create(id=slug, name=slug, slug=slug, owner=user)
    Membership.objects.create(workspace=workspace, user=user, email=email, role=Role.OWNER)
    return user, workspace


class NotificationVisibilityTests(TestCase):
    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("ws1", "a@b.uz")
        self.colleague = User.objects.create_user(
            email="hamkasb@b.uz", password="Parol12345", name="Hamkasb", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.colleague, email=self.colleague.email, role=Role.EDITOR
        )
        self.outsider, self.other_workspace = make_tenant("ws2", "b@b.uz")

        self.everyone = Notification.objects.create(workspace=self.workspace, title="Hammaga")
        self.mine = Notification.objects.create(workspace=self.workspace, user=self.user, title="Menga")
        self.theirs = Notification.objects.create(workspace=self.workspace, user=self.colleague, title="Hamkasbga")
        self.elsewhere = Notification.objects.create(workspace=self.other_workspace, title="Boshqa maydonda")

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _titles(self, response) -> set[str]:
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {row["title"] for row in rows}

    def test_the_bell_shows_the_workspace_wide_ones_and_your_own(self):
        response = self.client.get("/api/notifications/", HTTP_X_WORKSPACE_ID="ws1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._titles(response), {"Hammaga", "Menga"})

    def test_another_workspace_is_not_in_it(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get("/api/notifications/", HTTP_X_WORKSPACE_ID="ws2")
        self.assertEqual(self._titles(response), {"Boshqa maydonda"})

    def test_a_colleagues_own_notice_cannot_be_opened_by_id(self):
        """404 and not 403: for this reader that row does not exist, and
        saying "forbidden" would confirm that it does."""
        response = self.client.get(f"/api/notifications/{self.theirs.id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 404)

    def test_a_row_from_another_workspace_cannot_be_marked_read(self):
        response = self.client.post(f"/api/notifications/{self.elsewhere.id}/read/", HTTP_X_WORKSPACE_ID="ws1")

        self.assertEqual(response.status_code, 404)
        self.elsewhere.refresh_from_db()
        self.assertIsNone(self.elsewhere.read_at)

    def test_the_unread_count_counts_only_what_this_reader_can_see(self):
        response = self.client.get("/api/notifications/unread/", HTTP_X_WORKSPACE_ID="ws1")
        # "Hammaga" and "Menga" — not the colleague's, not the other workspace's.
        self.assertEqual(response.data["count"], 2)

    def test_the_payload_is_the_shape_the_interface_reads(self):
        self.mine.read_at = timezone.now()
        self.mine.save(update_fields=["read_at"])

        row = next(
            r
            for r in self.client.get("/api/notifications/", HTTP_X_WORKSPACE_ID="ws1").data["results"]
            if r["title"] == "Menga"
        )
        self.assertTrue(row["isRead"])
        self.assertIn("at", row)


class ReadingTests(TestCase):
    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("ws1", "a@b.uz")
        self.colleague = User.objects.create_user(
            email="hamkasb@b.uz", password="Parol12345", name="Hamkasb", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.colleague, email=self.colleague.email, role=Role.EDITOR
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_reading_it_twice_does_not_move_the_timestamp(self):
        """`read` is what a bell calls when a panel opens, which is more often
        than once — so it has to be idempotent or "2 soat oldin" becomes "hozir"
        every time somebody looks at it."""
        notification = Notification.objects.create(workspace=self.workspace, title="Hammaga")

        first = self.client.post(f"/api/notifications/{notification.id}/read/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data["isRead"])
        notification.refresh_from_db()
        stamped = notification.read_at

        self.client.post(f"/api/notifications/{notification.id}/read/", HTTP_X_WORKSPACE_ID="ws1")
        notification.refresh_from_db()
        self.assertEqual(notification.read_at, stamped)

    def test_read_all_stops_at_the_edge_of_what_this_reader_sees(self):
        everyone = Notification.objects.create(workspace=self.workspace, title="Hammaga")
        mine = Notification.objects.create(workspace=self.workspace, user=self.user, title="Menga")
        theirs = Notification.objects.create(workspace=self.workspace, user=self.colleague, title="Hamkasbga")

        response = self.client.post("/api/notifications/read-all/", HTTP_X_WORKSPACE_ID="ws1")

        self.assertEqual(response.data, {"ok": True, "updated": 2})
        for notification in (everyone, mine):
            notification.refresh_from_db()
            self.assertIsNotNone(notification.read_at)
        theirs.refresh_from_db()
        self.assertIsNone(theirs.read_at, "read-all must not clear somebody else's bell")


class NotifyTests(TestCase):
    """The one function, and the two halves it must not let come apart."""

    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("ws1", "a@b.uz")

    def test_it_writes_the_row_and_pushes_it_in_the_same_breath(self):
        with mock.patch("apps.notifications.services.publish") as publish:
            notification = notify(
                workspace=self.workspace,
                title="Operator kerak",
                text="Dilnoza",
                kind=Notification.Kind.HANDOFF,
                href="/contacts/1",
            )

        self.assertEqual(Notification.objects.get(pk=notification.id).title, "Operator kerak")
        group, event, payload = publish.call_args[0]
        self.assertEqual((group, event), (f"ws.workspace.{self.workspace.id}", "notification.created"))
        self.assertEqual(payload["id"], notification.id)
        self.assertEqual(payload["kind"], Notification.Kind.HANDOFF)
        self.assertEqual(payload["href"], "/contacts/1")

    def test_addressing_one_person_keeps_it_off_everybody_elses_bell(self):
        with mock.patch("apps.notifications.services.publish"):
            notify(workspace=self.workspace, title="Sizga", user=self.user)

        colleague = User.objects.create_user(
            email="hamkasb@b.uz", password="Parol12345", name="Hamkasb", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=colleague, email=colleague.email, role=Role.EDITOR
        )
        client = APIClient()
        client.force_authenticate(colleague)

        self.assertEqual(client.get("/api/notifications/unread/", HTTP_X_WORKSPACE_ID="ws1").data["count"], 0)


class UsageWarningTests(TestCase):
    """The warning that stands in for a refusal.

    `messages` is the one declared limit this product deliberately never
    enforces. `apps.billing.services` writes the rule out: a bot that stops
    answering because a counter is full is a worse failure than the overage
    itself, and a webhook that raised would be retried by Telegram forever. So
    nothing is blocked — which leaves exactly one obligation, that the
    workspace is told, and one difficulty, that the telling sits on the hot
    path. The count behind the sentence is a `COUNT(*)` over thirty days of
    events and the hot path is *every message the product sends*, so the
    expensive half has to be reached far less often than it is called.
    """

    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("ws1", "a@b.uz")
        self.plan = Plan.objects.create(key="start", name="Free", limits={"messages": 100})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        # LocMemCache outlives one test, and every throttle below is a cache
        # key keyed by a workspace id this suite reuses.
        cache.clear()

    def _messages(self, count: int, *, days_ago: int = 0) -> None:
        when = timezone.now() - timedelta(days=days_ago)
        Event.objects.bulk_create(
            Event(
                workspace=self.workspace,
                metric=Metric.MESSAGE,
                occurred_at=when,
                occurred_on=when.date(),
            )
            for _ in range(count)
        )

    def test_a_workspace_whose_plan_does_not_cap_this_hears_nothing(self):
        self.plan.limits = {"messages": None}
        self.plan.save(update_fields=["limits"])
        self._messages(500)

        self.assertIsNone(warn_about_usage(self.workspace, "messages"))
        self.assertEqual(Notification.objects.count(), 0)

    def test_nothing_is_said_while_the_limit_is_comfortable(self):
        """A bar at two thirds is a bar, not news."""
        self._messages(60)

        self.assertIsNone(warn_about_usage(self.workspace, "messages"))
        self.assertEqual(Notification.objects.count(), 0)

    def test_the_workspace_is_told_before_the_limit_is_reached(self):
        self._messages(80)

        notification = warn_about_usage(self.workspace, "messages")

        self.assertIsNotNone(notification)
        self.assertEqual(notification.kind, Notification.Kind.BILLING)
        self.assertIn("Free", notification.text, "the reader has to know which plan is filling up")
        self.assertIn("100", notification.text, "and what the limit is")
        self.assertEqual(notification.href, "/billing/usage")

    def test_the_same_warning_is_not_repeated(self):
        """One notice per step is a diagnosis; one per message is a wall.

        The bot sends thousands of messages inside one window and every one of
        them reaches this function.
        """
        self._messages(80)

        self.assertIsNotNone(warn_about_usage(self.workspace, "messages"))
        for _ in range(50):
            self.assertIsNone(warn_about_usage(self.workspace, "messages"))

        self.assertEqual(Notification.objects.count(), 1)

    def test_crossing_the_limit_is_its_own_notice(self):
        """"Nearly full" and "full" are different facts and both are worth one line."""
        self._messages(80)
        warn_about_usage(self.workspace, "messages")
        cache.clear()  # the probe window, not the notice window, is what stands in the way
        self._messages(40)

        second = warn_about_usage(self.workspace, "messages")

        self.assertIsNotNone(second)
        self.assertEqual(Notification.objects.count(), 2)
        self.assertIn("to'ldi", second.title)

    def test_the_notice_says_that_nothing_stopped(self):
        """The one thing a reader cannot infer from a full bar.

        Every other limit in the product refuses when it is full. This one does
        not, and a notice that only reported the number would leave a workspace
        believing their bot had gone quiet.
        """
        self._messages(120)

        notification = warn_about_usage(self.workspace, "messages")

        self.assertIn("javob berishda davom", notification.text)

    def test_the_count_behind_it_runs_at_most_once_per_probe_window(self):
        """The whole reason this is not simply `if used > limit`.

        Reached after every send, so an unthrottled version would put a
        thirty-day `COUNT(*)` on the hot path of the product's busiest code.
        """
        self._messages(120)
        warn_about_usage(self.workspace, "messages")

        with CaptureQueriesContext(connection) as queries:
            for _ in range(50):
                warn_about_usage(self.workspace, "messages")

        self.assertEqual(len(queries), 0, "fifty sends, no query at all: the cache answered every one")

    def test_a_cache_that_is_down_costs_the_sender_nothing(self):
        """Redis out is exactly when the product must not start counting rows."""
        self._messages(120)

        with mock.patch("apps.notifications.services.cache.add", side_effect=RuntimeError("redis is out")):
            with CaptureQueriesContext(connection) as queries:
                self.assertIsNone(warn_about_usage(self.workspace, "messages"))

        self.assertEqual(len(queries), 0)

    def test_a_notification_that_cannot_be_written_does_not_reach_the_caller(self):
        """This is called from the runtime, and the runtime is mid-send."""
        self._messages(120)

        with mock.patch("apps.notifications.services.notify", side_effect=RuntimeError("table is gone")):
            self.assertIsNone(warn_about_usage(self.workspace, "messages"))

    def test_it_reads_the_same_numbers_the_billing_screen_draws(self):
        """One vocabulary for the gauge and the notice, or they disagree in public."""
        self._messages(90)

        notification = warn_about_usage(self.workspace, "messages")

        row = next(row for row in usage_report(self.workspace)["metrics"] if row["key"] == "messages")
        self.assertIn(str(row["used"]), notification.text)
        self.assertIn(str(row["limit"]), notification.text)


class CountedByTheCallerTests(TestCase):
    """The path where the number is already in hand.

    `billing.check_plan_allows` counts a resource before it decides, so it has
    both halves of the sentence when it calls this. Re-counting here would run
    the same query twice on every create in the product — and, worse, the
    five-minute probe that stands in front of the count would then be deciding
    whether a *refusal* is worth mentioning. The probe exists for the send
    path, where the count is a thirty-day `COUNT(*)` reached after every
    message; a create is neither expensive nor frequent, and one refused four
    minutes after somebody looked at a bar has to be heard.
    """

    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("cw", "c@b.uz")
        self.plan = Plan.objects.create(key="start", name="Free", limits={"flows": 5})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        cache.clear()

    def test_a_handed_over_count_is_used_as_given(self):
        notification = warn_about_usage(self.workspace, "flows", used=5, limit=5)

        self.assertIsNotNone(notification)
        self.assertIn("5", notification.text)

    def test_a_handed_over_count_does_not_wait_for_the_probe(self):
        """The probe is the runtime's throttle, and this is not the runtime."""
        cache.add(f"usage-probe:{self.workspace.id}:flows", 1, 300)

        self.assertIsNotNone(warn_about_usage(self.workspace, "flows", used=5, limit=5))

    def test_the_notice_window_still_stands(self):
        """The probe decides how often the question may be asked; this decides
        how often the same answer may be said out loud, and only that one is
        about the reader."""
        self.assertIsNotNone(warn_about_usage(self.workspace, "flows", used=5, limit=5))

        for _ in range(4):
            self.assertIsNone(warn_about_usage(self.workspace, "flows", used=5, limit=5))
        self.assertEqual(Notification.objects.count(), 1)

    def test_a_limit_that_refuses_says_what_stops_in_the_screens_own_words(self):
        """One fact, two readers. `whenFull` is the line under the bar on the
        billing screen; the bell says the same thing rather than composing a
        second sentence that can drift from it."""
        notification = warn_about_usage(self.workspace, "flows", used=5, limit=5)

        self.assertIn("oqim yarata olmaysiz", notification.text)


class NotificationSwitchTests(TestCase):
    """Which notices a workspace raises at all.

    Until now: all of them, always, with no screen anywhere that said so. Two
    things in this product reach the bell — a flow handing a conversation to a
    person, and `warn_about_usage` — and both were added with a sentence
    explaining why they matter and nothing at all explaining how to stop them.
    A notice nobody can switch off is a notice people learn to ignore, and an
    ignored bell is worse than no bell: it takes the ones that matter with it.

    The switch is the workspace's and not the reader's because the rows are.
    Both callers write `user=None`, so one member turning "Operator kerak" off
    would be turning it off for the colleague sitting next to them; a control
    labelled as personal over a shared row is a lie in whichever direction it
    is read.
    """

    def setUp(self) -> None:
        self.user, self.workspace = make_tenant("ws1", "a@b.uz")
        self.plan = Plan.objects.create(key="start", name="Free", limits={"messages": 100, "contacts": 10})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        cache.clear()

    def _settings(self, **fields) -> NotificationSettings:
        row, _ = NotificationSettings.objects.update_or_create(workspace=self.workspace, defaults=fields)
        return row

    def _messages(self, count: int) -> None:
        now = timezone.now()
        Event.objects.bulk_create(
            Event(workspace=self.workspace, metric=Metric.MESSAGE, occurred_at=now, occurred_on=now.date())
            for _ in range(count)
        )

    # -- the default -------------------------------------------------------

    def test_a_workspace_nobody_has_configured_hears_everything(self):
        """No row is the same answer as a row with everything on. A migration
        that adds a settings table must not silence the product for every
        tenant that existed before it."""
        self.assertFalse(NotificationSettings.objects.exists())

        with mock.patch("apps.notifications.services.publish"):
            self.assertIsNotNone(notify(workspace=self.workspace, title="Operator kerak", kind="handoff"))

    # -- the handoff switch ------------------------------------------------

    def test_switching_the_handoff_notice_off_stops_the_row_being_written(self):
        """Not merely hidden. A bell that is filtered on read still fills the
        table and still pushes to the socket, and "o'qilmagan: 214" over a
        popover showing nothing is its own bug report."""
        self._settings(handoff=False)

        with mock.patch("apps.notifications.services.publish") as publish:
            self.assertIsNone(notify(workspace=self.workspace, title="Operator kerak", kind="handoff"))

        self.assertEqual(Notification.objects.count(), 0)
        publish.assert_not_called()

    def test_the_conversation_itself_is_not_what_was_switched_off(self):
        """The reason this switch is safe to offer at all: the handoff is a
        parked run and an incoming message, and both outlive the notice. What
        is turned off is the interruption, not the request."""
        self._settings(handoff=False)

        with mock.patch("apps.notifications.services.publish"):
            notify(workspace=self.workspace, title="Operator kerak", kind="handoff")

        # Nothing here asserts about `FlowRun` — it is never reached. The point
        # is the negative: `notify` is the only thing this switch touches.
        self.assertEqual(Notification.objects.count(), 0)

    def test_a_kind_with_no_switch_is_not_silenced_by_the_other_ones(self):
        self._settings(handoff=False, usage_warnings=False)

        with mock.patch("apps.notifications.services.publish"):
            self.assertIsNotNone(notify(workspace=self.workspace, title="Tizim", kind="system"))

    # -- the usage switch --------------------------------------------------

    def test_switching_the_usage_warnings_off_silences_the_early_notice(self):
        self._settings(usage_warnings=False)
        self._messages(85)

        self.assertIsNone(warn_about_usage(self.workspace, "messages"))
        self.assertEqual(Notification.objects.count(), 0)

    def test_it_silences_the_overrun_notice_for_a_limit_that_costs_nothing(self):
        """`messages` past its cap stops nothing — `billing.services` says so
        in as many words — so the notice there is news, and news is exactly
        what a switch is for."""
        self._settings(usage_warnings=False)
        self._messages(120)

        self.assertIsNone(warn_about_usage(self.workspace, "messages"))
        self.assertEqual(Notification.objects.count(), 0)

    def test_a_full_contacts_limit_is_said_out_loud_whatever_the_switch_says(self):
        """The one notice this product will not let a workspace turn off.

        Past the `contacts` cap `engine.dispatch` stops filing the people
        writing to the bot: they are answered, and then they are gone — no row
        in Kontaktlar, no thread in Suhbatlar, and a multi-step flow becomes a
        one-step one for them. That is customers going missing, and a workspace
        that had ticked a box three months ago would have no witness to it at
        all. The switch covers the warning; it does not cover the loss.
        """
        self._settings(usage_warnings=False)

        # The counting has its own tests in `apps.billing`; what is under test
        # here is the switch, so the number is handed over rather than built
        # out of a project, a bot and twelve contact rows.
        with mock.patch("apps.notifications.services.current_usage", return_value=12):
            with mock.patch("apps.notifications.services.publish"):
                notification = warn_about_usage(self.workspace, "contacts")

        self.assertIsNotNone(notification, "customers are being dropped; that is not a preference")
        self.assertIn("saqlanmayapti", notification.text)

    def test_the_contacts_notice_before_the_limit_is_still_a_preference(self):
        """80% is advice. Only the overrun is the thing that cannot be muted."""
        self._settings(usage_warnings=False)

        with mock.patch("apps.notifications.services.current_usage", return_value=9):
            self.assertIsNone(warn_about_usage(self.workspace, "contacts"))

    def test_a_silenced_warning_does_not_spend_the_day_it_was_never_said_in(self):
        """The 24-hour window is "how often the same sentence may be said", and
        a sentence that was never said has not been said. Switching the
        warnings back on this afternoon has to produce the notice for a limit
        that is still full — not a day of silence bought by a notice nobody
        received."""
        self._settings(usage_warnings=False)
        self._messages(120)
        self.assertIsNone(warn_about_usage(self.workspace, "messages"))

        self._settings(usage_warnings=True)
        cache.clear()  # the probe window, which is five minutes, not the notice window
        with mock.patch("apps.notifications.services.publish"):
            self.assertIsNotNone(warn_about_usage(self.workspace, "messages"))

    def test_the_switch_is_not_read_on_the_hot_path(self):
        """`warn_about_usage` is reached after every message the product sends.
        The probe throttle is what keeps a thirty-day `COUNT(*)` off that path,
        and a settings lookup in front of it would put a second query there
        instead — cheaper, and just as often."""
        self._settings(usage_warnings=False)
        self._messages(120)
        warn_about_usage(self.workspace, "messages")

        with CaptureQueriesContext(connection) as queries:
            for _ in range(50):
                warn_about_usage(self.workspace, "messages")

        self.assertEqual(len(queries), 0)


class NotificationSettingsEndpointTests(TestCase):
    """`/api/notification-settings/` — read by any member, written by the two
    roles that manage the workspace."""

    def setUp(self) -> None:
        self.owner, self.workspace = make_tenant("ws1", "ega@b.uz")
        self.editor = User.objects.create_user(
            email="muharrir@b.uz", password="Parol12345", name="Muharrir", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.editor, email=self.editor.email, role=Role.EDITOR
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _get(self, client=None):
        return (client or self.client).get("/api/notification-settings/", HTTP_X_WORKSPACE_ID="ws1")

    def _patch(self, body: dict, client=None):
        return (client or self.client).patch(
            "/api/notification-settings/", body, format="json", HTTP_X_WORKSPACE_ID="ws1"
        )

    def test_reading_it_answers_the_defaults_without_writing_a_row(self):
        """A GET that creates a row is a write, and this one is fetched by a
        page render — which runs more often than the reader asked for."""
        response = self._get()

        self.assertEqual(response.data, {"handoff": True, "usageWarnings": True})
        self.assertFalse(NotificationSettings.objects.exists())

    def test_an_owner_may_switch_one_off(self):
        response = self._patch({"usageWarnings": False})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {"handoff": True, "usageWarnings": False})
        self.assertFalse(NotificationSettings.objects.get(workspace=self.workspace).usage_warnings)

    def test_an_editor_may_read_it_and_may_not_change_it(self):
        """Same rule as the rest of the workspace's own settings — and stated,
        rather than left to a hidden control: an editor who is told "faqat
        ko'rish" knows to ask, and an editor whose switch simply does nothing
        files a bug."""
        client = APIClient()
        client.force_authenticate(self.editor)

        self.assertEqual(self._get(client).status_code, 200)
        response = self._patch({"handoff": False}, client)

        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(NotificationSettings.objects.exists())

    def test_another_workspace_cannot_be_reached_through_the_header(self):
        _, elsewhere = make_tenant("ws2", "boshqa@b.uz")

        response = self.client.patch(
            "/api/notification-settings/", {"handoff": False}, format="json", HTTP_X_WORKSPACE_ID="ws2"
        )

        self.assertEqual(response.status_code, 404, response.data)
        self.assertFalse(NotificationSettings.objects.filter(workspace=elsewhere).exists())

    def test_the_panel_and_the_api_name_the_unswitchable_notice_in_the_same_words(self):
        """One rule, one sentence. The screen has to say which notice the
        switch does not cover, and `ALWAYS_WARN` is where that is true — the
        two drifting apart is how a panel starts promising something the
        server does not do."""
        from pathlib import Path as _Path

        panel = (
            _Path(__file__).resolve().parents[3]
            / "frontend/src/features/notifications/components/NotificationSettingsPanel.tsx"
        )
        self.assertTrue(panel.exists(), panel)
        self.assertIn(ALWAYS_WARN_SENTENCE, panel.read_text(encoding="utf-8"))
        self.assertEqual(sorted(ALWAYS_WARN), ["contacts"], "the sentence names one limit; so must the rule")
