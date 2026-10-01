"""Webhook tests — the one endpoint the open internet can reach."""

from __future__ import annotations

import json
from unittest import mock

from django.core.cache import cache
from django.test import TestCase

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.flows.models import FlowRun
from apps.flows.services import ensure_main_flow
from apps.projects.models import Project
from apps.workspaces.models import Workspace


class WebhookTests(TestCase):
    def setUp(self) -> None:
        # `report_problem` throttles on the process cache for five minutes, and
        # the cache is not part of the test database — so a note one test made
        # silences the identical note in the next, and an assertion about the
        # bot's activity passes or fails depending on what ran before it. This
        # is here rather than in the one test that noticed, because every test
        # that reads `bot.activity` walks into the same trap.
        cache.clear()
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")
        workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        project = Project.objects.create(id="p", workspace=workspace, name="P", handle="p", created_by=user)
        self.bot = Bot.objects.create(
            id="b", workspace=workspace, project=project, handle="@b", token="t",
            webhook_secret="s3cret", enabled_modules=["dms"],
        )
        self.flow = ensure_main_flow(workspace=workspace, project=project, bot=self.bot)

    def _post(self, body: dict, secret: str | None = "s3cret"):
        headers = {"HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN": secret} if secret is not None else {}
        return self.client.post(
            f"/api/telegram/webhook/{self.bot.webhook_token}/",
            data=json.dumps(body),
            content_type="application/json",
            **headers,
        )

    def test_a_valid_update_is_accepted_and_runs_the_flow(self):
        update = {
            "update_id": 1,
            "message": {
                "message_id": 1,
                "chat": {"id": 42, "type": "private"},
                "from": {"id": 42, "first_name": "Dilnoza"},
                "text": "/start",
            },
        }

        response = self._post(update)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        # Celery runs inline under the test settings, so the run is already there.
        run = FlowRun.objects.get()
        self.assertEqual(run.flow_id, self.flow.id)
        self.assertTrue(run.steps.filter(actor="bot").exists())

    def test_a_request_without_the_secret_is_refused(self):
        response = self._post({"update_id": 1}, secret=None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(FlowRun.objects.count(), 0)

    def test_a_request_with_the_wrong_secret_is_refused(self):
        self.assertEqual(self._post({"update_id": 1}, secret="boshqa").status_code, 401)

    def test_a_bot_with_no_secret_at_all_refuses_everybody(self):
        """The blank column used to turn the header check off entirely.

        The guard read "if there is a secret, compare it", so a row whose
        column was empty answered any caller who knew the path — and the path
        is the only thing left standing once the header stops being read. No
        such row exists (`webhook_secret` has defaulted to a generated value
        since the initial migration), which is exactly why nobody would have
        noticed the day one arrived.
        """
        self.bot.webhook_secret = ""
        self.bot.save(update_fields=["webhook_secret"])

        for secret in (None, "", "nimadir"):
            with self.subTest(secret=secret):
                self.assertEqual(self._post({"update_id": 1}, secret=secret).status_code, 401)
        self.assertEqual(FlowRun.objects.count(), 0, "and nothing ran")

    def test_a_missing_secret_says_so_rather_than_blaming_a_mismatch(self):
        """Two faults, two fixes. «mos kelmadi» sends whoever reads the bot's
        activity looking for a mismatch that cannot happen when there is
        nothing to mismatch against."""
        self.bot.webhook_secret = ""
        self.bot.save(update_fields=["webhook_secret"])

        self._post({"update_id": 1}, secret="nimadir")

        note = self.bot.activity.first()
        self.assertIsNotNone(note)
        self.assertIn("maxfiy kalit yo'q", note.text)

    def test_an_unknown_token_is_refused_the_same_way_a_bad_secret_is(self):
        """A 404 here would be an oracle: it would tell a stranger probing the
        endpoint which tokens exist, one guess at a time. Both answers are 401
        and both bodies are identical."""
        response = self.client.post(
            "/api/telegram/webhook/yoq-bunday-token-yoq/", data="{}", content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cret",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"ok": False, "error": "invalid secret"})

    def test_the_webhook_url_does_not_contain_the_bot_handle(self):
        """The handle is public — it is how customers find the bot — so a URL
        built from it is a public URL."""
        from apps.bots.services import webhook_url_for

        # Compared as a path segment, not as a substring: a random URL-safe
        # token contains every letter sooner or later, and this fixture's bot
        # id happens to be one character long.
        segment = webhook_url_for(self.bot).rstrip("/").rsplit("/", 1)[-1]
        self.assertEqual(segment, self.bot.webhook_token)
        self.assertNotEqual(segment, self.bot.id)

    def test_a_body_that_is_not_json_is_a_400_rather_than_a_500(self):
        response = self.client.post(
            f"/api/telegram/webhook/{self.bot.webhook_token}/", data="not json", content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cret",
        )
        self.assertEqual(response.status_code, 400)

    def test_an_update_nothing_can_be_routed_on_is_accepted_and_ignored(self):
        # Telegram retries anything it does not get a 200 for, so an update this
        # product does not handle still has to be acknowledged.
        response = self._post({"update_id": 9, "poll_answer": {"poll_id": "1"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FlowRun.objects.count(), 0)


class BrokerDownTests(TestCase):
    """With no queue reachable, the bot still answers — and says that it had to."""

    def setUp(self) -> None:
        cache.clear()  # see `WebhookTests.setUp`
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")
        workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        project = Project.objects.create(id="p", workspace=workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=workspace, project=project, handle="@b", token="t",
            webhook_secret="s3cret", enabled_modules=["dms"],
        )
        ensure_main_flow(workspace=workspace, project=project, bot=self.bot)

    def _start(self):
        return self.client.post(
            f"/api/telegram/webhook/{self.bot.webhook_token}/",
            data=json.dumps(
                {
                    "update_id": 1,
                    "message": {
                        "message_id": 1,
                        "chat": {"id": 42, "type": "private"},
                        "from": {"id": 42, "first_name": "Dilnoza"},
                        "text": "/start",
                    },
                }
            ),
            content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="s3cret",
        )

    def test_an_unreachable_broker_falls_back_to_handling_it_here(self):
        from kombu import exceptions as kombu_exceptions

        with mock.patch(
            "apps.engine.tasks.process_update.delay",
            side_effect=kombu_exceptions.OperationalError("no broker"),
        ):
            response = self._start()

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["queued"])
        self.assertTrue(response.json()["handled"], "the update has to be answered, queue or no queue")
        run = FlowRun.objects.get()
        self.assertTrue(run.steps.filter(actor="bot").exists())

    def test_the_detour_is_written_to_the_bots_activity(self):
        from kombu import exceptions as kombu_exceptions

        with mock.patch(
            "apps.engine.tasks.process_update.delay",
            side_effect=kombu_exceptions.OperationalError("no broker"),
        ):
            self._start()

        self.assertTrue(
            self.bot.activity.filter(text__startswith="Navbat ishlamayapti").exists(),
            "a webhook that fails quietly is indistinguishable from a bot nobody wrote to",
        )

    def test_a_rejected_secret_is_recorded_too(self):
        self.client.post(
            f"/api/telegram/webhook/{self.bot.webhook_token}/",
            data="{}",
            content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="boshqa",
        )

        self.assertTrue(self.bot.activity.filter(text__startswith="Webhook rad etildi").exists())

    def test_the_same_problem_is_not_logged_on_every_retry(self):
        from kombu import exceptions as kombu_exceptions

        with mock.patch(
            "apps.engine.tasks.process_update.delay",
            side_effect=kombu_exceptions.OperationalError("no broker"),
        ):
            self._start()
            self._start()
            self._start()

        self.assertEqual(
            self.bot.activity.filter(text__startswith="Navbat ishlamayapti").count(),
            1,
            "Telegram retries every few seconds; the log must stay readable",
        )

    def test_a_crash_while_handling_asks_telegram_to_retry(self):
        from kombu import exceptions as kombu_exceptions

        with mock.patch(
            "apps.engine.tasks.process_update.delay",
            side_effect=kombu_exceptions.OperationalError("no broker"),
        ), mock.patch("apps.engine.dispatch.dispatch", side_effect=RuntimeError("boom")):
            response = self._start()

        self.assertEqual(response.status_code, 500)
        self.assertTrue(self.bot.activity.filter(text__startswith="Xabarni qayta ishlashda xato").exists())


class SessionReuseTests(TestCase):
    """Every send after the first must reuse the connection, not reopen it."""

    def test_all_sends_go_through_one_pooled_session(self):
        from apps.telegram import client as tc

        # Reset the module singleton so the assertion is about this test.
        tc._SESSION = None

        with mock.patch.object(tc.requests, "Session", wraps=tc.requests.Session) as make_session:
            first = tc._session()
            second = tc._session()

        self.assertIs(first, second, "the session is a per-worker singleton")
        self.assertEqual(make_session.call_count, 1, "a second send must not build a second session")

    def test_an_idle_session_is_replaced_not_reused(self):
        # A connection idle for minutes may have been dropped by a NAT without
        # either end knowing; reusing it hangs the first send for the whole
        # timeout. The first /start after a quiet spell must open a fresh one.
        from apps.telegram import client as tc

        tc._SESSION = None
        with mock.patch.object(tc.time, "monotonic", return_value=1000.0):
            stale = tc._session()
        with mock.patch.object(tc.time, "monotonic", return_value=1000.0 + tc.SESSION_IDLE_SECONDS + 1):
            fresh = tc._session()

        self.assertIsNot(stale, fresh)

    def test_the_session_keeps_connections_alive(self):
        from apps.telegram import client as tc

        tc._SESSION = None
        adapter = tc._session().get_adapter("https://api.telegram.org")

        # A pool that can hold connections open is what makes keep-alive real.
        self.assertGreaterEqual(adapter._pool_maxsize, 2)
        # No automatic retries: a retried sendMessage is a message sent twice.
        self.assertEqual(adapter.max_retries.total, 0)


class RedactionTests(TestCase):
    """No token and no raw exception may reach a message a customer-facing feed prints."""

    def test_a_token_inside_a_url_is_blacked_out(self):
        from apps.telegram.client import TelegramError

        error = TelegramError(
            "setWebhook",
            "Max retries exceeded with url: /bot8778313532:AAFzAzeXYZ-abc/setWebhook",
        )
        self.assertNotIn("8778313532:AAFzAze", error.message)
        self.assertIn("/bot•••", error.message)

    def test_transport_failures_read_as_sentences(self):
        import requests as requests_lib

        from apps.telegram.client import transport_message

        self.assertIn("vaqt tugadi", transport_message(requests_lib.Timeout("boom")))
        self.assertIn("ulanib bo'lmadi", transport_message(requests_lib.ConnectionError("reset by peer")))
        # The fallback names the class and nothing else — no URL, no pool dump.
        self.assertEqual(transport_message(requests_lib.RequestException()), "Tarmoq xatosi: RequestException")
