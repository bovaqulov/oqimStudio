"""Tests for the plumbing every app shares: the health probe and the language resolver."""

from __future__ import annotations

from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings

from apps.accounts.models import User
from apps.apikeys.models import issue_key
from apps.workspaces.models import Membership, Role, Workspace

from apps.common.i18n import (
    language_from_telegram,
    normalise_language,
    normalise_text,
    resolve_text,
)


class HealthTests(TestCase):
    def test_the_shallow_probe_touches_nothing(self):
        response = self.client.get("/api/health/", {"deep": "0"})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("checks", response.json(), "a liveness probe must answer while everything else is down")

    def test_every_part_is_reported_separately(self):
        with mock.patch("apps.common.health.check_workers", return_value="1 ta worker"), mock.patch(
            "apps.common.health.check_broker", return_value="ulandi"
        ):
            data = self.client.get("/api/health/").json()

        self.assertTrue(data["ok"])
        self.assertEqual(set(data["checks"]), {"database", "cache", "broker", "workers"})
        self.assertTrue(all("ms" in check for check in data["checks"].values()))

    def test_a_queue_with_no_worker_is_not_healthy(self):
        # The exact outage this exists for: Redis answers, Django answers, and
        # every bot has quietly stopped replying.
        with mock.patch("apps.common.health.check_broker", return_value="ulandi"), mock.patch(
            "apps.common.health.check_workers", side_effect=RuntimeError("worker javob bermadi")
        ):
            response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 503)
        data = response.json()
        self.assertFalse(data["ok"])
        self.assertFalse(data["checks"]["workers"]["ok"])
        self.assertIn("worker javob bermadi", data["checks"]["workers"]["detail"])

    def test_a_broken_cache_is_reported_but_not_fatal(self):
        with mock.patch("apps.common.health.check_broker", return_value="ulandi"), mock.patch(
            "apps.common.health.check_workers", return_value="1 ta worker"
        ), mock.patch("apps.common.health.check_cache", side_effect=RuntimeError("cache yo'q")):
            response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200, "throttling degrades; nothing stops")
        self.assertFalse(response.json()["checks"]["cache"]["ok"])


class ClearDemoTests(TestCase):
    """`clear_demo` removes the seed and nothing else.

    The case that matters is the one this command exists for: by the time
    somebody clears the demo, a real bot is already sitting inside the demo
    workspace. Deleting the tenant would be one line and would take their work
    with it.
    """

    def setUp(self) -> None:
        call_command("seed_demo", days=1, verbosity=0)

        from apps.bots.models import Bot
        from apps.contacts.models import Contact
        from apps.flows.services import ensure_main_flow
        from apps.projects.models import Project
        from apps.workspaces.models import Workspace

        workspace = Workspace.objects.get(pk="sunrise-agency")
        self.mine = Project.objects.create(id="klinika", workspace=workspace, name="Klinika", handle="klinika")
        self.my_bot = Bot.objects.create(
            id="klinika-bot",
            workspace=workspace,
            project=self.mine,
            handle="@klinika_bot",
            token="real-token",
            enabled_modules=["dms"],
        )
        self.my_flow = ensure_main_flow(workspace=workspace, project=self.mine, bot=self.my_bot)
        self.my_contact = Contact.objects.create(
            workspace=workspace, bot=self.my_bot, telegram_user_id=42, chat_id=42, first_name="Muhammadali"
        )

    def test_the_seed_is_gone(self):
        from apps.analytics.models import Event
        from apps.billing.models import Invoice, Plan
        from apps.bots.models import Bot
        from apps.contacts.models import Contact
        from apps.projects.models import Project

        call_command("clear_demo", verbosity=0)

        self.assertFalse(Project.objects.filter(pk="sunrise-academy").exists())
        self.assertFalse(Bot.objects.filter(pk="sunrise-academy-bot").exists())
        self.assertFalse(Contact.objects.filter(bot_id="sunrise-academy-bot").exists())
        self.assertFalse(Event.objects.filter(bot_id="sunrise-academy-bot").exists())
        self.assertFalse(Invoice.objects.exists())
        self.assertTrue(Plan.objects.exists(), "the price list is configuration, not demo data")

    def test_real_records_survive(self):
        from apps.bots.models import Bot
        from apps.contacts.models import Contact
        from apps.flows.models import Flow
        from apps.projects.models import Project
        from apps.workspaces.models import Workspace

        call_command("clear_demo", verbosity=0)

        self.assertTrue(Project.objects.filter(pk=self.mine.pk).exists())
        self.assertTrue(Bot.objects.filter(pk=self.my_bot.pk).exists())
        self.assertTrue(Flow.objects.filter(pk=self.my_flow.pk).exists())
        self.assertTrue(Contact.objects.filter(pk=self.my_contact.pk).exists())

        workspace = Workspace.objects.get(pk="sunrise-agency")
        self.assertFalse(workspace.is_demo, "nothing left in here is made up, so nothing should say it is")

    def test_running_it_twice_is_harmless(self):
        call_command("clear_demo", verbosity=0)
        call_command("clear_demo", verbosity=0)


class ResolveTextTests(SimpleTestCase):
    """Picking the string to send out of what the editor stored.

    The rule this is all built around is the first test: a graph saved before
    any of this existed holds bare strings, and there is no migration that
    could turn one into a translation. If a bare string ever resolved to `""`,
    every bot in production would go silent at once.
    """

    def test_a_bare_string_is_the_bots_own_language(self):
        self.assertEqual(resolve_text("Salom", "uz", fallback="uz"), "Salom")

    def test_a_bare_string_is_still_sent_to_someone_asking_for_another_language(self):
        self.assertEqual(resolve_text("Salom", "ru", fallback="uz"), "Salom", "silence would be the worse answer")

    def test_the_language_asked_for_wins(self):
        value = {"uz": "Salom", "ru": "Privet"}

        self.assertEqual(resolve_text(value, "ru", fallback="uz"), "Privet")
        self.assertEqual(resolve_text(value, "uz", fallback="ru"), "Salom")

    def test_an_untranslated_message_falls_back_to_the_bots_language(self):
        value = {"uz": "Salom", "ru": ""}

        self.assertEqual(resolve_text(value, "ru", fallback="uz"), "Salom")

    def test_whitespace_is_not_a_translation(self):
        self.assertEqual(resolve_text({"uz": "Salom", "ru": "   "}, "ru", fallback="uz"), "Salom")

    def test_the_only_translation_there_is_gets_sent(self):
        # An author who wrote only the Russian half meant it to be sent; an
        # empty message is not a more correct answer than the wrong language.
        self.assertEqual(resolve_text({"ru": "Privet"}, "en", fallback="uz"), "Privet")

    def test_nothing_written_anywhere_is_an_empty_string(self):
        self.assertEqual(resolve_text({"uz": "", "ru": ""}, "uz", fallback="uz"), "")
        self.assertEqual(resolve_text({}, "uz", fallback="uz"), "")
        self.assertEqual(resolve_text(None, "uz", fallback="uz"), "")

    def test_the_answer_does_not_depend_on_the_order_the_keys_were_saved_in(self):
        first = resolve_text({"en": "Hi", "ru": "Privet"}, "de", fallback="de")
        second = resolve_text({"ru": "Privet", "en": "Hi"}, "de", fallback="de")

        self.assertEqual(first, second)

    def test_a_language_nothing_maps_to_is_skipped_rather_than_sent(self):
        self.assertEqual(resolve_text({"xx": "?", "uz": "Salom"}, "uz", fallback="uz"), "Salom")

    def test_a_number_a_block_stored_is_still_text(self):
        self.assertEqual(resolve_text(42, "uz", fallback="uz"), "42")


class NormaliseTextTests(SimpleTestCase):
    """The write side — what the editor saves back."""

    def test_a_bare_string_becomes_the_main_languages_entry(self):
        self.assertEqual(normalise_text("Salom", main="uz"), {"uz": "Salom"})

    def test_the_main_language_always_has_a_field_to_type_into(self):
        self.assertEqual(normalise_text(None, main="ru"), {"ru": ""})
        self.assertEqual(normalise_text({"uz": "Salom"}, main="ru"), {"ru": "", "uz": "Salom"})

    def test_empty_translations_are_not_stored(self):
        result = normalise_text({"uz": "Salom", "ru": "", "en": "  "}, main="uz")

        self.assertEqual(result, {"uz": "Salom"}, "an empty key per language per block adds up")

    def test_text_under_a_language_nothing_maps_to_is_dropped(self):
        # Kept, it would be a field an author can write into and never send.
        self.assertEqual(normalise_text({"uz": "Salom", "de": "Hallo"}, main="uz"), {"uz": "Salom"})

    def test_a_main_language_from_the_wire_is_read_loosely(self):
        self.assertEqual(normalise_text("Privet", main="ru-RU"), {"ru": "Privet"})

    def test_what_it_writes_is_what_resolve_reads(self):
        stored = normalise_text({"uz": "Salom", "ru": "Privet"}, main="uz")

        self.assertEqual(resolve_text(stored, "ru", fallback="uz"), "Privet")
        self.assertEqual(resolve_text(normalise_text("Salom", main="uz"), "ru", fallback="uz"), "Salom")


class TelegramLanguageTests(SimpleTestCase):
    """Guessing a language from the phone, narrowed to what the bot speaks."""

    def test_uzbek_is_uzbek(self):
        self.assertEqual(language_from_telegram("uz", enabled=["uz", "ru"], fallback="uz"), "uz")

    def test_a_regional_tag_is_read_as_its_language(self):
        self.assertEqual(language_from_telegram("ru-RU", enabled=["uz", "ru"], fallback="uz"), "ru")
        self.assertEqual(language_from_telegram("UZ_Latn", enabled=["uz", "ru"], fallback="uz"), "uz")

    def test_the_neighbours_are_served_in_russian(self):
        for code in ("kk", "ky", "tg"):
            with self.subTest(code=code):
                self.assertEqual(language_from_telegram(code, enabled=["uz", "ru"], fallback="uz"), "ru")

    def test_anything_else_is_english_where_the_bot_speaks_it(self):
        self.assertEqual(language_from_telegram("fr", enabled=["uz", "en"], fallback="uz"), "en")

    def test_a_language_the_bot_does_not_speak_becomes_its_main_one(self):
        self.assertEqual(language_from_telegram("fr", enabled=["uz", "ru"], fallback="uz"), "uz")
        self.assertEqual(language_from_telegram("ru", enabled=["uz"], fallback="uz"), "uz")

    def test_a_phone_that_never_said_answers_in_the_bots_language(self):
        # Telegram omits `language_code` often enough that this is the common
        # path, not an edge case — English would be a strange greeting for it.
        self.assertEqual(language_from_telegram("", enabled=["uz", "ru"], fallback="uz"), "uz")
        self.assertEqual(language_from_telegram(None, enabled=["uz", "ru"], fallback="uz"), "uz")

    def test_a_bot_with_no_list_at_all_still_answers(self):
        self.assertEqual(language_from_telegram("ru", enabled=[], fallback="uz"), "uz")

    def test_without_a_list_every_supported_language_is_allowed(self):
        self.assertEqual(language_from_telegram("fr", fallback="uz"), "en")

    def test_a_misconfigured_main_language_falls_back_to_uzbek(self):
        self.assertEqual(language_from_telegram("fr", enabled=["ru"], fallback="de"), "uz")


class NormaliseLanguageTests(SimpleTestCase):
    def test_the_shapes_that_actually_arrive(self):
        self.assertEqual(normalise_language("ru-RU"), "ru")
        self.assertEqual(normalise_language("EN"), "en")
        self.assertEqual(normalise_language("uz_Latn"), "uz")

    def test_anything_unrecognised_is_the_fallback(self):
        self.assertEqual(normalise_language("de"), "uz")
        self.assertEqual(normalise_language(None), "uz")
        self.assertEqual(normalise_language(7, fallback="ru"), "ru")


class UnknownPathTests(TestCase):
    """A path nobody published still answers in the API's own envelope.

    This is the one shape an outside program cannot recover from. Every other
    answer under `/api/` is JSON, so a client parses every answer as JSON; a
    mistyped path that came back as Django's HTML page therefore failed inside
    the caller's JSON parser, with the real cause — "that URL does not exist" —
    written in a `<h1>` nobody read.
    """

    def setUp(self) -> None:
        user = User.objects.create_user(
            email="path@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        workspace = Workspace.objects.create(id="path-ws", name="WS", slug="path-ws", owner=user)
        Membership.objects.create(workspace=workspace, user=user, email=user.email, role=Role.OWNER)
        _, self.key = issue_key(
            workspace=workspace, name="Yozish", scopes=["flows:write"], created_by=user
        )

    def test_an_unknown_path_under_the_open_api_answers_json(self):
        response = self.client.get("/api/v1/messages/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response.json()["error"]["code"], "unknown_endpoint")

    def test_an_unknown_path_under_the_panel_api_answers_json_too(self):
        """The panel reads every answer with the same parser the CRM does."""
        response = self.client.get("/api/nope/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "unknown_endpoint")

    def test_the_message_names_what_was_asked_for(self):
        message = self.client.get("/api/v1/messages/").json()["error"]["message"]

        self.assertIn("/api/v1/messages/", message)
        self.assertIn("GET", message)

    def test_the_body_is_the_envelope_and_nothing_else(self):
        """No route list. The caller has no key — nothing checked one, because
        there is no view on an unrouted path to check it with — so anything
        this body says about the surface is said to whoever mistyped a URL.
        That is the map `config.settings.dev` turns DEBUG off to stop handing
        out."""
        payload = self.client.get("/api/v1/messages/").json()

        self.assertEqual(set(payload), {"error"})
        self.assertEqual(set(payload["error"]), {"code", "message"})
        self.assertNotIn("flows", payload["error"]["message"])

    def test_a_page_outside_the_api_is_left_as_it_was(self):
        """The rule is scoped to `/api/`. The admin and anything else served
        from this process still answer in HTML, because a browser is reading
        them."""
        response = self.client.get("/admin/nope/")

        self.assertNotEqual(response["Content-Type"], "application/json")

    def test_a_get_missing_its_slash_still_redirects(self):
        response = self.client.get("/api/v1/flows")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(response["Location"], "/api/v1/flows/")

    def test_a_post_missing_its_slash_keeps_its_method_and_its_body(self):
        """301 is where an integration loses a graph. curl, requests and fetch
        all answer a 301 by re-sending as GET with no body, so a POST one
        character short of the route arrives at the right path as an empty read
        and comes back 405 — with nothing anywhere saying a body was dropped.
        308 says "same method, same body" and every one of those clients obeys
        it."""
        response = self.client.post("/api/v1/flows/import", {"graph": {}}, content_type="application/json")

        self.assertEqual(response.status_code, 308)
        self.assertEqual(response["Location"], "/api/v1/flows/import/")

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=200)
    def test_a_body_too_big_is_refused_in_the_envelope(self):
        """The same failure as the unknown path, in the other direction: Django
        refuses an oversized body before any view runs, and its refusal is an
        HTML page. A graph is the biggest thing this API takes, so the caller
        who meets this is exactly the one who cannot afford a parse error
        instead of an answer."""
        response = self.client.post(
            "/api/v1/flows/import/",
            data="x" * 4000,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.key}",
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response.json()["error"]["code"], "payload_too_large")


class ErrorLanguageTests(TestCase):
    """DRF's own refusals, in the language the rest of the API answers in.

    Not every English string here was a decision. DRF ships no `uz` catalogue
    at all: the messages that come back in Uzbek do so because Django's own
    catalogue happens to contain that exact English sentence («This field is
    required.»), and the ones that stayed English are the ones only DRF says.
    So the split a caller sees is an accident of which library wrote the
    sentence, which is the worst possible reason for an API to change language
    halfway down a page.
    """

    def setUp(self) -> None:
        user = User.objects.create_user(
            email="lang@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        workspace = Workspace.objects.create(id="lang-ws", name="WS", slug="lang-ws", owner=user)
        Membership.objects.create(workspace=workspace, user=user, email=user.email, role=Role.OWNER)
        _, self.key = issue_key(
            workspace=workspace, name="O'qish", scopes=["flows:read", "flows:write"], created_by=user
        )

    def test_a_wrong_method_is_refused_in_uzbek(self):
        response = self.client.delete("/api/v1/flows/", HTTP_AUTHORIZATION=f"Bearer {self.key}")

        self.assertEqual(response.status_code, 405)
        self.assertEqual(response.json()["error"]["code"], "method_not_allowed")
        self.assertIn("DELETE", response.json()["error"]["message"])
        self.assertNotIn("not allowed", response.json()["error"]["message"])

    def test_a_media_type_nobody_parses_is_refused_in_uzbek(self):
        response = self.client.post(
            "/api/v1/flows/import/", data="salom", content_type="text/plain",
            HTTP_AUTHORIZATION=f"Bearer {self.key}",
        )

        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["error"]["code"], "unsupported_media_type")
        self.assertNotIn("Unsupported", response.json()["error"]["message"])

    def test_the_throttle_message_says_how_long_in_uzbek(self):
        from rest_framework.exceptions import Throttled

        from apps.common.exceptions import api_exception_handler

        response = api_exception_handler(Throttled(wait=12), {"request": None})

        self.assertEqual(response.data["error"]["code"], "rate_limited")
        self.assertIn("12", response.data["error"]["message"])
        self.assertNotIn("throttled", response.data["error"]["message"].lower())

    def test_a_message_somebody_wrote_here_is_never_replaced(self):
        """The substitution only ever fires on a library default. An error this
        codebase worded — `resolve_workspace`'s, for one — keeps its words."""
        from rest_framework.exceptions import PermissionDenied

        from apps.common.exceptions import api_exception_handler

        response = api_exception_handler(
            PermissionDenied("Bu foydalanuvchi hech qaysi ish maydoniga a'zo emas"), {"request": None}
        )

        self.assertEqual(
            response.data["error"]["message"], "Bu foydalanuvchi hech qaysi ish maydoniga a'zo emas"
        )
