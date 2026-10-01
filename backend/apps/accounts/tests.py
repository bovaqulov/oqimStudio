"""Auth API tests — the paths a person takes to get in and back in."""

from __future__ import annotations

from datetime import timedelta

from unittest import mock

import requests
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts import bot_login
from apps.accounts.models import TelegramLoginRequest, User, VerificationToken
from apps.workspaces.models import Membership, Workspace


class AuthFlowTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        # Throttle counters live in the cache and outlive a test method.
        cache.clear()

    def test_signup_creates_an_unverified_account_and_a_link(self):
        response = self.client.post(
            "/api/auth/signup/",
            {"name": "Aziza", "email": "Aziza@Sunrise.uz", "password": "Parol12345"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["user"]["emailVerified"])
        user = User.objects.get(email="aziza@sunrise.uz")
        self.assertEqual(user.email, "aziza@sunrise.uz", "the address is stored lowercased")
        self.assertTrue(
            VerificationToken.objects.filter(user=user, purpose="verify_email").exists(),
            "a signup that sends no link leaves the account unreachable",
        )

    def test_a_taken_address_answers_with_a_code_the_form_can_branch_on(self):
        User.objects.create_user(email="aziza@sunrise.uz", password="Parol12345", name="Aziza")
        response = self.client.post(
            "/api/auth/signup/", {"name": "Boshqa", "email": "aziza@sunrise.uz", "password": "Parol12345"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "email_taken")
        self.assertEqual(response.data["error"]["field"], "email")

    def test_a_weak_password_is_refused_before_an_account_exists(self):
        response = self.client.post(
            "/api/auth/signup/", {"name": "Aziza", "email": "a@b.uz", "password": "12345678"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "weak_password")
        self.assertFalse(User.objects.filter(email="a@b.uz").exists())

    def test_login_returns_a_session_and_a_token(self):
        User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        response = self.client.post("/api/auth/login/", {"email": "a@b.uz", "password": "Parol12345"})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["token"], "the WebSocket handshake has no cookie to use")
        self.assertEqual(response.data["user"]["email"], "a@b.uz")

    def test_wrong_credentials_say_the_same_thing_as_a_missing_account(self):
        User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")
        wrong = self.client.post("/api/auth/login/", {"email": "a@b.uz", "password": "Boshqa12345"})
        missing = self.client.post("/api/auth/login/", {"email": "yoq@b.uz", "password": "Parol12345"})

        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.data["error"]["code"], missing.data["error"]["code"])
        self.assertEqual(wrong.data["error"]["message"], missing.data["error"]["message"])

    def test_verifying_an_email_opens_the_account(self):
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")
        token = VerificationToken.issue(user, VerificationToken.Purpose.VERIFY_EMAIL)

        response = self.client.post("/api/auth/verify-email/", {"token": token.token})

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        token.refresh_from_db()
        self.assertIsNotNone(token.used_at, "a verification link is single use")

    def test_a_used_reset_link_stops_working(self):
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")
        token = VerificationToken.issue(user, VerificationToken.Purpose.RESET_PASSWORD)

        first = self.client.post("/api/auth/reset-password/", {"token": token.token, "password": "Yangi12345"})
        second = self.client.post("/api/auth/reset-password/", {"token": token.token, "password": "Boshqa12345"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data["error"]["code"], "invalid_token")
        user.refresh_from_db()
        self.assertTrue(user.check_password("Yangi12345"))

    def test_forgot_password_answers_the_same_way_for_an_unknown_address(self):
        known = self.client.post("/api/auth/forgot-password/", {"email": "yoq@b.uz"})
        self.assertEqual(known.status_code, 200)
        self.assertTrue(known.data["ok"], "whether an address has an account is not this endpoint's to reveal")

    def test_the_session_endpoint_needs_a_session(self):
        # 403 rather than 401: session auth has no challenge to send back, which
        # is what DRF answers with when there is no credential at all.
        self.assertEqual(self.client.get("/api/auth/session/").status_code, 403)


class ThrottleTests(TestCase):
    """The auth endpoints are the ones reachable without an account."""

    def setUp(self) -> None:
        self.client = APIClient()
        cache.clear()

    def test_guessing_passwords_runs_into_a_ceiling(self):
        User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza")

        codes = []
        for _ in range(20):
            response = self.client.post("/api/auth/login/", {"email": "a@b.uz", "password": "Xato12345"})
            codes.append(response.status_code)
            if response.status_code == 429:
                self.assertEqual(response.data["error"]["code"], "rate_limited")
                break

        self.assertIn(429, codes, "an unlimited login endpoint is a password oracle")

    def test_the_ceiling_is_per_endpoint_family(self):
        cache.clear()
        for _ in range(6):
            self.client.post("/api/auth/forgot-password/", {"email": "yoq@b.uz"})

        # The mail-sending family runs out first; signing in still answers.
        forgot = self.client.post("/api/auth/forgot-password/", {"email": "yoq@b.uz"})
        login = self.client.post("/api/auth/login/", {"email": "yoq@b.uz", "password": "x"})

        self.assertEqual(forgot.status_code, 429)
        self.assertEqual(login.status_code, 401)

    def test_a_forged_forwarded_for_cannot_buy_a_fresh_bucket(self):
        """The rate limit keys on a hop the caller cannot forge.

        A trusted proxy appends the real peer as the *last* `X-Forwarded-For`
        entry, and `NUM_PROXIES` is what makes DRF read that entry instead of
        the whole header. Without it, `get_ident` takes the entire string, so a
        caller rotating the part they control is handed a new bucket every
        request and the ceiling above stops existing — login brute-force,
        signup enumeration and reset-mail flooding all go uncapped. This drives
        the header the way an attacker behind the proxy would: a rotating first
        hop, the same trusted peer pinned to the end each time.
        """
        cache.clear()
        User.objects.create_user(email="c@b.uz", password="Parol12345", name="C")

        codes = []
        for i in range(20):
            response = self.client.post(
                "/api/auth/login/",
                {"email": "c@b.uz", "password": "Xato12345"},
                # `10.9.<i>.<i>` is the forged first hop; `203.0.113.7` is the
                # peer the proxy vouches for and it never moves.
                HTTP_X_FORWARDED_FOR=f"10.9.{i}.{i}, 203.0.113.7",
            )
            codes.append(response.status_code)
            if response.status_code == 429:
                break

        self.assertIn(
            429,
            codes,
            "a rotating X-Forwarded-For bypassed the login ceiling — NUM_PROXIES is not pinning the trusted hop",
        )


class SessionWorkspaceTests(TestCase):
    """The session answers for the tenant the caller is looking at."""

    def setUp(self) -> None:
        from apps.workspaces.models import Membership, Role, Workspace

        cache.clear()
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.first = Workspace.objects.create(id="ws1", name="Birinchi", slug="ws1", owner=self.user)
        self.second = Workspace.objects.create(id="ws2", name="Ikkinchi", slug="ws2", owner=self.user)
        Membership.objects.create(workspace=self.first, user=self.user, email=self.user.email, role=Role.OWNER)
        Membership.objects.create(workspace=self.second, user=self.user, email=self.user.email, role=Role.ANALYST)

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_without_a_header_the_first_membership_is_the_active_one(self):
        data = self.client.get("/api/auth/session/").data
        self.assertEqual(data["workspaceId"], "ws1")
        self.assertEqual(data["role"], "owner")
        self.assertEqual([w["id"] for w in data["memberships"]], ["ws1", "ws2"])

    def test_the_role_belongs_to_the_workspace_being_viewed(self):
        data = self.client.get("/api/auth/session/", HTTP_X_WORKSPACE_ID="ws2").data
        self.assertEqual(data["workspaceId"], "ws2")
        self.assertEqual(data["role"], "analyst", "a screen renders its buttons from this")

    def test_a_workspace_the_caller_does_not_belong_to_is_ignored(self):
        outsider = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C")
        from apps.workspaces.models import Workspace

        Workspace.objects.create(id="ws3", name="Begona", slug="ws3", owner=outsider)

        data = self.client.get("/api/auth/session/", HTTP_X_WORKSPACE_ID="ws3").data
        self.assertEqual(data["workspaceId"], "ws1")


class TelegramLoginTests(TestCase):
    """The widget's payload is only worth as much as its signature."""

    BOT_TOKEN = "123456:TEST-TOKEN"

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def _payload(self, **overrides) -> dict:
        import hashlib
        import hmac
        import time

        data = {
            "id": 777001,
            "first_name": "Dilnoza",
            "last_name": "Karimova",
            "username": "dilnoza",
            "photo_url": "https://t.me/i/userpic/320/dilnoza.jpg",
            "auth_date": int(time.time()),
            **overrides,
        }
        check = "\n".join(sorted(f"{key}={value}" for key, value in data.items()))
        secret = hashlib.sha256(self.BOT_TOKEN.encode()).digest()
        data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        return data

    def test_a_signed_payload_creates_an_account_and_signs_it_in(self):
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            response = self.client.post("/api/auth/telegram/", self._payload())

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["token"])
        user = User.objects.get(telegram_id=777001)
        self.assertEqual(user.name, "Dilnoza Karimova")
        self.assertTrue(user.email_verified, "Telegram has already established who this is")
        self.assertFalse(user.has_usable_password(), "a Telegram account has no password to guess")

    def test_the_session_says_this_account_has_no_address_of_its_own(self):
        """The synthetic `tg<id>@telegram.local` is plumbing, and the settings
        screen used to draw it in a field labelled "Email". It can only stop
        doing that if the payload says which kind of account it is."""
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            token = self.client.post("/api/auth/telegram/", self._payload()).data["token"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        user = self.client.get("/api/auth/session/").data["user"]

        self.assertTrue(user["viaTelegram"])
        self.assertEqual(user["telegramUsername"], "dilnoza")
        self.assertTrue(user["email"].endswith("@telegram.local"), "which is exactly why the flag is needed")

    def test_an_account_with_a_real_address_is_not_marked_as_a_telegram_one(self):
        user = User.objects.create_user(
            email="aziz@sunrise.uz", password="Parol12345", name="Aziz", email_verified=True
        )
        self.client.force_authenticate(user)

        payload = self.client.get("/api/auth/session/").data["user"]

        self.assertFalse(payload["viaTelegram"])
        self.assertEqual(payload["telegramUsername"], "")

    def test_signing_in_twice_is_the_same_account(self):
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            self.client.post("/api/auth/telegram/", self._payload())
            self.client.post("/api/auth/telegram/", self._payload(first_name="Dilnoza", last_name="Yangi"))

        self.assertEqual(User.objects.filter(telegram_id=777001).count(), 1)
        self.assertEqual(User.objects.get(telegram_id=777001).name, "Dilnoza Yangi", "the name follows Telegram")

    def test_a_tampered_payload_is_refused(self):
        payload = self._payload()
        payload["first_name"] = "Boshqa odam"

        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            response = self.client.post("/api/auth/telegram/", payload)

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "invalid_credentials")
        self.assertFalse(User.objects.exists())

    def test_a_payload_signed_by_another_bot_is_refused(self):
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN="999999:BOSHQA-BOT"):
            response = self.client.post("/api/auth/telegram/", self._payload())

        self.assertEqual(response.status_code, 401)

    def test_a_stale_payload_is_refused(self):
        import time

        old = self._payload(auth_date=int(time.time()) - 60 * 60 * 48)

        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            response = self.client.post("/api/auth/telegram/", old)

        self.assertEqual(response.status_code, 401, "a captured payload must not work forever")


class DevShortcutTests(TestCase):
    """The two shortcuts that make signup testable without an inbox."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def _signup(self):
        return self.client.post(
            "/api/auth/signup/", {"name": "Aziza", "email": "a@b.uz", "password": "Parol12345"}
        )

    def test_by_default_nothing_is_shortened(self):
        response = self._signup()

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("demoToken", response.data, "a code in the response is a development affordance")
        self.assertFalse(User.objects.get(email="a@b.uz").email_verified)

    def test_the_code_comes_back_where_there_is_no_inbox(self):
        with self.settings(DEV_EXPOSE_AUTH_CODES=True):
            response = self._signup()

        code = response.data["demoToken"]
        self.assertTrue(code)
        # And it is the real one: the flow finishes with it.
        verified = self.client.post("/api/auth/verify-email/", {"token": code})
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(User.objects.get(email="a@b.uz").email_verified)

    def test_auto_verify_skips_the_step_and_issues_no_code(self):
        with self.settings(DEV_AUTO_VERIFY_EMAIL=True, DEV_EXPOSE_AUTH_CODES=True):
            response = self._signup()

        self.assertTrue(response.data["user"]["emailVerified"])
        self.assertNotIn("demoToken", response.data, "there is nothing to confirm")
        self.assertFalse(VerificationToken.objects.exists(), "and no mail was sent")

    def test_a_wrong_code_is_reported_as_a_code(self):
        response = self.client.post("/api/auth/verify-email/", {"token": "yoq"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("Kod", response.data["error"]["message"], "the reader typed a code, not a link")


class TelegramWidgetConfigTests(TestCase):
    """The widget is offered only where it can actually work."""

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()
        # Telegram is the only one who knows whether @BotFather has the domain,
        # so the view asks it. Tests answer for it — saying "registered" by
        # default, because every case below is about our own rules.
        patcher = mock.patch("apps.accounts.views.requests.get")
        self.probe = patcher.start()
        self.addCleanup(patcher.stop)
        self.probe.return_value = mock.Mock(status_code=200, text='<div class="tgme_widget_login"></div>')

    def _config(self, host: str | None = None, **settings_overrides):
        with self.settings(**settings_overrides):
            return self.client.get("/api/auth/telegram/config/", {"host": host} if host else {}).data

    def test_no_bot_means_no_widget(self):
        data = self._config(TELEGRAM_LOGIN_BOT_TOKEN="", TELEGRAM_LOGIN_BOT_USERNAME="", TELEGRAM_LOGIN_DOMAIN="")
        self.assertFalse(data["enabled"])
        self.assertEqual(data["reason"], "not_configured")

    def test_a_bot_whose_domain_was_never_registered_is_not_offered(self):
        data = self._config(
            TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="bot", TELEGRAM_LOGIN_DOMAIN=""
        )
        self.assertFalse(data["enabled"])
        self.assertEqual(data["reason"], "domain_not_set")

    def test_a_domain_that_is_not_where_we_are_served_from_is_not_offered(self):
        data = self._config(
            TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="bot", TELEGRAM_LOGIN_DOMAIN="oqim.uz"
        )
        self.assertFalse(data["enabled"], "the widget would render Telegram's own English error")
        self.assertEqual(data["reason"], "domain_mismatch")

    def test_a_registered_domain_enables_it(self):
        data = self._config(
            TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="@bot", TELEGRAM_LOGIN_DOMAIN="testserver"
        )
        self.assertTrue(data["enabled"])
        self.assertEqual(data["botUsername"], "bot")

    def test_telegram_refusing_the_domain_beats_our_own_settings(self):
        """`.env` can only say which domain we *meant* to register.

        When @BotFather has none, Telegram renders "Bot domain invalid" inside
        a cross-origin iframe — English text no stylesheet can reach and no
        script of ours can read, sitting in the middle of the sign-in card.
        Asking Telegram first is what keeps it off the screen.
        """
        self.probe.return_value = mock.Mock(status_code=200, text="Bot domain invalid")

        data = self._config(
            TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="@bot", TELEGRAM_LOGIN_DOMAIN="testserver"
        )

        self.assertFalse(data["enabled"])
        self.assertEqual(data["reason"], "domain_not_registered")

    def test_telegram_being_unreachable_is_not_read_as_a_wrong_domain(self):
        self.probe.side_effect = requests.RequestException("boom")

        data = self._config(
            TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="@bot", TELEGRAM_LOGIN_DOMAIN="testserver"
        )

        # Still not offered — a widget that cannot be verified is one that may
        # print Telegram's error — but the bot link is, and the answer is only
        # cached for a minute.
        self.assertFalse(data["enabled"])
        self.assertTrue(data["botFlow"])

    def test_the_answer_is_cached_rather_than_asked_on_every_page_view(self):
        for _ in range(3):
            self._config(
                TELEGRAM_LOGIN_BOT_TOKEN="1:x", TELEGRAM_LOGIN_BOT_USERNAME="@bot", TELEGRAM_LOGIN_DOMAIN="testserver"
            )

        self.assertEqual(self.probe.call_count, 1, "the sign-in page must not wait on Telegram every time")

    def test_the_panels_own_host_is_what_gets_checked(self):
        """The panel and the API are not served from the same place.

        The interface asks this question from its server, so the request
        arrives from `127.0.0.1` no matter which domain the reader is on —
        checking the request's own host would refuse the widget on every
        deployment that is not a single process.
        """
        settings_kwargs = {
            "TELEGRAM_LOGIN_BOT_TOKEN": "1:x",
            "TELEGRAM_LOGIN_BOT_USERNAME": "bot",
            "TELEGRAM_LOGIN_DOMAIN": "panel.oqim.uz",
        }
        self.assertTrue(self._config(host="panel.oqim.uz:443", **settings_kwargs)["enabled"])
        self.assertFalse(self._config(host="boshqa.uz", **settings_kwargs)["enabled"])

    def test_a_domain_written_as_a_url_still_matches(self):
        """`https://panel.oqim.uz/` is what somebody pastes; it means the host."""
        data = self._config(
            host="panel.oqim.uz",
            TELEGRAM_LOGIN_BOT_TOKEN="1:x",
            TELEGRAM_LOGIN_BOT_USERNAME="bot",
            TELEGRAM_LOGIN_DOMAIN="https://panel.oqim.uz/",
        )
        self.assertTrue(data["enabled"])


class TelegramBotLoginTests(TestCase):
    """Signing in by pressing Start in the bot.

    The flow crosses two channels — a browser and a chat — so the tests below
    are about what joins them: a nonce that only works once, only while it is
    fresh, and only when the update carrying it really came from Telegram.
    """

    BOT = {"TELEGRAM_LOGIN_BOT_TOKEN": "1:x", "TELEGRAM_LOGIN_BOT_USERNAME": "@kirish_bot"}

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def _start(self) -> dict:
        with self.settings(**self.BOT):
            return self.client.post("/api/auth/telegram/start/").data

    def _status(self, nonce: str) -> dict:
        with self.settings(**self.BOT):
            return self.client.get("/api/auth/telegram/status/", {"nonce": nonce}).data

    def _press_start(self, nonce: str, secret: str | None = None, user_id: int = 500123):
        payload = {
            "update_id": 1,
            "message": {
                "message_id": 1,
                "chat": {"id": user_id, "type": "private"},
                "from": {"id": user_id, "first_name": "Dilnoza", "last_name": "Karimova", "username": "dilnoza"},
                "text": f"/start {nonce}".strip(),
            },
        }
        with self.settings(**self.BOT):
            return self.client.post(
                "/api/auth/telegram/bot/",
                payload,
                format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=bot_login.webhook_secret() if secret is None else secret,
            )

    def test_the_link_names_the_bot_and_carries_the_nonce(self):
        data = self._start()

        self.assertTrue(data["nonce"])
        self.assertEqual(data["url"], f"https://t.me/kirish_bot?start={data['nonce']}")
        self.assertEqual(self._status(data["nonce"])["status"], "pending", "nobody has pressed Start yet")

    def test_waiting_costs_the_attempt_nothing(self):
        """The panel asks about once a second until Start is pressed.

        Every one of those asks lands before the approval does, so a status
        check that spent, aged or otherwise disturbed the attempt would break
        the wait it exists to serve: the answer that finally matters is the one
        that arrives *after* a minute of "pending".
        """
        nonce = self._start()["nonce"]

        for _ in range(20):
            self.assertEqual(self._status(nonce)["status"], "pending")

        self._press_start(nonce)

        self.assertTrue(self._status(nonce)["session"]["token"], "the wait still ends in a session")

    def test_pressing_start_signs_the_browser_in(self):
        nonce = self._start()["nonce"]

        self.assertEqual(self._press_start(nonce).status_code, 200)

        data = self._status(nonce)
        self.assertEqual(data["status"], "approved")
        self.assertTrue(data["session"]["token"], "the browser needs a credential, not just a yes")
        user = User.objects.get(telegram_id=500123)
        self.assertEqual(user.name, "Dilnoza Karimova")
        self.assertTrue(user.email_verified, "Telegram already established who this is")
        self.assertFalse(user.has_usable_password(), "no password means no second way in")

    def test_the_same_person_lands_on_the_same_account_twice(self):
        first = self._start()["nonce"]
        self._press_start(first)
        self._status(first)

        second = self._start()["nonce"]
        self._press_start(second)
        self._status(second)

        self.assertEqual(User.objects.filter(telegram_id=500123).count(), 1)

    def test_a_nonce_is_worth_exactly_one_session(self):
        nonce = self._start()["nonce"]
        self._press_start(nonce)

        self.assertEqual(self._status(nonce)["status"], "approved")
        self.assertEqual(self._status(nonce)["status"], "consumed", "it travelled through a chat; once is enough")

    def test_an_update_without_the_secret_approves_nothing(self):
        nonce = self._start()["nonce"]

        response = self._press_start(nonce, secret="men-telegram-emasman")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._status(nonce)["status"], "pending")

    def test_an_expired_attempt_cannot_be_approved(self):
        nonce = self._start()["nonce"]
        TelegramLoginRequest.objects.filter(pk=nonce).update(expires_at=timezone.now() - timedelta(minutes=1))

        self._press_start(nonce)

        self.assertEqual(self._status(nonce)["status"], "expired")
        self.assertFalse(User.objects.filter(telegram_id=500123).exists())

    def test_opening_the_bot_without_a_link_signs_nobody_in(self):
        self._start()

        response = self._press_start("")

        self.assertEqual(response.status_code, 200, "the bot answers rather than making Telegram retry")
        self.assertFalse(User.objects.exists())

    def test_a_nonce_nobody_issued_is_refused_calmly(self):
        response = self._press_start("qalbaki-nonce")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._status("qalbaki-nonce")["status"], "expired")

    def test_the_screens_are_told_the_bot_path_exists(self):
        with self.settings(**self.BOT, TELEGRAM_LOGIN_DOMAIN=""):
            config = self.client.get("/api/auth/telegram/config/").data

        self.assertFalse(config["enabled"], "no registered domain, so no widget")
        self.assertTrue(config["botFlow"], "but pressing Start still works anywhere")


class TelegramWebAppLoginTests(TestCase):
    """`initData` from inside the Telegram client, and what it may not be."""

    BOT_TOKEN = "123456:TEST-TOKEN"

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def _init_data(self, *, token: str | None = None, signature: str | None = None, **overrides) -> str:
        import hashlib
        import hmac
        import json
        import time
        from urllib.parse import urlencode

        user = {
            "id": 777042,
            "first_name": "Dilnoza",
            "last_name": "Karimova",
            "username": "dilnoza",
            "language_code": "uz",
            **overrides.pop("user", {}),
        }
        fields = {
            "user": json.dumps(user, separators=(",", ":")),
            "auth_date": str(int(time.time())),
            "chat_type": "private",
            "chat_instance": "-9000",
            **overrides,
        }
        if signature is not None:
            fields["signature"] = signature
        check = "\n".join(sorted(f"{key}={value}" for key, value in fields.items()))
        secret = hmac.new(b"WebAppData", (token or self.BOT_TOKEN).encode(), hashlib.sha256).digest()
        fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        return urlencode(fields)

    def _post(self, init_data: str, **settings_overrides):
        overrides = {"TELEGRAM_LOGIN_BOT_TOKEN": self.BOT_TOKEN, **settings_overrides}
        with self.settings(**overrides):
            return self.client.post("/api/auth/telegram/webapp/", {"initData": init_data}, format="json")

    def test_signed_init_data_signs_in_without_a_password(self):
        response = self._post(self._init_data())

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["token"])
        self.assertEqual(response.data["user"]["name"], "Dilnoza Karimova")
        self.assertTrue(User.objects.filter(telegram_id=777042).exists())

    def test_the_widget_and_the_mini_app_land_on_one_account(self):
        """Same person, same Telegram id — one account, not two."""
        self._post(self._init_data())
        self._post(self._init_data(user={"first_name": "Dilnoza", "last_name": "K."}))

        self.assertEqual(User.objects.filter(telegram_id=777042).count(), 1)

    def test_a_payload_signed_by_another_bot_is_refused(self):
        response = self._post(self._init_data(token="999:BOSHQA"))

        self.assertEqual(response.status_code, 401)
        self.assertFalse(User.objects.filter(telegram_id=777042).exists())

    def test_editing_a_field_after_signing_is_refused(self):
        """The whole point: the id cannot be swapped for somebody else's."""
        import json
        from urllib.parse import parse_qsl, urlencode

        fields = dict(parse_qsl(self._init_data(), keep_blank_values=True))
        fields["user"] = json.dumps({**json.loads(fields["user"]), "id": 1}, separators=(",", ":"))

        response = self._post(urlencode(fields))

        self.assertEqual(response.status_code, 401)

    def test_an_expired_payload_is_refused(self):
        import time

        response = self._post(self._init_data(auth_date=str(int(time.time()) - 60 * 60 * 25)))

        self.assertEqual(response.status_code, 401)

    def test_the_newer_signature_field_does_not_break_the_hmac(self):
        """Telegram added `signature` later; both readings of it must pass."""
        self.assertEqual(self._post(self._init_data(signature="abc123")).status_code, 200)

    def test_signature_outside_the_signed_string_still_verifies(self):
        """The other reading: some clients hash without `signature`."""
        from urllib.parse import parse_qsl, urlencode

        fields = dict(parse_qsl(self._init_data(), keep_blank_values=True))
        fields["signature"] = "added-after-signing"

        self.assertEqual(self._post(urlencode(fields)).status_code, 200)

    def test_an_inline_mini_app_with_no_user_cannot_sign_anybody_in(self):
        """Opened from an inline button there is a `chat_instance` and no person."""
        from urllib.parse import parse_qsl, urlencode

        fields = dict(parse_qsl(self._init_data(), keep_blank_values=True))
        del fields["user"]

        self.assertEqual(self._post(urlencode(fields)).status_code, 401)

    def test_empty_init_data_is_refused(self):
        self.assertEqual(self._post("").status_code, 401)

    def test_a_deep_link_start_param_comes_back_for_the_interface(self):
        response = self._post(self._init_data(start_param="flows"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["startParam"], "flows")


class ProfileTests(TestCase):
    """What a person may change about themselves, and what changing it costs.

    `ProfileSerializer` has always documented `name` as "what someone may
    change about themselves" and until now no screen offered it: the name on
    every avatar, in the member list and in the header was whatever was typed
    into the signup form once, or whatever Telegram happened to be calling this
    person the day they first pressed Start.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.user.owned_workspaces.first(), user=self.user, email=self.user.email)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_name_can_be_changed_and_comes_back_in_the_session(self):
        response = self.client.patch("/api/auth/session/", {"name": "Aziza Karimova"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["user"]["name"], "Aziza Karimova")
        self.user.refresh_from_db()
        self.assertEqual(self.user.name, "Aziza Karimova")

    def test_the_address_is_not_on_the_list(self):
        """Changing it re-opens the verification question and is a way into the
        account; the profile form is not where that decision is made."""
        self.client.patch("/api/auth/session/", {"email": "boshqa@b.uz"}, format="json")

        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "a@b.uz")

    def test_a_blank_name_is_refused(self):
        """It is drawn as the avatar's initials and as the member row's title;
        an empty one leaves both of them blank with nothing saying why."""
        response = self.client.patch("/api/auth/session/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400, response.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.name, "Aziza")


class TelegramNameOwnershipTests(TestCase):
    """Whose name wins when Telegram's and the account's disagree.

    Telegram accounts follow Telegram — that is deliberate and tested above:
    somebody who renames themselves there expects the panel to catch up. The
    exception this adds is the one case where following is wrong. Now that the
    settings screen offers a name field, a Telegram account could type one, and
    the next sign-in would quietly put it back — a setting with a button next
    to it that undoes itself is worse than no setting at all.
    """

    BOT_TOKEN = "123456:TEST-TOKEN"

    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def _payload(self, **overrides) -> dict:
        import hashlib
        import hmac
        import time

        data = {
            "id": 777042,
            "first_name": "Dilnoza",
            "last_name": "Karimova",
            "username": "dilnoza",
            "photo_url": "https://t.me/i/userpic/320/dilnoza.jpg",
            "auth_date": int(time.time()),
            **overrides,
        }
        check = "\n".join(sorted(f"{key}={value}" for key, value in data.items()))
        secret = hashlib.sha256(self.BOT_TOKEN.encode()).digest()
        data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        return data

    def test_a_name_typed_in_settings_survives_the_next_sign_in(self):
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            self.client.post("/api/auth/telegram/", self._payload())
            user = User.objects.get(telegram_id=777042)

            client = APIClient()
            client.force_authenticate(user)
            client.patch("/api/auth/session/", {"name": "Dilnoza K."}, format="json")

            self.client.post("/api/auth/telegram/", self._payload(first_name="Dilnoza", last_name="Yangi"))

        user.refresh_from_db()
        self.assertEqual(user.name, "Dilnoza K.")

    def test_the_avatar_and_the_username_still_follow_telegram(self):
        """Only the name is the person's to keep. The picture and the @handle
        are facts about their Telegram account, not fields on a form here."""
        with self.settings(TELEGRAM_LOGIN_BOT_TOKEN=self.BOT_TOKEN):
            self.client.post("/api/auth/telegram/", self._payload())
            user = User.objects.get(telegram_id=777042)
            client = APIClient()
            client.force_authenticate(user)
            client.patch("/api/auth/session/", {"name": "Dilnoza K."}, format="json")

            self.client.post("/api/auth/telegram/", self._payload(username="yangi_handle"))

        user.refresh_from_db()
        self.assertEqual(user.telegram_username, "yangi_handle")
