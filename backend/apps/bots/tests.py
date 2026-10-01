"""Bot API tests — connecting one, and keeping its token where it belongs."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

import requests
from django.db import connection
from pathlib import Path

from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.analytics.models import Event, Metric
from apps.analytics.services import record_event
from apps.billing.models import Plan, Subscription
from apps.bots import managed
from apps.bots.business import BUSINESS_RIGHT_FIELDS, business_problems
from apps.bots.chats import chat_problems
from apps.bots.models import (
    MODULE_KEYS,
    PAUSED_NOTE,
    Bot,
    BotChat,
    BusinessConnection,
    ManagedBotRequest,
    default_settings,
)
from apps.bots.serializers import BotSerializer
from apps.bots.services import (
    WEBHOOK_REFUSALS,
    check_webhook,
    log_activity,
    probe_webhook_endpoint,
    reconcile_webhook,
    register_webhook,
    webhook_url_for,
)
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.telegram.client import TelegramClient, TelegramError
from apps.workspaces.models import Membership, Role, Workspace


class BotApiTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(
            id="p", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_connecting_a_bot_stores_it_and_registers_its_webhook(self):
        # TELEGRAM_OFFLINE is on under the test settings: `getMe` answers with
        # the canned profile and `setWebhook` records instead of calling out.
        # The webhook is registered on commit — outside the transaction, so a
        # failed network call cannot roll the bot back — which is why the
        # callbacks have to be run for the test to see it.
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/bots/", {"projectId": self.project.id, "token": "123:ABC"}
            )

        self.assertEqual(response.status_code, 201, response.data)
        bot = Bot.objects.get()
        self.assertEqual(bot.handle, "@offline_bot")
        self.assertEqual(bot.enabled_modules, ["dms"])
        self.assertTrue(bot.webhook_url.endswith(f"/api/telegram/webhook/{bot.webhook_token}/"))
        self.assertTrue(bot.activity.filter(text="Webhook ulandi").exists())

    def test_the_token_is_never_in_a_bot_response(self):
        self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})
        bot = Bot.objects.get()

        row = self.client.get(f"/api/bots/{bot.id}/").data

        self.assertNotIn("token", row)
        self.assertEqual(row["tokenMasked"], bot.token_masked)
        self.assertIn("*", row["tokenMasked"], "the mask has to actually hide something")

    def test_revealing_the_token_is_its_own_endpoint_and_is_logged(self):
        self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})
        bot = Bot.objects.get()

        response = self.client.post(f"/api/bots/{bot.id}/reveal-token/")

        self.assertEqual(response.data["token"], "123:ABC")
        self.assertTrue(bot.activity.filter(text__startswith="Token ko'rsatildi").exists())

    def test_an_analyst_may_read_bots_but_not_connect_one(self):
        analyst = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        self.assertEqual(client.get("/api/bots/").status_code, 200)
        self.assertEqual(
            client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"}).status_code, 403
        )

    def test_a_bot_cannot_be_moved_into_another_workspaces_project(self):
        self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})
        bot = Bot.objects.get()
        other = User.objects.create_user(email="e@b.uz", password="Parol12345", name="E")
        other_ws = Workspace.objects.create(id="ws3", name="WS3", slug="ws3", owner=other)
        foreign = Project.objects.create(id="p3", workspace=other_ws, name="P3", handle="p3")

        response = self.client.patch(f"/api/bots/{bot.id}/", {"projectId": foreign.id})

        self.assertEqual(response.status_code, 404)
        bot.refresh_from_db()
        self.assertEqual(bot.project_id, self.project.id, "a bot leaving its tenant takes its flows with it")

    def test_a_project_from_another_workspace_cannot_be_borrowed(self):
        other = User.objects.create_user(email="d@b.uz", password="Parol12345", name="D")
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=other)
        foreign = Project.objects.create(id="p2", workspace=other_ws, name="P2", handle="p2")

        response = self.client.post("/api/bots/", {"projectId": foreign.id, "token": "123:ABC"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Bot.objects.count(), 0)


class BotListCostTests(TestCase):
    """A list of bots must not pay per row for numbers it does not show."""

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _bot(self, key: str) -> Bot:
        return Bot.objects.create(
            id=key, workspace=self.workspace, project=self.project, handle=f"@{key}", token="t"
        )

    def test_a_longer_list_does_not_cost_more_queries(self):
        self._bot("one")
        with CaptureQueriesContext(connection) as one_row:
            self.client.get("/api/bots/")

        for key in ("two", "three", "four"):
            self._bot(key)
        with CaptureQueriesContext(connection) as four_rows:
            self.client.get("/api/bots/")

        self.assertEqual(len(four_rows), len(one_row))

    def test_the_detail_view_carries_the_activity_trail_and_no_counters(self):
        """`metrics` is gone, and its going is the point of this test.

        It was two `COUNT`s over the event log on every read of a bot, for one
        folded section under the flow list — «Ko'rsatkichlar va faoliyat» — that
        printed an hour's conversations beside a link to `/analytics`, which is
        where those numbers are properly answered and answered better. The
        section is gone, and nothing else ever read them: the two places in the
        panel that mention `bot.metrics[0]` are fed by the *list* endpoint,
        which has never sent the field at all.

        `activity` stays and is read on the bot's own Sozlamalar screen. It is
        the audit trail — who revealed the token, who stopped the bot, why a
        webhook was refused — and it is one query, not one per row.
        """
        bot = self._bot("one")
        row = self.client.get(f"/api/bots/{bot.id}/").data

        self.assertNotIn("metrics", row)
        self.assertIn("activity", row)
        self.assertNotIn("activity", self.client.get("/api/bots/").data["results"][0])

    def test_reading_a_bot_does_not_count_events(self):
        """The cost, rather than the field — a serializer method added back
        under another name would pass the assertion above and not this one."""
        bot = self._bot("one")
        with CaptureQueriesContext(connection) as queries:
            self.client.get(f"/api/bots/{bot.id}/")

        counted = [q["sql"] for q in queries.captured_queries if "analytics_event" in q["sql"]]
        self.assertEqual(counted, [])


class PaymentConnectionTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_provider_can_be_connected_rechecked_and_disconnected(self):
        created = self.client.post(
            f"/api/bots/{self.bot.id}/payments/", {"providerId": "click", "token": "PROVIDER:4242", "mode": "test"}
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["tokenMasked"], "•••• 4242")
        self.assertNotIn("token", created.data, "a provider token does not come back out")

        rechecked = self.client.post(f"/api/bots/{self.bot.id}/payments/click/")
        self.assertEqual(rechecked.status_code, 200)
        self.assertIsNotNone(rechecked.data["lastCheckedAt"])

        removed = self.client.delete(f"/api/bots/{self.bot.id}/payments/click/")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(self.client.get(f"/api/bots/{self.bot.id}/payments/").data, [])

    def test_an_unknown_provider_is_a_404(self):
        self.assertEqual(self.client.delete(f"/api/bots/{self.bot.id}/payments/yoq/").status_code, 404)


class PaymentHistoryTests(TestCase):
    """The takings panel: read back out of the event log, not out of a table."""

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(id="b", workspace=self.workspace, project=self.project, handle="@b", token="t")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _paid(self, contact, value, currency="UZS", hours_ago=0):
        event = record_event(bot=self.bot, contact=contact, metric=Metric.REVENUE, value=value, currency=currency)
        # Stamped explicitly rather than left on `timezone.now()`: two rows
        # written in the same test tick can only be ordered by luck otherwise,
        # and "newest first" is the one thing this endpoint promises.
        Event.objects.filter(pk=event.pk).update(occurred_at=timezone.now() - timedelta(hours=hours_ago))
        return event

    def test_the_history_is_this_bots_payments_newest_first_with_the_payer_named(self):
        aziza = Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=1, chat_id=1, first_name="Aziza"
        )
        jasur = Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=2, chat_id=2, username="jasur"
        )
        self._paid(aziza, 690000, hours_ago=3)
        self._paid(jasur, 7, currency="XTR")
        # A tap and a conversion sit in the same log against the same bot, and
        # neither is money that moved.
        record_event(bot=self.bot, contact=aziza, metric=Metric.CLICK)
        record_event(bot=self.bot, contact=aziza, metric=Metric.CONVERSION)
        # Another bot's takings are another bot's screen.
        other = Bot.objects.create(id="b2", workspace=self.workspace, project=self.project, handle="@b2")
        record_event(bot=other, contact=aziza, metric=Metric.REVENUE, value=15000, currency="UZS")

        rows = self.client.get(f"/api/bots/{self.bot.id}/payment-history/").data

        self.assertEqual([row["amount"] for row in rows], [7.0, 690000.0])
        self.assertEqual([row["contactName"] for row in rows], ["@jasur", "Aziza"])
        self.assertEqual([row["currency"] for row in rows], ["XTR", "UZS"])

    def test_a_payment_outlives_the_contact_who_made_it(self):
        contact = Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=1, chat_id=1, first_name="Aziza"
        )
        self._paid(contact, 690000)
        contact.delete()

        rows = self.client.get(f"/api/bots/{self.bot.id}/payment-history/").data

        # The money moved whether or not the row that names the payer survived.
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["amount"], 690000.0)
        self.assertEqual(rows[0]["contactName"], "Noma'lum mijoz")

    def test_the_payer_lookup_does_not_grow_with_the_page(self):
        for index in range(6):
            contact = Contact.objects.create(
                workspace=self.workspace, bot=self.bot, telegram_user_id=index, chat_id=index, first_name=f"C{index}"
            )
            self._paid(contact, 1000 + index, hours_ago=index)

        with CaptureQueriesContext(connection) as queries:
            rows = self.client.get(f"/api/bots/{self.bot.id}/payment-history/").data

        self.assertEqual(len(rows), 6)
        # Six payers, one lookup: a name per row is how a payments panel turns
        # into fifty queries the day the bot starts selling.
        self.assertEqual(sum(1 for query in queries if "contacts_contact" in query["sql"]), 1)

    def test_another_workspaces_bot_is_a_404_rather_than_an_empty_history(self):
        stranger = User.objects.create_user(email="c@d.uz", password="Parol12345", name="Jasur", email_verified=True)
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=stranger)
        Membership.objects.create(workspace=other_ws, user=stranger, email=stranger.email, role=Role.OWNER)
        client = APIClient()
        client.force_authenticate(stranger)

        response = client.get(f"/api/bots/{self.bot.id}/payment-history/", HTTP_X_WORKSPACE_ID=other_ws.id)

        self.assertEqual(response.status_code, 404)


class TokenVerificationTests(TestCase):
    """A token nobody checked must not look like a connected bot."""

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_token_telegram_refuses_never_becomes_a_bot(self):
        from apps.telegram.client import TelegramError

        with mock.patch(
            "apps.telegram.client.TelegramClient.call",
            side_effect=TelegramError("getMe", "Unauthorized", 401),
        ):
            with self.settings(TELEGRAM_OFFLINE=False):
                response = self.client.post(
                    "/api/bots/", {"projectId": self.project.id, "token": "123456789:AAHsoxta-token-emas-xolos"}
                )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_token")
        self.assertEqual(response.data["error"]["field"], "token")
        self.assertEqual(Bot.objects.count(), 0, "an unproven token must leave nothing behind")

    def test_offline_mode_stores_the_bot_as_unverified(self):
        # TELEGRAM_OFFLINE answers `getMe` locally, so nothing was checked. The
        # bot may exist, but it may not claim to be live.
        response = self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], {"label": "Sozlanmoqda", "tone": "warning"})
        bot = Bot.objects.get()
        self.assertTrue(bot.activity.filter(text__startswith="Offline rejim").exists())


class WebhookAddressTests(TestCase):
    """The webhook follows the public address, and repairs itself when it moves."""

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b",
            workspace=self.workspace,
            project=self.project,
            handle="@b",
            token="t",
            webhook_url="https://eski-manzil.example/api/telegram/webhook/b/",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_the_reported_url_is_the_current_one_not_the_stored_one(self):
        with self.settings(PUBLIC_BASE_URL="https://yangi-manzil.example"):
            data = self.client.get(f"/api/bots/{self.bot.id}/").data

        self.assertEqual(
            data["webhookUrl"],
            f"https://yangi-manzil.example/api/telegram/webhook/{self.bot.webhook_token}/",
        )

    def test_opening_the_bot_re_registers_a_webhook_that_moved(self):
        with self.settings(PUBLIC_BASE_URL="https://yangi-manzil.example"):
            data = self.client.get(f"/api/bots/{self.bot.id}/").data

        self.bot.refresh_from_db()
        self.assertEqual(
            self.bot.webhook_url,
            f"https://yangi-manzil.example/api/telegram/webhook/{self.bot.webhook_token}/",
        )
        self.assertTrue(data["webhookRegistered"], "silently pointing at yesterday's domain is how a bot goes quiet")

    def test_a_webhook_already_pointing_here_is_left_alone(self):
        with self.settings(PUBLIC_BASE_URL="https://manzil.example"):
            self.client.get(f"/api/bots/{self.bot.id}/")
            before = self.bot.activity.count() + 1
            with mock.patch("apps.bots.services.register_webhook") as register:
                self.client.get(f"/api/bots/{self.bot.id}/")

        register.assert_not_called()
        self.assertGreaterEqual(before, 1)


class WebhookReconcileTests(TestCase):
    """The webhook the panel claims and the one Telegram holds must be the same one."""

    def setUp(self) -> None:
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=project, handle="@b", token="1:x", enabled_modules=["dms"]
        )
        self.expected = webhook_url_for(self.bot)
        self.bot.webhook_url = self.expected
        self.bot.save(update_fields=["webhook_url"])

    def _info(self, url: str, **extra):
        return {"url": url, "pending_update_count": 0, **extra}

    def test_a_webhook_pointing_elsewhere_is_re_registered(self):
        """Somebody moved it by hand, or a tunnel handed out a new name."""
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info("https://eski.example/x")):
            with mock.patch.object(TelegramClient, "set_webhook", return_value=True) as set_webhook:
                result = reconcile_webhook(self.bot)

        self.assertTrue(result["changed"])
        set_webhook.assert_called_once()
        self.assertEqual(set_webhook.call_args.args[0], self.expected)

    def test_an_agreeing_webhook_is_left_alone(self):
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info(self.expected)):
            with mock.patch.object(TelegramClient, "set_webhook") as set_webhook:
                result = reconcile_webhook(self.bot)

        self.assertFalse(result["changed"])
        set_webhook.assert_not_called()

    def test_the_screen_reports_telegrams_answer_not_our_column(self):
        """Our column said "connected" while the bot received nothing — that is the bug."""
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info("https://boshqa.example/x")):
            check_webhook(self.bot)

        self.bot.refresh_from_db()
        data = BotSerializer(self.bot).data
        self.assertFalse(data["webhookRegistered"], "the stored url still matches; Telegram's does not")
        self.assertIn("boshqa.example", data["webhookActualUrl"])
        self.assertTrue(data["webhookError"])

    def test_telegrams_delivery_error_reaches_the_screen(self):
        info = self._info(self.expected, last_error_message="Read timeout", last_error_date=1_700_000_000,
                          pending_update_count=7)
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=info):
            check_webhook(self.bot)

        data = BotSerializer(self.bot).data
        self.assertEqual(data["webhookError"], "Server javob bermadi — so'rov vaqti tugadi.")
        self.assertEqual(data["webhookPending"], 7)
        self.assertIsNotNone(data["webhookLastErrorAt"], "when it failed is half the diagnosis")

    def test_the_workspace_button_reports_what_it_fixed(self):
        client = APIClient()
        client.force_authenticate(self.workspace.owner)

        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info("https://eski.example/x")):
            with mock.patch.object(TelegramClient, "set_webhook", return_value=True):
                response = client.post("/api/bots/reconcile-webhooks/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["checked"], 1)
        self.assertEqual(response.data["changed"], 1)


class WebhookActivityTests(TestCase):
    """What the bot's feed is allowed to say, and how often it may say it."""

    def setUp(self) -> None:
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=project, handle="@b", token="1:x", enabled_modules=["dms"]
        )
        self.expected = webhook_url_for(self.bot)
        self.bot.webhook_url = self.expected
        self.bot.save(update_fields=["webhook_url"])

    def _info(self, url: str, **extra):
        return {"url": url, "pending_update_count": 0, **extra}

    def test_the_same_line_three_times_is_one_line_that_says_three(self):
        """1811 rows of one sentence is what this feed actually held."""
        for _ in range(3):
            log_activity(self.bot, "Webhook ulanmadi. Token qabul qilinmadi", "warning")

        entries = list(self.bot.activity.all())

        self.assertEqual(len(entries), 1, "eight identical rows is the whole panel saying one thing")
        self.assertEqual(entries[0].text, "Webhook ulanmadi. Token qabul qilinmadi · 3 marta")

    def test_a_different_line_is_a_row_of_its_own(self):
        log_activity(self.bot, "Webhook ulandi", "plugs-connected")
        log_activity(self.bot, "Webhook uzildi", "plugs")
        log_activity(self.bot, "Webhook ulandi", "plugs-connected")

        self.assertEqual([entry.text for entry in self.bot.activity.all()],
                         ["Webhook ulandi", "Webhook uzildi", "Webhook ulandi"])

    def test_a_collapsed_line_carries_the_time_it_last_happened(self):
        first = log_activity(self.bot, "Webhook ulanmadi. Token qabul qilinmadi", "warning")
        was = first.created_at
        log_activity(self.bot, "Webhook ulanmadi. Token qabul qilinmadi", "warning")

        first.refresh_from_db()
        self.assertGreater(first.created_at, was, "a feed ordered by time must not park a live fault in the past")

    def test_telegrams_refusal_reaches_the_feed_in_the_panels_own_language(self):
        refused = TelegramError("setWebhook", "Unauthorized", 401)
        with mock.patch.object(TelegramClient, "set_webhook", side_effect=refused):
            register_webhook(self.bot)

        line = self.bot.activity.first()
        self.assertNotIn("Unauthorized", line.text, "half an Uzbek sentence and half an English one")
        self.assertIn("@BotFather", line.text, "a refusal the reader can act on names the next step")
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.webhook_error, WEBHOOK_REFUSALS[401])

    def test_a_rate_limited_registration_waits_the_second_telegram_asked_for(self):
        """"Too Many Requests: retry after 1", sixty-eight times, is a wait nobody took."""
        refused = TelegramError("setWebhook", "Too Many Requests: retry after 1", 429)
        with mock.patch.object(TelegramClient, "set_webhook", side_effect=[refused, True]) as set_webhook:
            with mock.patch("apps.bots.services.time.sleep") as slept:
                registered = register_webhook(self.bot)

        self.assertTrue(registered)
        slept.assert_called_once_with(1.0)
        self.assertEqual(set_webhook.call_count, 2)
        self.assertEqual([entry.text for entry in self.bot.activity.all()], ["Webhook ulandi"])

    def test_a_wait_longer_than_the_ceiling_is_left_to_the_next_pass(self):
        refused = TelegramError("setWebhook", "Too Many Requests: retry after 60", 429)
        with mock.patch.object(TelegramClient, "set_webhook", side_effect=refused) as set_webhook:
            with mock.patch("apps.bots.services.time.sleep") as slept:
                registered = register_webhook(self.bot)

        self.assertFalse(registered)
        slept.assert_not_called()
        self.assertEqual(set_webhook.call_count, 1, "somebody is watching a button spin while this runs")

    def test_a_moved_address_is_not_written_into_the_feed_as_an_incident(self):
        """The tunnel renamed itself. `reconcile_webhook` fixes it in the same pass."""
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info("https://eski.example/x")):
            with mock.patch.object(TelegramClient, "set_webhook", return_value=True):
                reconcile_webhook(self.bot)

        texts = [entry.text for entry in self.bot.activity.all()]
        self.assertEqual(texts, ["Webhook ulandi"], texts)

    def test_a_delivery_telegram_could_not_make_is_still_written_down(self):
        info = self._info(self.expected, last_error_message="Wrong response from the webhook: 530 <none>",
                          last_error_date=1_700_000_000)
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=info):
            check_webhook(self.bot)

        line = self.bot.activity.first()
        self.assertIsNotNone(line, "the bot going silent is exactly what this feed is for")
        self.assertNotIn("Wrong response", line.text)
        self.assertEqual(line.icon, "warning")


class WebhookReachabilityTests(TestCase):
    """A URL Telegram has on file is not the same claim as a bot receiving messages."""

    def setUp(self) -> None:
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(id="b", workspace=self.workspace, project=project, handle="@b", token="1:x")
        self.expected = webhook_url_for(self.bot)
        self.bot.webhook_url = self.expected
        self.bot.save(update_fields=["webhook_url"])
        self.client = APIClient()
        self.client.force_authenticate(user)

    def _info(self, **extra):
        return {"url": self.expected, "pending_update_count": 0, **extra}

    def test_a_refusal_from_our_own_endpoint_still_proves_it_is_reachable(self):
        """The webhook takes POSTs carrying Telegram's secret and nothing else — 405 is health."""
        with self.settings(TELEGRAM_OFFLINE=False):
            with mock.patch("apps.bots.services.requests.head", return_value=mock.Mock(status_code=405)):
                probe = probe_webhook_endpoint(self.expected)

        self.assertTrue(probe["checked"])
        self.assertTrue(probe["reachable"])
        self.assertEqual(probe["status"], 405)

    def test_a_connection_that_never_landed_is_unreachable(self):
        """The dead tunnel: both URLs agree and nothing is listening at either end."""
        refused = requests.ConnectionError("Connection refused")
        with self.settings(TELEGRAM_OFFLINE=False):
            with mock.patch("apps.bots.services.requests.head", side_effect=refused):
                with mock.patch("apps.bots.services.requests.get", side_effect=refused):
                    probe = probe_webhook_endpoint(self.expected)

        self.assertTrue(probe["checked"])
        self.assertFalse(probe["reachable"])
        self.assertIn("refused", probe["error"])

    def test_a_front_that_refuses_head_is_asked_again_with_get(self):
        with self.settings(TELEGRAM_OFFLINE=False):
            with mock.patch("apps.bots.services.requests.head", side_effect=requests.ConnectionError("no HEAD")):
                with mock.patch("apps.bots.services.requests.get", return_value=mock.Mock(status_code=200)) as get:
                    probe = probe_webhook_endpoint(self.expected)

        get.assert_called_once()
        self.assertTrue(probe["reachable"])

    def test_offline_mode_says_unchecked_rather_than_dead(self):
        """Nothing left the machine, so "unreachable" would be a false claim of its own."""
        probe = probe_webhook_endpoint(self.expected)

        self.assertFalse(probe["checked"])
        self.assertEqual(probe["error"], "")

    def test_the_check_endpoint_reports_every_field_telegram_sent(self):
        info = self._info(last_error_message="Read timeout", last_error_date=1_700_000_000, pending_update_count=4)
        with mock.patch.object(TelegramClient, "get_webhook_info", return_value=info):
            payload = self.client.get(f"/api/bots/{self.bot.id}/webhook/").data

        self.assertFalse(payload["ok"])
        # Telegram's own "Read timeout", said the way the rest of the panel
        # speaks — the raw wording stays in the server log.
        self.assertEqual(payload["error"], "Server javob bermadi — so'rov vaqti tugadi.")
        self.assertEqual(payload["pending"], 4)
        self.assertIsNotNone(payload["lastErrorAt"], "when it failed is half the diagnosis")
        self.assertEqual(payload["actualUrl"], self.expected)
        self.assertIn("probe", payload, "a green answer has to say whether the address answered")

    def test_the_check_endpoint_dials_the_address(self):
        with self.settings(TELEGRAM_OFFLINE=False):
            with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info()):
                with mock.patch("apps.bots.services.requests.head", return_value=mock.Mock(status_code=405)) as head:
                    payload = self.client.get(f"/api/bots/{self.bot.id}/webhook/").data

        head.assert_called_once_with(self.expected, timeout=mock.ANY, allow_redirects=True)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["probe"]["reachable"])

    def test_the_unattended_check_does_not_dial_anything(self):
        """`check_webhooks` runs hourly for every bot; the probe belongs to the button."""
        with self.settings(TELEGRAM_OFFLINE=False):
            with mock.patch.object(TelegramClient, "get_webhook_info", return_value=self._info()):
                with mock.patch("apps.bots.services.requests.head") as head:
                    result = check_webhook(self.bot)

        head.assert_not_called()
        self.assertFalse(result["probe"]["checked"])


class BotLanguageSettingsTests(TestCase):
    """Which languages a bot speaks — edited on the settings screen, read by the runtime."""

    def setUp(self) -> None:
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(id="b", workspace=self.workspace, project=project, handle="@b", token="1:x")
        self.client = APIClient()
        self.client.force_authenticate(user)

    def test_a_new_bot_speaks_uzbek_and_russian(self):
        row = self.client.get(f"/api/bots/{self.bot.id}/").data

        self.assertEqual(row["settings"]["languages"], {"main": "uz", "enabled": ["uz", "ru"]})

    def test_a_bot_connected_before_the_setting_existed_still_has_one(self):
        # The whole reason this is merged on read: there is no migration, and a
        # bot whose `languages` key is missing must not answer nobody.
        Bot.objects.filter(pk=self.bot.pk).update(settings={"displayName": "Eski bot"})
        self.bot.refresh_from_db()

        self.assertEqual(self.bot.languages, {"main": "uz", "enabled": ["uz", "ru"]})
        self.assertEqual(self.bot.main_language, "uz")

    def test_the_settings_screen_can_change_them(self):
        payload = {**self.bot.settings, "languages": {"main": "ru", "enabled": ["ru", "uz", "en"]}}

        response = self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.languages, {"main": "ru", "enabled": ["ru", "uz", "en"]})

    def test_the_main_language_is_spoken_even_if_the_list_forgets_it(self):
        payload = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["ru"]}}

        self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.bot.refresh_from_db()
        self.assertEqual(self.bot.languages["enabled"], ["uz", "ru"], "a bot must speak its own language")

    def test_a_language_the_runtime_does_not_have_is_refused(self):
        payload = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["uz", "de"]}}

        response = self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.assertEqual(response.status_code, 400, "text stored under it would be invisible, not wrong")
        self.assertIn("de", str(response.data))

    def test_a_fourth_language_is_refused(self):
        payload = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["uz", "ru", "en", "kk"]}}

        response = self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_a_repeated_language_is_stored_once(self):
        payload = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["uz", "uz", "ru"]}}

        self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.bot.refresh_from_db()
        self.assertEqual(self.bot.languages["enabled"], ["uz", "ru"])

    def test_the_repaired_shape_is_what_reaches_the_database(self):
        payload = {**self.bot.settings, "languages": {"main": "en", "enabled": ["ru"]}}

        self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.bot.refresh_from_db()
        self.assertEqual(
            self.bot.settings["languages"]["enabled"],
            ["en", "ru"],
            "read-time repair is a safety net, not the place the fix lives",
        )

    def test_the_rest_of_the_settings_are_left_alone(self):
        payload = {**self.bot.settings, "displayName": "Sunrise", "languages": {"main": "ru", "enabled": ["ru"]}}

        self.client.patch(f"/api/bots/{self.bot.id}/", {"settings": payload}, format="json")

        self.bot.refresh_from_db()
        self.assertEqual(self.bot.settings["displayName"], "Sunrise")
        self.assertEqual(self.bot.settings["avatarEmoji"], "🤖")


class ScriptLibraryTests(TestCase):
    """The bot's shared Kod source: who may read it, who may write it, and how
    much of it there may be.

    What it *does* — being prepended to every block — belongs to
    `apps/engine/tests/test_compose.py`. This is the endpoint: the shape the
    panel reads, the roles, and the ceiling.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def url(self, bot_id: str | None = None) -> str:
        return f"/api/bots/{bot_id or self.bot.id}/script-library/"

    def test_a_library_nobody_has_saved_reports_no_save(self):
        """The bot's own `updated_at` moves for a rotated token, so borrowing it
        would print "saqlandi: hozir" under an editor nobody has opened."""
        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["source"], "")
        self.assertIsNone(response.data["updatedAt"])

    def test_saving_is_what_sets_the_timestamp(self):
        saved = self.client.put(self.url(), {"source": "const a = 1;"}, format="json")

        self.assertTrue(saved.data["updatedAt"], "the panel has a «saqlandi» line to fill")
        self.assertEqual(self.client.get(self.url()).data["updatedAt"], saved.data["updatedAt"])

    def test_what_is_saved_is_what_comes_back(self):
        source = "function chegirma(narx) {\n  return narx > 100000 ? 10 : 0;\n}"

        saved = self.client.put(self.url(), {"source": source}, format="json")

        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["source"], source)
        self.assertEqual(self.client.get(self.url()).data["source"], source)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, source)

    def test_the_library_can_be_cleared(self):
        self.client.put(self.url(), {"source": "const a = 1;"}, format="json")

        self.client.put(self.url(), {"source": ""}, format="json")

        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, "")

    def test_a_payload_with_no_source_is_refused_rather_than_read_as_empty(self):
        """A missing key taken for "" is how an autosave with a bug in it
        erases work nobody asked it to touch."""
        self.client.put(self.url(), {"source": "const a = 1;"}, format="json")

        response = self.client.put(self.url(), {}, format="json")

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "source_required")
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, "const a = 1;")

    def test_an_oversized_library_is_refused_with_a_code_the_panel_knows(self):
        response = self.client.put(self.url(), {"source": "//" + "x" * 50_000}, format="json")

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_library_too_long")
        self.assertEqual(response.data["error"]["field"], "source")
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, "")

    def test_an_analyst_may_read_the_library_but_not_write_it(self):
        analyst = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        self.assertEqual(client.get(self.url()).status_code, 200)
        self.assertEqual(client.put(self.url(), {"source": "const a = 1;"}, format="json").status_code, 403)

    def test_an_editor_may_write_it(self):
        editor = User.objects.create_user(email="d@b.uz", password="Parol12345", name="D", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=editor, email=editor.email, role=Role.EDITOR)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.put(self.url(), {"source": "const a = 1;"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)

    def test_another_workspaces_bot_is_not_there_to_read_or_write(self):
        other = User.objects.create_user(email="e@b.uz", password="Parol12345", name="E", email_verified=True)
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=other)
        Membership.objects.create(workspace=other_ws, user=other, email=other.email, role=Role.OWNER)
        client = APIClient()
        client.force_authenticate(other)

        self.assertEqual(client.get(self.url()).status_code, 404)
        self.assertEqual(client.put(self.url(), {"source": "x"}, format="json").status_code, 404)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, "")


class BotChatApiTests(TestCase):
    """«Guruh va kanallar» as its readers see it.

    The list is filled by the webhook (`apps.engine.tests.test_chats` pins that
    half); what is asserted here is the screen's own three questions — what is
    on the list, what is wrong with each row, and who may press the buttons.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(
            id="p", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="b",
            workspace=self.workspace,
            project=self.project,
            handle="@b",
            token="t",
            telegram_id=1,
            enabled_modules=["dms", "groups", "channels"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def chat(self, **fields) -> BotChat:
        return BotChat.objects.create(
            bot=self.bot,
            chat_id=fields.pop("chat_id", -1001),
            type=fields.pop("type", BotChat.Type.SUPERGROUP),
            title=fields.pop("title", "Sunrise guruh"),
            status=fields.pop("status", BotChat.Status.ADMINISTRATOR),
            rights=fields.pop("rights", {"can_delete_messages": True, "can_invite_users": True}),
            **fields,
        )

    def test_the_list_names_the_chat_and_what_the_bot_is_in_it(self):
        self.chat(member_count=42, member_count_at=timezone.now())

        row = self.client.get("/api/bots/b/chats/").data[0]

        self.assertEqual(row["chatId"], -1001)
        self.assertEqual(row["title"], "Sunrise guruh")
        self.assertEqual(row["status"], "administrator")
        self.assertTrue(row["isAdministrator"])
        self.assertEqual(row["memberCount"], 42)
        self.assertEqual(row["moduleKey"], "groups")
        self.assertEqual(row["problems"], [])

    def test_a_bot_that_is_not_an_administrator_is_told_what_that_costs(self):
        self.chat(status=BotChat.Status.MEMBER, rights={})

        codes = [problem["code"] for problem in self.client.get("/api/bots/b/chats/").data[0]["problems"]]

        # Telegram's privacy mode: a plain member sees commands and replies to
        # itself and nothing else, so a keyword flow in that group never fires.
        self.assertEqual(codes, ["not_admin"])

    def test_a_channel_without_the_posting_right_is_the_first_thing_said(self):
        self.chat(chat_id=-1002, type=BotChat.Type.CHANNEL, title="Kanal", rights={"can_delete_messages": True})

        problem = self.client.get("/api/bots/b/chats/").data[0]["problems"][0]

        self.assertEqual(problem["code"], "cannot_post")
        self.assertEqual(problem["tone"], "danger")

    def test_the_module_being_off_is_reported_on_the_chat_it_silences(self):
        self.bot.enabled_modules = ["dms"]
        self.bot.save(update_fields=["enabled_modules"])
        self.chat()

        codes = [problem["code"] for problem in self.client.get("/api/bots/b/chats/").data[0]["problems"]]

        # Every right in place and the dispatcher still never looks for a flow.
        # It is the one cause that is ours rather than Telegram's, so it leads.
        self.assertEqual(codes[0], "module_off")

    def test_a_removed_bot_stays_on_the_list_and_says_only_that(self):
        self.chat(status=BotChat.Status.KICKED, left_at=timezone.now(), rights={})

        row = self.client.get("/api/bots/b/chats/").data[0]

        self.assertFalse(row["isMember"])
        # One finding, not four: "the bot was thrown out" makes every question
        # about its rights in there moot.
        self.assertEqual([problem["code"] for problem in row["problems"]], ["removed"])

    def test_a_refresh_that_telegram_refused_keeps_what_was_already_known(self):
        chat = self.chat(title="Sunrise guruh", member_count=42, member_count_at=timezone.now())

        with mock.patch(
            "apps.telegram.client.TelegramClient.call",
            side_effect=TelegramError("getChat", "Too Many Requests", 429),
        ):
            row = self.client.post("/api/bots/b/chats/-1001/refresh/").data

        # A screen that emptied itself because one call timed out would be
        # telling its reader the bot had been thrown out of a live group.
        self.assertEqual(row["title"], "Sunrise guruh")
        self.assertEqual(row["memberCount"], 42)
        self.assertEqual(row["status"], "administrator")
        self.assertEqual([problem["code"] for problem in row["problems"]], ["stale"])
        chat.refresh_from_db()
        self.assertIn("Too Many Requests", chat.refresh_error)

    def test_a_403_is_telegram_saying_the_bot_is_no_longer_there(self):
        self.chat()

        with mock.patch(
            "apps.telegram.client.TelegramClient.call",
            side_effect=TelegramError("getChat", "Forbidden: bot is not a member of the supergroup chat", 403),
        ):
            row = self.client.post("/api/bots/b/chats/-1001/refresh/").data

        # The one refusal that carries a fact. Filed as an error instead, the
        # panel would show the bot as an administrator of a group that had
        # removed it while the webhook was down.
        self.assertFalse(row["isMember"])
        self.assertEqual([problem["code"] for problem in row["problems"]], ["removed"])

    def test_a_refresh_writes_back_what_telegram_says(self):
        self.chat(title="Eski nom", member_count=1)

        answers = {
            "getChat": {
                "id": -1001,
                "type": "supergroup",
                "title": "Yangi nom",
                "username": "sunrise",
                "join_by_request": True,
            },
            "getChatMemberCount": 250,
            "getChatMember": {"status": "administrator", "can_delete_messages": True, "can_invite_users": False},
        }
        with mock.patch(
            "apps.telegram.client.TelegramClient.call",
            side_effect=lambda method, payload=None: answers[method],
        ):
            row = self.client.post("/api/bots/b/chats/-1001/refresh/").data

        self.assertEqual(row["title"], "Yangi nom")
        self.assertEqual(row["username"], "sunrise")
        self.assertEqual(row["memberCount"], 250)
        self.assertTrue(row["joinByRequest"])
        # Approval is switched on for this group and the bot cannot approve —
        # the one case where the missing right is worth saying out loud.
        self.assertEqual([problem["code"] for problem in row["problems"]], ["cannot_approve"])

    def test_a_member_count_telegram_declines_does_not_erase_the_last_one(self):
        self.chat(member_count=42, member_count_at=timezone.now())

        def answer(method, payload=None):
            if method == "getChatMemberCount":
                raise TelegramError("getChatMemberCount", "Bad Request: not enough rights", 400)
            return {"id": -1001, "type": "supergroup", "title": "Sunrise guruh"} if method == "getChat" else {
                "status": "member"
            }

        with mock.patch("apps.telegram.client.TelegramClient.call", side_effect=answer):
            row = self.client.post("/api/bots/b/chats/-1001/refresh/").data

        # A demotion takes away the right to ask, which must not turn the group
        # into one that reads as empty.
        self.assertEqual(row["memberCount"], 42)

    def test_removing_a_chat_only_forgets_the_row(self):
        self.chat()

        response = self.client.delete("/api/bots/b/chats/-1001/")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(BotChat.objects.count(), 0)

    def test_an_unknown_chat_is_a_404(self):
        self.assertEqual(self.client.post("/api/bots/b/chats/-9999/refresh/").status_code, 404)
        self.assertEqual(self.client.delete("/api/bots/b/chats/-9999/").status_code, 404)

    def test_an_analyst_may_read_the_list_but_not_touch_it(self):
        self.chat()
        analyst = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        self.assertEqual(len(client.get("/api/bots/b/chats/").data), 1)
        self.assertEqual(client.post("/api/bots/b/chats/-1001/refresh/").status_code, 403)
        self.assertEqual(client.delete("/api/bots/b/chats/-1001/").status_code, 403)

    def test_another_workspaces_bot_has_no_chats_to_read_or_remove(self):
        self.chat()
        other = User.objects.create_user(email="e@b.uz", password="Parol12345", name="E", email_verified=True)
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=other)
        Membership.objects.create(workspace=other_ws, user=other, email=other.email, role=Role.OWNER)
        client = APIClient()
        client.force_authenticate(other)

        self.assertEqual(client.get("/api/bots/b/chats/").status_code, 404)
        self.assertEqual(client.delete("/api/bots/b/chats/-1001/").status_code, 404)
        self.assertEqual(BotChat.objects.count(), 1)

    def test_a_chat_of_another_bot_in_the_same_workspace_is_not_found_either(self):
        self.chat()
        Bot.objects.create(id="b2", workspace=self.workspace, project=self.project, handle="@b2", token="t2")

        self.assertEqual(self.client.delete("/api/bots/b2/chats/-1001/").status_code, 404)
        self.assertEqual(BotChat.objects.count(), 1)

    def test_the_list_does_not_cost_a_query_per_chat(self):
        for index in range(6):
            self.chat(chat_id=-1000 - index)

        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(len(self.client.get("/api/bots/b/chats/").data), 6)

        # `problems` reads the bot on every row, and without `select_related`
        # that is one extra query per chat — on a workspace whose bot sits in
        # forty groups, forty of them.
        self.assertLess(len(queries), 12, "the bot is fetched once, not once per chat")


class BotModuleSwitchTests(TestCase):
    """Which surfaces the bot answers on, written from the panel.

    `enabled_modules` has been a column with no control anywhere in the
    interface: a bot was connected with `["dms"]` and stayed that way, so a
    groups flow could be drawn, switched on, and refused by
    `matching.find_trigger` before it ever looked for one. The chat screen's
    switch writes this.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(
            id="p", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t", enabled_modules=["dms"]
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_module_can_be_switched_on_and_reaches_the_runtime(self):
        response = self.client.patch("/api/bots/b/", {"enabledModules": ["dms", "groups"]}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["enabledModules"], ["dms", "groups"])
        self.bot.refresh_from_db()
        self.assertTrue(self.bot.module_enabled("groups"))
        self.assertFalse(self.bot.module_enabled("channels"))

    def test_a_misspelt_module_is_refused_rather_than_stored(self):
        # A module nothing maps to is a bot that silently stops answering on the
        # one the author meant to switch on.
        response = self.client.patch("/api/bots/b/", {"enabledModules": ["guruh"]}, format="json")

        self.assertEqual(response.status_code, 400)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.enabled_modules, ["dms"])

    def test_an_analyst_may_not_switch_a_module(self):
        analyst = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        response = client.patch("/api/bots/b/", {"enabledModules": ["dms", "groups"]}, format="json")

        self.assertEqual(response.status_code, 403)


class ModuleSwitchTests(TestCase):
    """Which surfaces a bot answers on, and the one list it may not be given.

    The rule is not about tidiness. `Bot.module_enabled` reads an empty column
    as "nobody has configured this yet" and answers `dms` anyway, so `[]` sent
    deliberately produces a bot that is still replying while every switch in
    the panel reads off.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="mods@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="mw", name="MW", slug="mw", owner=self.user)
        Membership.objects.create(
            workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER
        )
        self.project = Project.objects.create(
            id="mp", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="mb", workspace=self.workspace, project=self.project, handle="@mb", token="t",
            enabled_modules=["dms"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _patch(self, modules):
        return self.client.patch(
            f"/api/bots/{self.bot.pk}/", {"enabledModules": modules},
            format="json", HTTP_X_WORKSPACE_ID="mw",
        )

    def test_a_module_can_be_switched_on_through_the_api(self):
        response = self._patch(["dms", "business", "groups"])

        self.assertEqual(response.status_code, 200, response.data)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.enabled_modules, ["dms", "business", "groups"])

    def test_an_unknown_module_is_refused(self):
        response = self._patch(["dms", "yoq-bunday"])

        self.assertEqual(response.status_code, 400)
        self.assertIn("yoq-bunday", response.data["error"]["message"])

    def test_an_empty_list_is_refused_because_it_does_not_mean_what_it_says(self):
        response = self._patch([])

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["field"], "enabledModules")
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.enabled_modules, ["dms"], "and nothing was written")

    def test_an_unconfigured_bot_is_still_allowed_to_have_none(self):
        """The default is not the refusal. A row nobody has touched carries an
        empty column and answers `dms`; that is the state the rule above is
        distinguishing itself from, not the state it forbids."""
        fresh = Bot.objects.create(
            id="mb2", workspace=self.workspace, project=self.project, handle="@mb2", token="t"
        )
        self.assertEqual(fresh.enabled_modules, [])
        self.assertTrue(fresh.module_enabled("dms"))
        self.assertFalse(fresh.module_enabled("groups"))

    def test_the_panel_and_the_api_refuse_it_in_the_same_words(self):
        """One rule, one sentence. The interface says it before the request is
        made so the switch does not have to travel to be told no; the two
        drifting apart is how a screen starts explaining something the server
        does not do."""
        from pathlib import Path as _Path

        from apps.bots.serializers import BotSerializer

        actions = _Path(__file__).resolve().parents[3] / "frontend/src/features/bots/actions.ts"
        self.assertTrue(actions.exists(), actions)
        self.assertIn(BotSerializer.NO_MODULES, actions.read_text(encoding="utf-8"))


class BotPlanLimitTests(TestCase):
    """The plan's `bots` cap, on every path that can end in a `Bot` row.

    The gauge on the billing screen has always drawn this number — `Botlar
    1 / 1` on the Free plan — while nothing at all refused the second one.
    Every path below produced a bot the workspace had not paid for, and the
    screen went on saying `1 / 1` about two of them.

    Two paths, because a bot can be born twice over: pasted from @BotFather
    (`services.connect_bot`) and created inside the panel through the manager
    bot (`managed`). The second one arrives on a webhook rather than on a
    request somebody is waiting for, so it is refused the way the runtime
    refuses — quietly, on the request row — while the first is refused to the
    caller's face.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.user.telegram_id = 5550001
        self.user.save(update_fields=["telegram_id"])
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        # The deployed entry plan, exactly as `seed_demo` writes it: one bot.
        self.plan = Plan.objects.create(
            key="start",
            name="Free",
            limits={"bots": 1, "flows": 5, "messages": 5000, "contacts": 1000, "members": 2, "aiBlocks": 0},
        )
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _existing_bot(self, key: str = "bir", telegram_id: int = 101) -> Bot:
        return Bot.objects.create(
            id=key,
            workspace=self.workspace,
            project=self.project,
            handle=f"@{key}",
            token=f"{telegram_id}:x",
            telegram_id=telegram_id,
        )

    # -- pasting a token ---------------------------------------------------

    def test_the_first_bot_still_connects(self):
        """The cap has to let the thing it caps happen once."""
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})

        self.assertEqual(response.status_code, 201, response.data)

    def test_a_second_bot_is_refused_on_a_plan_that_allows_one(self):
        self._existing_bot()

        response = self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})

        self.assertEqual(response.status_code, 402, response.data)
        body = response.json()["error"]
        self.assertEqual(body["code"], "plan_limit")
        self.assertIn("Free", body["message"], "the reader has to know which plan refused")
        self.assertIn("botlar", body["message"])
        self.assertEqual(Bot.objects.count(), 1, "refused before the write, not explained after it")

    def test_the_refusal_costs_no_telegram_call(self):
        """A token is not verified for a bot that cannot be stored anyway."""
        self._existing_bot()

        with mock.patch("apps.bots.services.verify_token") as verify:
            self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})

        verify.assert_not_called()

    def test_an_uncapped_plan_connects_as_many_as_it_likes(self):
        self.plan.limits = {**self.plan.limits, "bots": None}
        self.plan.save(update_fields=["limits"])
        self._existing_bot()

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})

        self.assertEqual(response.status_code, 201, response.data)

    # -- creating one through the manager bot ------------------------------

    def _open_request(self):
        with mock.patch("apps.bots.managed.can_manage_bots", return_value=True):
            return self.client.post(
                "/api/bots/create-request/",
                {"projectId": self.project.id, "name": "Sotuv", "username": "sotuv_bot"},
                format="json",
            )

    def test_a_creation_attempt_is_refused_before_telegram_is_opened(self):
        """The refusal has to land before the reader creates a bot on Telegram.

        Checked here and not only when the bot arrives: a 402 after the fact
        leaves somebody holding a real bot, created in their own account,
        that this product then declines to store.
        """
        self._existing_bot()

        response = self._open_request()

        self.assertEqual(response.status_code, 402, response.data)
        self.assertEqual(response.json()["error"]["code"], "plan_limit")
        self.assertFalse(ManagedBotRequest.objects.exists(), "nothing was opened")

    def test_a_managed_bot_that_arrives_over_the_cap_is_not_stored(self):
        """The seat can fill between the ask and the answer.

        A webhook, so nothing raises: the attempt is marked failed with the
        reason on it, which is what the polling screen shows.
        """
        response = self._open_request()
        self.assertEqual(response.status_code, 201, response.data)
        self._existing_bot()  # the last seat, taken while Telegram was drawing its screen

        landed = managed.handle_update(
            {
                "bot": {"id": 909, "is_bot": True, "first_name": "Sotuv", "username": "sotuv_bot"},
                "user": {"id": self.user.telegram_id},
            }
        )

        self.assertFalse(landed)
        self.assertEqual(Bot.objects.count(), 1)
        attempt = ManagedBotRequest.objects.get()
        self.assertEqual(attempt.status, ManagedBotRequest.Status.FAILED)
        self.assertIn("Free", attempt.error)

    def test_a_managed_bot_under_the_cap_still_lands(self):
        response = self._open_request()
        self.assertEqual(response.status_code, 201, response.data)

        with mock.patch("apps.bots.managed.get_managed_bot_token", return_value="909:XYZ"):
            with self.captureOnCommitCallbacks(execute=True):
                landed = managed.handle_update(
                    {
                        "bot": {"id": 909, "is_bot": True, "first_name": "Sotuv", "username": "sotuv_bot"},
                        "user": {"id": self.user.telegram_id},
                    }
                )

        self.assertTrue(landed)
        self.assertEqual(Bot.objects.get().telegram_id, 909)


class ManagedConfigTests(TestCase):
    """What `managed-config` tells the "Yangi bot" screen, and why it has to.

    The endpoint's whole job is that a button is never offered for something
    that will be refused. It answered three of the four reasons a bot cannot be
    added and left out the one the reader is most likely to hit: a full plan.
    So "Botni yaratish" was drawn, enabled, pressable — and pressing it spent a
    round trip to be told 402 by `create-request`. That is this product's
    signature failure, an interface promising what it cannot deliver, and the
    fix is not a nicer error but a button that knows its own state.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.user.telegram_id = 5550001
        self.user.save(update_fields=["telegram_id"])
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user, plan_key="start")
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.plan = Plan.objects.create(key="start", name="Free", limits={"bots": 1})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _config(self):
        with mock.patch("apps.bots.managed.is_configured", return_value=True):
            with mock.patch("apps.bots.managed.can_manage_bots", return_value=True):
                return self.client.get("/api/bots/managed-config/").json()

    def _fill_the_plan(self) -> None:
        Bot.objects.create(
            id="bir", workspace=self.workspace, project=self.project, handle="@bir", token="1:x", telegram_id=1
        )

    def test_room_in_the_plan_offers_the_button(self):
        payload = self._config()

        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["reason"], "")
        self.assertEqual(payload["message"], "")

    def test_a_full_plan_is_a_reason_of_its_own(self):
        self._fill_the_plan()

        payload = self._config()

        self.assertFalse(payload["enabled"])
        self.assertEqual(payload["reason"], "plan_limit")

    def test_the_screen_is_handed_the_same_sentence_the_refusal_would_have_used(self):
        """The numbers are the plan's, so the wording has to be the server's.

        A sentence written in the frontend could not name the plan or the cap,
        and a second wording for the same refusal is how the button and the
        402 start disagreeing about what the plan says.
        """
        self._fill_the_plan()

        message = self._config()["message"]

        self.assertIn("Free", message)
        self.assertIn("botlar", message)
        refused = self.client.post("/api/bots/", {"projectId": self.project.id, "token": "123:ABC"})
        self.assertEqual(refused.json()["error"]["message"], message)

    def test_a_full_plan_is_answered_without_asking_telegram(self):
        """`can_manage_bots()` is a live Bot API call, and a workspace with no
        seat left is refused whatever the answer to it turns out to be."""
        self._fill_the_plan()

        with mock.patch("apps.bots.managed.is_configured", return_value=True):
            with mock.patch("apps.bots.managed.can_manage_bots") as asked:
                self.client.get("/api/bots/managed-config/")

        asked.assert_not_called()

    def test_an_uncapped_plan_is_never_told_it_is_full(self):
        self.plan.limits = {"bots": None}
        self.plan.save(update_fields=["limits"])
        self._fill_the_plan()

        self.assertTrue(self._config()["enabled"])

    def test_the_install_still_answers_for_itself_when_the_plan_has_room(self):
        with mock.patch("apps.bots.managed.is_configured", return_value=False):
            payload = self.client.get("/api/bots/managed-config/").json()

        self.assertEqual(payload["reason"], "not_configured")

    def test_an_account_with_no_telegram_identity_is_still_told_so(self):
        self.user.telegram_id = None
        self.user.save(update_fields=["telegram_id"])

        with mock.patch("apps.bots.managed.is_configured", return_value=True):
            payload = self.client.get("/api/bots/managed-config/").json()

        self.assertEqual(payload["reason"], "telegram_required")


class BotPauseTests(TestCase):
    """Stopping a bot, and the button that used to only say it had.

    «To'xtatish» sat in the bot header's overflow menu behind a destructive
    confirmation reading *"Bot to'xtatiladi va xabarlarga javob bermaydi"*. It
    fired a toast and nothing else — no request, no column, no runtime effect —
    so a shop owner who stopped their bot on a Friday evening watched it answer
    customers all weekend while the panel said it was stopped.

    What stopping means is decided in `Bot.module_enabled`, which is the same
    method `engine.matching.find_trigger` asks before it looks for a flow. One
    answer therefore serves the runtime, the chat findings and the panel — and
    a paused bot cannot start a conversation on any surface, whatever its
    module switches say.

    It stops there deliberately. A run already parked on a question is finished
    rather than abandoned mid-order, and every message still reaches
    «Suhbatlar» for an operator; both are said on the screen rather than left
    for somebody to discover.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="p@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="pw", name="PW", slug="pw", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="pp", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="pb", workspace=self.workspace, project=self.project, handle="@pb", token="t",
            enabled_modules=["dms", "groups", "channels", "business"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _patch(self, payload):
        return self.client.patch(f"/api/bots/{self.bot.pk}/", payload, format="json", HTTP_X_WORKSPACE_ID="pw")

    def test_a_stopped_bot_answers_on_no_surface_at_all(self):
        self.bot.is_paused = True

        for key in MODULE_KEYS:
            self.assertFalse(self.bot.module_enabled(key), key)

    def test_the_runtime_refuses_before_it_looks_for_a_flow(self):
        """The column is not a second rule the dispatcher has to be taught.

        `find_trigger` already asks `module_enabled`, so a stopped bot is
        refused at the same line a switched-off module is — no engine change,
        and no way for the two answers to drift apart.
        """
        from apps.engine.events import IncomingEvent
        from apps.engine.matching import find_trigger

        event = IncomingEvent(update_id=1, kind="message", text="salom", chat_id=7)
        self.bot.is_paused = True

        self.assertIsNone(find_trigger(self.bot, event))

    def test_the_switch_is_written_from_the_panel(self):
        response = self._patch({"isPaused": True})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["isPaused"])
        self.bot.refresh_from_db()
        self.assertTrue(self.bot.is_paused)

    def test_starting_it_again_is_the_same_switch(self):
        self.bot.is_paused = True
        self.bot.save(update_fields=["is_paused"])

        self._patch({"isPaused": False})

        self.bot.refresh_from_db()
        self.assertFalse(self.bot.is_paused)
        self.assertTrue(self.bot.module_enabled("dms"))

    def test_every_screen_reads_the_stopped_state_from_the_status(self):
        """Not only the settings screen. The bots list, the header and the
        module pages all print `status`, and a bot deliberately stopped must
        not read there as "Faol"."""
        self.bot.is_paused = True
        self.bot.save(update_fields=["is_paused"])

        row = self.client.get("/api/bots/", HTTP_X_WORKSPACE_ID="pw").data["results"][0]

        self.assertEqual(row["status"]["label"], "To'xtatilgan")
        self.assertTrue(row["isPaused"])

    def test_a_stopped_bot_says_so_on_its_chats_rather_than_blaming_the_module(self):
        """`module_enabled` answers False for everything while paused, so the
        chat rows would otherwise all report «Guruh bo'limi o'chirilgan» — a
        switch the reader can see is still on."""
        chat = BotChat.objects.create(
            bot=self.bot, chat_id=-100, type=BotChat.Type.SUPERGROUP, title="Sotuv",
            status=BotChat.Status.ADMINISTRATOR, rights={"can_delete_messages": True},
        )
        self.bot.is_paused = True
        self.bot.save(update_fields=["is_paused"])

        codes = [problem["code"] for problem in chat_problems(chat, self.bot)]

        self.assertIn("bot_paused", codes)
        self.assertNotIn("module_off", codes)

    def test_stopping_the_bot_is_written_to_its_own_activity_log(self):
        """Who stopped the bot and when is the first question asked when it is
        found stopped, and `BotActivity` is where every other answer of that
        kind already lives."""
        self._patch({"isPaused": True})

        self.assertTrue(self.bot.activity.filter(text__icontains="to'xtatildi").exists())

    def test_an_analyst_may_not_stop_the_bot(self):
        analyst = User.objects.create_user(email="pa@b.uz", password="Parol12345", name="A", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        response = client.patch(f"/api/bots/{self.bot.pk}/", {"isPaused": True}, format="json", HTTP_X_WORKSPACE_ID="pw")

        self.assertEqual(response.status_code, 403)
        self.bot.refresh_from_db()
        self.assertFalse(self.bot.is_paused)

    def test_the_panel_and_the_runtime_describe_stopping_in_the_same_words(self):
        """One sentence for what stopping does, in one place.

        The old button's confirmation said the bot "would not answer messages",
        which was both a lie and a different claim from the one the product can
        actually make. The sentence now lives in `apps.bots.models` and is what
        the chat finding says as well as what the switch's own footer says.
        """
        from pathlib import Path as _Path

        screen = (
            _Path(__file__).resolve().parents[3]
            / "frontend/src/features/bots/components/settings/BotSettingsScreen.tsx"
        )
        self.assertTrue(screen.exists(), screen)
        self.assertIn(PAUSED_NOTE, screen.read_text(encoding="utf-8"))


class WorkingHoursRemovalTests(TestCase):
    """`Bot.settings["workingHours"]` is gone, and this is why.

    Six keys — a switch, the weekdays, an opening and a closing time, a
    timezone and an away message — with a whole «Ish vaqti» section of the
    settings screen above them, and not one line anywhere that read any of
    them. Not the dispatcher, not the sender, not the panel: the only code that
    touched the blob was the form that wrote it back to itself.

    It was not missing a runtime either. Working hours *do* work in this
    product, one level down, where they can be answered differently by
    different flows: a Business trigger carries its own `schedule`
    (`flows.services.reindex_triggers` → `engine.matching._within_schedule`),
    and «Ish vaqtidan tashqari avtojavob» is a shipped template built on it.
    So a bot-level copy was never one switch short of working — it was a second
    answer to a question that already had one, sitting where the first would be
    looked for.

    This is the same finding as `0008_drop_bot_fallback_setting`, and the same
    verdict: a setting that is written, kept and never read is worse than no
    setting, because the next person to find it will assume it works.
    """

    def test_a_new_bot_is_not_given_the_setting(self):
        self.assertNotIn("workingHours", default_settings())

    def test_the_migration_takes_it_off_a_bot_that_already_had_it(self):
        """The column is a `JSONField`, so nothing about this is in the schema:
        without the data migration every bot connected before today keeps six
        keys the panel no longer draws and nobody reads."""
        from importlib import import_module

        # `import_module`, because a migration's module name starts with a
        # digit and no `import` statement can name it.
        migration = import_module("apps.bots.migrations.0010_drop_bot_working_hours")

        user = User.objects.create_user(email="wh@b.uz", password="Parol12345", name="A", email_verified=True)
        workspace = Workspace.objects.create(id="ww", name="W", slug="w", owner=user)
        project = Project.objects.create(id="wp", workspace=workspace, name="P", handle="p")
        bot = Bot.objects.create(
            id="wb", workspace=workspace, project=project, handle="@wb",
            settings={**default_settings(), "workingHours": {"enabled": True, "days": [1]}},
        )

        migration.drop_working_hours(FakeApps(), None)

        bot.refresh_from_db()
        self.assertNotIn("workingHours", bot.settings)
        self.assertEqual(bot.settings["displayName"], "", "and nothing else in the blob moved")

    def test_nothing_in_the_backend_reads_it_any_more(self):
        """The check that would have caught this the first time.

        A grep, deliberately, and over the source rather than over behaviour:
        there is no behaviour to assert about a key nothing consults, which is
        precisely the property that let it survive.
        """
        from pathlib import Path as _Path

        root = _Path(__file__).resolve().parents[2] / "apps"
        # The *quoted* key, which is the only way Python can reach into a
        # `JSONField`. Prose naming it in a comment — including the one in
        # `default_settings` explaining why it is gone — is not a read, and a
        # check that could not tell the two apart would forbid the explanation
        # along with the thing it explains.
        offenders = sorted(
            path.relative_to(root).as_posix()
            for path in root.rglob("*.py")
            if "migrations" not in path.parts
            and path.name != "tests.py"
            and ('"workingHours"' in path.read_text(encoding="utf-8") or "'workingHours'" in path.read_text(encoding="utf-8"))
        )

        self.assertEqual(offenders, [])


class FakeApps:
    """The two-method `apps` a data migration is handed, backed by real models.

    A migration's historical model has no custom `save`, no properties and no
    `default_settings` — which is exactly the shape this one has to work on,
    and the shape a test calling it directly must hand it.
    """

    def get_model(self, app_label: str, model_name: str):
        from django.apps import apps as registry

        return registry.get_model(app_label, model_name)


class BusinessConnectionRightsTests(TestCase):
    """What a Business account actually let this bot do, and saying it out loud.

    Two faults, one cause. `dispatch._store_business_connection` writes
    Telegram's `BusinessBotRights` object down verbatim and nothing has ever
    read it back — so a bot connected to an account that withheld
    «Javob yozish» tries to send, Telegram refuses, and the flow dies with an
    error nobody can trace to a switch in somebody else's Telegram.

    The panel that *displays* those rights could not read them either. Its
    catalogue joined on the field names of `account.updateConnectedBot` — the
    MTProto client method an account owner's own app calls, whose flags are
    `reply`, `read_messages`, `view_gifts` — while what arrives on a webhook is
    the Bot API object, whose fields are `can_reply`, `can_read_messages`,
    `can_view_gifts_and_stars`. Not one name matched, so every connection in
    the product rendered as «0/14 huquq» and «Akkaunt egasi botga hech qanday
    huquq bermagan», whatever the owner had granted.

    This is Telegram's answer and not a setting of ours: no Bot API method lets
    a bot grant itself a right. So it is reported, never offered as a switch.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="bz@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="bw", name="BW", slug="bw", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="bp", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="bb", workspace=self.workspace, project=self.project, handle="@bb", token="t",
            enabled_modules=["dms", "business"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _connection(self, **rights) -> BusinessConnection:
        return BusinessConnection.objects.create(
            bot=self.bot, connection_id="bc1", user_name="Anvar", username="anvar",
            rights={name: True for name in rights if rights[name]},
        )

    def test_a_connection_that_may_reply_has_nothing_to_report(self):
        connection = self._connection(can_reply=True, can_read_messages=True)

        self.assertEqual(business_problems(connection, self.bot), [])

    def test_a_bot_that_was_not_granted_reply_is_the_headline_failure(self):
        """Telegram's own words: `can_reply` is what lets the bot send and edit
        messages at all. Without it every flow on this account ends in a
        refusal, and until now the refusal was the only symptom."""
        connection = self._connection(can_read_messages=True)

        found = business_problems(connection, self.bot)

        self.assertEqual([row["code"] for row in found], ["cannot_reply"])
        self.assertEqual(found[0]["tone"], "danger")

    def test_a_suspended_connection_is_said_before_the_rights(self):
        """`is_enabled` is the owner switching the bot off without detaching
        it. Listing the rights of a bot that is not running at all would answer
        a question nobody has yet."""
        connection = self._connection(can_reply=True)
        connection.is_enabled = False
        connection.save(update_fields=["is_enabled"])

        self.assertEqual([row["code"] for row in business_problems(connection, self.bot)], ["suspended"])

    def test_the_module_being_off_is_reported_where_the_account_is_shown(self):
        """The one cause that is ours rather than Telegram's, and the only one
        on this panel with a switch beside it."""
        self.bot.enabled_modules = ["dms"]
        self.bot.save(update_fields=["enabled_modules"])
        connection = self._connection(can_reply=True)

        self.assertIn("module_off", [row["code"] for row in business_problems(connection, self.bot)])

    def test_a_stopped_bot_is_reported_instead_of_the_module(self):
        self.bot.is_paused = True
        self.bot.save(update_fields=["is_paused"])
        connection = self._connection(can_reply=True)

        codes = [row["code"] for row in business_problems(connection, self.bot)]

        self.assertIn("bot_paused", codes)
        self.assertNotIn("module_off", codes)

    def test_the_endpoint_carries_the_findings_to_the_panel(self):
        self._connection(can_read_messages=True)

        rows = self.client.get("/api/bots/bb/business-connections/", HTTP_X_WORKSPACE_ID="bw").data

        self.assertEqual([row["code"] for row in rows[0]["problems"]], ["cannot_reply"])

    def test_the_panel_names_the_rights_telegram_actually_sends(self):
        """The bug this class is named for, pinned so it cannot come back.

        Every `api:` in the frontend catalogue has to be a field of the Bot API
        `BusinessBotRights` object — the thing a `business_connection` update
        carries — and not a flag of the MTProto method an account owner's own
        client calls. The two vocabularies describe the same fourteen rights
        with different words, which is exactly why nobody noticed.
        """
        import re as _re
        from pathlib import Path as _Path

        catalogue = _Path(__file__).resolve().parents[3] / "frontend/src/features/bots/data/business.ts"
        self.assertTrue(catalogue.exists(), catalogue)
        named = set(_re.findall(r'api:\s*"([^"]+)"', catalogue.read_text(encoding="utf-8")))

        self.assertEqual(named, set(BUSINESS_RIGHT_FIELDS), "the catalogue and Telegram disagree about a field name")



class StarterLibraryTests(TestCase):
    """A new bot does not start with an empty box.

    The shared library is prepended to every Kod block and every
    `{{ ifoda }}` a flow renders, so with none the author's first act is
    inventing `money()` — and the second is discovering that the editor warns
    about every function they call, because `expressions.declared_functions`
    reads the library to decide what a flow may name.
    """

    def test_it_is_the_shipped_file(self):
        from apps.bots.services import STARTER_LIBRARY, starter_library

        self.assertTrue(STARTER_LIBRARY.exists(), STARTER_LIBRARY)
        self.assertEqual(starter_library(), STARTER_LIBRARY.read_text(encoding="utf-8"))

    def test_it_fits_the_ceiling_the_endpoint_enforces(self):
        """The library editor refuses a file over `SCRIPT_LIBRARY_LIMIT`. A
        starter the author could never save back is a starter they can only
        delete."""
        from apps.bots.services import starter_library
        from apps.bots.views import SCRIPT_LIBRARY_LIMIT

        self.assertLessEqual(len(starter_library()), SCRIPT_LIBRARY_LIMIT)

    def test_the_editor_can_see_what_it_declares(self):
        """`declared_functions` is a regex, not a parser — a function written in
        a shape it cannot read is a function the editor warns about on every
        save. The whole library has to be visible to it."""
        from apps.bots.services import starter_library
        from apps.engine.expressions import declared_functions

        declared = declared_functions(starter_library())

        for name in ("money", "phone", "cartTotal", "escapeMd", "parseDateUz", "closest"):
            self.assertIn(name, declared)

    def test_both_creation_paths_install_it(self):
        """A bot is born two ways — a pasted token and the manager bot inside
        the panel — and two places to write this is two places to forget it.
        Read out of the source rather than by connecting a bot, because
        connecting one wants Telegram and this is a question about the code."""
        from pathlib import Path as _Path

        for module in ("services.py", "managed.py"):
            source = (_Path("apps/bots") / module).read_text(encoding="utf-8")
            self.assertIn("script_library=starter_library()", source, module)

    def test_a_missing_file_leaves_the_library_empty_rather_than_refusing(self):
        """An empty library is the state every bot was in before this existed.
        A bot nobody can connect is not."""
        from unittest import mock

        from apps.bots import services

        with mock.patch.object(services, "STARTER_LIBRARY", Path("/yo-q/stdlib.js")):
            with self.assertLogs("apps.bots.services", "WARNING"):
                self.assertEqual(services.starter_library(), "")


class BotProjectMoveTests(TestCase):
    """Moving a bot to another project — and taking its flows with it.

    `projectId` has been writable on this endpoint from the start and reachable
    from no screen at all, which is how the half of it that does not work went
    unnoticed: `Flow` carries a `project` of its own beside its `bot`, so a bot
    that moved left every one of its flows behind in the project it came from.
    Nothing breaks in the runtime — flows are found by bot — but the project
    that no longer owns the bot goes on listing its flows, and the project that
    does lists none. A screen for this without the fix would have made that a
    thing readers do rather than a thing nobody could reach.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="mv@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="mvw", name="W", slug="w", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.first = Project.objects.create(id="mv1", workspace=self.workspace, name="Bir", handle="bir")
        self.second = Project.objects.create(id="mv2", workspace=self.workspace, name="Ikki", handle="ikki")
        self.bot = Bot.objects.create(
            id="mvb", workspace=self.workspace, project=self.first, handle="@mvb", token="t",
            enabled_modules=["dms"],
        )
        self.flow = Flow.objects.create(
            id="mvf", workspace=self.workspace, project=self.first, bot=self.bot,
            name="Asosiy", module_key="dms",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_the_flows_move_with_the_bot(self):
        response = self.client.patch(
            "/api/bots/mvb/", {"projectId": "mv2"}, format="json", HTTP_X_WORKSPACE_ID="mvw"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.flow.refresh_from_db()
        self.assertEqual(self.flow.project_id, "mv2", "a flow left behind is a flow its project no longer lists")

    def test_another_tenant_s_project_is_still_refused(self):
        stranger = User.objects.create_user(email="mv2@b.uz", password="Parol12345", name="B", email_verified=True)
        other = Workspace.objects.create(id="mvo", name="O", slug="o", owner=stranger)
        elsewhere = Project.objects.create(id="mvx", workspace=other, name="X", handle="x")

        response = self.client.patch(
            "/api/bots/mvb/", {"projectId": elsewhere.id}, format="json", HTTP_X_WORKSPACE_ID="mvw"
        )

        self.assertEqual(response.status_code, 404)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.project_id, "mv1")
        self.flow.refresh_from_db()
        self.assertEqual(self.flow.project_id, "mv1", "and nothing moved on the way to the refusal")
