"""Contact API tests — the screen a clinic's front desk actually works from."""

from __future__ import annotations

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.contacts.models import Contact, ContactTag
from apps.engine.dispatch import dispatch
# The intake graph, not `starter_graph()`: what a *new* flow opens with is a
# product decision that keeps changing, and these tests are about what the bot
# collected — they need a flow that parks and resumes, not whichever screen the
# studio currently greets people with. Since «Savol» was removed the intake
# picks a language; the two collected variables are set directly afterwards, so
# the contact surface still has something to list, export and pick columns from.
from apps.engine.tests import intake_graph, pick_language
from apps.flows.services import ensure_main_flow
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace


def message_update(text: str, user_id: int, update_id: int) -> dict:
    return {
        "update_id": update_id,
        "message": {
            "message_id": update_id,
            "chat": {"id": user_id, "type": "private"},
            "from": {"id": user_id, "first_name": "Dilnoza", "last_name": "Karimova", "username": "dilnoza"},
            "text": text,
        },
    }


class ContactApiTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t", enabled_modules=["dms"]
        )
        self.flow = ensure_main_flow(
            workspace=self.workspace, project=self.project, bot=self.bot, graph=intake_graph()
        )

        # A real conversation, through the runtime: /start parks on the language
        # block, the pick resumes it, and the contact is what it leaves behind.
        dispatch(self.bot, message_update("/start", 501, 1))
        dispatch(self.bot, pick_language("uz", user_id=501))
        # The two variables a front desk actually reads, set the way a «Teg»
        # block would have — «Savol» used to collect them from typed answers.
        collected = Contact.objects.get(bot=self.bot)
        collected.set_variable("mijoz_ismi", "Dilnoza Karimova")
        collected.set_variable("mijoz_telefoni", "+998901112233")

        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_the_list_shows_what_the_bot_collected(self):
        row = self.client.get("/api/contacts/").data["results"][0]

        self.assertEqual(row["displayName"], "Dilnoza Karimova")
        self.assertEqual(row["username"], "dilnoza")
        self.assertEqual(row["variables"]["mijoz_ismi"], "Dilnoza Karimova")
        self.assertEqual(row["variables"]["mijoz_telefoni"], "+998901112233")
        self.assertEqual(row["sourceFlowName"], "Asosiy oqim", "which flow brought them in")

    def test_the_history_is_the_whole_conversation(self):
        contact = Contact.objects.get()
        runs = self.client.get(f"/api/contacts/{contact.id}/history/").data

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["flowName"], "Asosiy oqim")
        self.assertEqual(runs[0]["status"], "done")
        said = [step["text"] for step in runs[0]["steps"]]
        self.assertTrue(any("Tilni tanlang" in text for text in said), "what the bot asked")
        self.assertTrue(any("Rahmat!" in text for text in said), "and what the bot replied")

    def test_the_export_is_readable_in_excel(self):
        response = self.client.get("/api/contacts/export/")

        self.assertEqual(response.status_code, 200)
        body = response.content.decode("utf-8")
        self.assertTrue(body.startswith("﻿"), "without the BOM Excel mangles Uzbek names")
        self.assertIn("Dilnoza Karimova", body)
        self.assertIn("+998901112233", body)
        self.assertIn("Asosiy oqim", body)
        self.assertIn("attachment; filename=", response["Content-Disposition"])

    def test_the_column_picker_offers_the_names_the_flows_wrote(self):
        names = self.client.get("/api/contacts/variable-keys/").data

        self.assertIn("mijoz_ismi", names)
        self.assertIn("mijoz_telefoni", names)
        self.assertEqual(names, sorted(names), "the picker is a list somebody reads")

    def test_the_export_carries_the_columns_the_table_shows(self):
        response = self.client.get("/api/contacts/export/", {"columns": "mijoz_ismi,mijoz_ismi,ismsiz"})

        header, row = response.content.decode("utf-8").splitlines()[:2]
        self.assertEqual(header.count("mijoz_ismi"), 1, "a repeated column would print twice")
        self.assertIn("ismsiz", header, "a name nothing wrote is still a column, just an empty one")
        self.assertIn("Dilnoza Karimova", row)

    def test_filters_narrow_the_list(self):
        other = Contact.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            telegram_user_id=777,
            chat_id=777,
            first_name="Bekzod",
            is_blocked=True,
            last_seen_at=timezone.now(),
        )
        ContactTag.objects.create(contact=other, name="vip")

        self.assertEqual(self.client.get("/api/contacts/", {"q": "Dilnoza"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/contacts/", {"status": "blocked"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/contacts/", {"tag": "vip"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/contacts/", {"flowId": self.flow.id}).data["count"], 1)
        self.assertEqual(self.client.get("/api/contacts/", {"from": "2099-01-01"}).data["count"], 0)

    def test_another_workspace_sees_none_of_it(self):
        outsider = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        other_ws = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=outsider)
        Membership.objects.create(workspace=other_ws, user=outsider, email=outsider.email, role=Role.OWNER)

        client = APIClient()
        client.force_authenticate(outsider)

        self.assertEqual(client.get("/api/contacts/").data["count"], 0)


class ContactLanguageTests(TestCase):
    """Which language the bot decided to speak to a person in.

    Nothing here is a stored column: what the customer chose is a variable any
    flow can write, and what their phone is set to is Telegram's own field. The
    answer is computed from the two every time it is asked for, so a flow that
    sets the variable cannot leave a second copy of it behind to go stale.
    """

    def setUp(self) -> None:
        user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="A", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=user)
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=Role.OWNER)
        project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=project, handle="@b", token="1:x", enabled_modules=["dms"]
        )
        self.client = APIClient()
        self.client.force_authenticate(user)

    def contact(self, **fields) -> Contact:
        fields.setdefault("telegram_user_id", 601)
        return Contact.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            chat_id=fields["telegram_user_id"],
            first_name="Dilnoza",
            **fields,
        )

    def test_a_russian_phone_is_answered_in_russian(self):
        # The common case here, and the reason any of this exists: the phone is
        # set to Russian and the bot is written in both.
        self.assertEqual(self.contact(language_code="ru-RU").language, "ru")

    def test_their_own_choice_outranks_their_phone(self):
        person = self.contact(language_code="ru", variables={"mijoz_tili": "uz"})

        self.assertEqual(person.language, "uz", "a Russian phone in Tashkent says nothing about its owner")

    def test_a_choice_the_bot_no_longer_speaks_is_ignored(self):
        self.bot.settings = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["uz"]}}
        self.bot.save(update_fields=["settings"])
        person = self.contact(language_code="ru", variables={"mijoz_tili": "ru"})

        self.assertEqual(person.language, "uz")

    def test_a_phone_in_a_language_the_bot_does_not_speak_gets_the_main_one(self):
        self.assertEqual(self.contact(language_code="fr").language, "uz")

    def test_a_phone_that_never_said_gets_the_main_one(self):
        self.assertEqual(self.contact(language_code="").language, "uz")

    def test_the_choice_a_flow_records_is_the_one_that_is_read_back(self):
        person = self.contact(language_code="ru")

        person.set_language("uz")
        person.refresh_from_db()

        self.assertEqual(person.variables["mijoz_tili"], "uz", "an ordinary variable, readable as {{mijoz_tili}}")
        self.assertEqual(person.language, "uz")

    def test_the_list_says_both_what_the_phone_asked_and_what_the_bot_decided(self):
        self.contact(language_code="kk")

        row = self.client.get("/api/contacts/").data["results"][0]

        self.assertEqual(row["languageCode"], "kk", "what Telegram sent")
        self.assertEqual(row["language"], "ru", "and what the bot can actually answer in")

    def test_the_export_names_the_language_in_words(self):
        self.contact(language_code="ru")

        body = self.client.get("/api/contacts/export/").content.decode("utf-8")

        header, row = body.splitlines()[:2]
        self.assertIn("Til", header)
        self.assertIn("Ruscha", row, "a front desk reads names, not ISO codes")
