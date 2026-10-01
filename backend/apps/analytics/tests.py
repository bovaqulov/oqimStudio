"""Analytics tests — the report's shape, and that it counts only its own tenant."""

from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.analytics.models import Metric
from apps.analytics.services import build_report, parse_query, record_event, workspace_today
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace


class ReportTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(id="b", workspace=self.workspace, project=project, handle="@b")
        self.flow = Flow.objects.create(
            workspace=self.workspace, project=project, bot=self.bot, module_key="dms", name="Narx oqimi"
        )
        self.aziz = self._contact(1)

        for _ in range(3):
            record_event(flow=self.flow, contact=self.aziz, metric=Metric.CONVERSATION)
        record_event(flow=self.flow, contact=self.aziz, metric=Metric.CONVERSION)
        record_event(flow=self.flow, contact=self.aziz, metric=Metric.REVENUE, value=690000, currency="UZS")

    def _contact(self, telegram_user_id: int) -> Contact:
        return Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=telegram_user_id, chat_id=telegram_user_id
        )

    def test_the_funnel_counts_people_so_a_step_cannot_outgrow_the_one_above_it(self):
        """The report the audit read: 12 conversations, 18 taps, and "100%" under both.

        A tap is not a conversation and a conversation is not a person. Counting
        events, the third step was half again as wide as the first and the
        `min(100, …)` that used to sit in `build_report` printed it as a full
        bar — the same width as the step it was a share of.
        """
        for _ in range(9):  # twelve conversations between two people
            record_event(flow=self.flow, contact=self.aziz, metric=Metric.CONVERSATION)
        malika = self._contact(2)
        for _ in range(9):
            record_event(bot=self.bot, contact=malika, metric=Metric.CLICK)
        for _ in range(9):
            record_event(bot=self.bot, contact=self.aziz, metric=Metric.CLICK)

        report = build_report(self.workspace, parse_query({}, self.workspace))
        funnel = report["funnel"]

        self.assertEqual(report["totals"][Metric.CLICK], 18)
        self.assertEqual([step["label"] for step in funnel],
                         ["Suhbat boshlaganlar", "Tugma bosganlar", "Maqsadga yetganlar"])
        # Only Aziz has both a conversation and a tap; Malika tapped a keyboard
        # left over from a conversation this window does not contain.
        self.assertEqual([step["value"] for step in funnel], [1, 1, 1])
        self.assertEqual([step["percent"] for step in funnel], [100.0, 100.0, 100.0])

    def test_every_funnel_step_is_a_share_of_the_first_one_and_they_descend(self):
        for index in range(2, 6):  # four more people who only ever wrote
            record_event(flow=self.flow, contact=self._contact(index), metric=Metric.CONVERSATION)
        record_event(bot=self.bot, contact=self.aziz, metric=Metric.CLICK)

        funnel = build_report(self.workspace, parse_query({}, self.workspace))["funnel"]

        self.assertEqual([step["value"] for step in funnel], [5, 1, 1])
        self.assertEqual([step["percent"] for step in funnel], [100.0, 20.0, 20.0])
        self.assertEqual(sorted((step["percent"] for step in funnel), reverse=True),
                         [step["percent"] for step in funnel], "a funnel that goes back up is not a funnel")

    def test_an_event_with_nobody_behind_it_stays_out_of_the_funnel(self):
        """Seeded revenue carries no contact, and a funnel of people cannot place it."""
        record_event(flow=self.flow, metric=Metric.CONVERSATION)

        funnel = build_report(self.workspace, parse_query({}, self.workspace))["funnel"]

        self.assertEqual(funnel[0]["value"], 1, "the contactless conversation is counted in the totals, not here")

    def test_totals_and_the_flow_breakdown_agree(self):
        report = build_report(self.workspace, parse_query({}, self.workspace))

        self.assertEqual(report["totals"][Metric.CONVERSATION], 3)
        self.assertEqual(report["totals"][Metric.REVENUE], 690000)
        row = report["breakdown"]["flows"][0]
        self.assertEqual(row["label"], "Narx oqimi")
        self.assertEqual(row["metrics"][Metric.CONVERSATION], 3)
        self.assertEqual(row["conversionRate"], round(1 / 3 * 100, 1))

    def test_a_deleted_flow_is_named_as_one_rather_than_printed_as_its_id(self):
        """The audit read `e72a54639ce3bee5` at 91.7% of the traffic — a flow that is gone.

        Its events stay behind it, and `Flow.objects` cannot name a row that is
        no longer there, so the table fell back to the primary key and linked it
        to a page that answers 404.
        """
        gone = Flow.objects.create(
            workspace=self.workspace, project=self.flow.project, bot=self.bot, module_key="dms", name="O'chgan"
        )
        for _ in range(4):
            record_event(flow=gone, contact=self.aziz, metric=Metric.CONVERSATION)
        record_event(flow=gone, contact=self.aziz, metric=Metric.CLICK)
        gone_id = gone.id
        gone.delete()

        rows = build_report(self.workspace, parse_query({}, self.workspace))["breakdown"]["flows"]
        labels = [row["label"] for row in rows]
        row = next(row for row in rows if row["label"] == "O'chirilgan oqimlar")

        self.assertNotIn(gone_id, labels, "an id is not a name")
        self.assertNotIn("href", row, "a row nobody can open must not look like a link")
        self.assertEqual(row["metrics"][Metric.CONVERSATION], 4)

    def test_deleted_subjects_share_one_row_and_keep_all_of_their_numbers(self):
        for name in ("Birinchi", "Ikkinchi"):
            gone = Flow.objects.create(
                workspace=self.workspace, project=self.flow.project, bot=self.bot, module_key="dms", name=name
            )
            record_event(flow=gone, contact=self.aziz, metric=Metric.CONVERSATION)
            record_event(flow=gone, contact=self.aziz, metric=Metric.MESSAGE)
            gone.delete()

        rows = build_report(self.workspace, parse_query({}, self.workspace))["breakdown"]["flows"]
        deleted = [row for row in rows if row["label"] == "O'chirilgan oqimlar"]

        self.assertEqual(len(deleted), 1)
        # Two flows, one row: the second one's numbers used to replace the
        # first one's instead of being added to them.
        self.assertEqual(deleted[0]["metrics"][Metric.CONVERSATION], 2)
        self.assertEqual(deleted[0]["metrics"][Metric.MESSAGE], 2)

    def test_events_no_flow_ever_claimed_are_labelled_and_not_left_as_a_dash(self):
        """A tap is counted before anything decides which flow will answer it."""
        record_event(bot=self.bot, contact=self.aziz, metric=Metric.CLICK)

        rows = build_report(self.workspace, parse_query({}, self.workspace))["breakdown"]["flows"]
        row = next(row for row in rows if row["metrics"][Metric.CLICK])

        self.assertEqual(row["label"], "Oqimga bog'lanmagan")
        self.assertNotIn("href", row)

    def test_the_series_covers_every_day_of_the_window_even_the_empty_ones(self):
        # The workspace's calendar, not UTC's: events are stamped with the day
        # it was *there* (`workspace_today`), so a window built from the
        # server's date is a different seven days for five hours out of every
        # twenty-four — and the test failed exactly then.
        query = parse_query(
            {"from": (workspace_today(self.workspace) - timedelta(days=6)).isoformat()}, self.workspace
        )
        report = build_report(self.workspace, query)

        self.assertEqual(len(report["series"]), 7, "a chart with holes in it is not a chart")
        self.assertEqual(report["series"][-1]["metrics"][Metric.CONVERSATION], 3)

    def test_a_delta_against_nothing_is_null_not_zero_percent(self):
        report = build_report(self.workspace, parse_query({}, self.workspace))
        conversations = next(row for row in report["summary"] if row["key"] == Metric.CONVERSATION)
        self.assertIsNone(conversations["deltaPercent"])

    def test_the_endpoint_reports_only_the_callers_workspace(self):
        other_user = User.objects.create_user(email="b@b.uz", password="Parol12345", name="B", email_verified=True)
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=other_user)
        Membership.objects.create(workspace=other_ws, user=other_user, email=other_user.email, role=Role.OWNER)
        record_event(workspace=other_ws, metric=Metric.CONVERSATION)

        client = APIClient()
        client.force_authenticate(other_user)
        report = client.get("/api/analytics/").data

        self.assertEqual(report["totals"][Metric.CONVERSATION], 1, "the tenant comes from the session, not the query")
        self.assertEqual(report["currency"], other_ws.currency)

    def test_dimensions_are_built_from_the_workspaces_own_records(self):
        client = APIClient()
        client.force_authenticate(self.user)
        data = client.get("/api/analytics/dimensions/").data

        self.assertEqual([row["id"] for row in data["flows"]], [self.flow.id])
        self.assertEqual(len(data["channels"]), 5, "one per module")
