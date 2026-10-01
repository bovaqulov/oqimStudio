"""Suhbatlar — that every message is kept, and that answering one is a write.

The first test is the reason this app exists: a message no trigger claims used
to be answered by the safety net and then forgotten, which is exactly the
message an operator opens this screen to read. The safety net is gone now and
the forgetting would be worse without this app, not better — nothing is sent
at all, so the row on this screen is the only trace the message ever arrived.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.engine.dispatch import dispatch
from apps.engine.tests.base import EngineTestCase, message_update
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

from .models import Message


class CaptureTests(EngineTestCase):
    def test_an_unmatched_message_is_kept_though_no_flow_ran(self):
        result = dispatch(self.bot, message_update("assalomu alaykum, narxlari qancha?"))

        # Exactly `no_trigger`, not one of a set. The set held `"fallback"` as
        # well while the safety net could claim the message; nothing produces
        # that word any more, and an assertion that still accepts it is an
        # assertion that would go on passing if the reason changed again.
        self.assertEqual(result["reason"], "no_trigger", "nothing should have claimed this")
        row = Message.objects.get(direction=Message.Direction.IN)
        self.assertEqual(row.text, "assalomu alaykum, narxlari qancha?")
        self.assertEqual(row.contact.telegram_user_id, 555)
        self.assertEqual(row.workspace_id, self.workspace.pk, "denormalised for the tenant filter")

    def test_a_flow_answer_lands_in_the_same_conversation(self):
        self.make_intake_flow()
        dispatch(self.bot, message_update("/start"))

        rows = list(Message.objects.order_by("created_at", "id"))
        self.assertEqual([row.direction for row in rows][:2], ["in", "out"])
        self.assertEqual(rows[0].text, "/start")
        self.assertIn("Tilni tanlang", rows[1].text, "the prompt the flow sent")
        self.assertIsNone(rows[1].operator_id, "the runtime sent it, not a person")

    def test_a_test_run_never_reaches_a_thread(self):
        from apps.engine.runner import start_run

        flow = self.make_intake_flow()
        start_run(flow=flow, entry_node_id="n1", is_test=True)

        self.assertFalse(Message.objects.exists(), "the editor's test chat is not a customer's chat")


class ConversationApiTests(EngineTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.contact = Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=555, chat_id=555, first_name="Dilnoza"
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _message(self, direction: str, text: str, minutes_ago: int) -> Message:
        return Message.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            contact=self.contact,
            direction=direction,
            text=text,
            created_at=timezone.now() - timezone.timedelta(minutes=minutes_ago),
        )

    def test_the_list_carries_the_last_line_of_each_conversation(self):
        self._message("in", "birinchi", 30)
        self._message("out", "oxirgi", 1)

        rows = self.api.get("/api/inbox/conversations/").data
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["contactId"], self.contact.pk)
        self.assertEqual(rows[0]["name"], "Dilnoza")
        # Locked deliberately: this field was `bot.name` first, which the model
        # does not have, and the key simply vanished from the payload instead of
        # failing anywhere — the screen read `undefined` and said nothing.
        self.assertEqual(rows[0]["botHandle"], "@b")
        self.assertEqual(rows[0]["lastMessage"]["text"], "oxirgi")
        self.assertEqual(rows[0]["lastMessage"]["direction"], "out")

    def test_a_conversation_with_nothing_said_is_not_a_conversation(self):
        Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=777, chat_id=777, first_name="Jim"
        )
        self._message("in", "salom", 5)

        rows = self.api.get("/api/inbox/conversations/").data
        self.assertEqual([row["contactId"] for row in rows], [self.contact.pk])

    def test_another_tenants_conversation_is_neither_listed_nor_readable(self):
        other_user = User.objects.create_user(email="b@c.uz", password="Parol12345", name="B", email_verified=True)
        other = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=other_user)
        project = Project.objects.create(id="p2", workspace=other, name="P2", handle="p2")
        bot = Bot.objects.create(id="b2", workspace=other, project=project, handle="@b2", token="t")
        stranger = Contact.objects.create(
            workspace=other, bot=bot, telegram_user_id=1, chat_id=1, first_name="Begona"
        )
        Message.objects.create(workspace=other, bot=bot, contact=stranger, direction="in", text="maxfiy")

        rows = self.api.get("/api/inbox/conversations/").data
        self.assertEqual(rows, [])
        # 404 and not 403: the row is not a permission this caller is missing.
        self.assertEqual(self.api.get(f"/api/inbox/conversations/{stranger.pk}/messages/").status_code, 404)

    def test_the_thread_reads_downwards(self):
        self._message("in", "birinchi", 30)
        self._message("out", "ikkinchi", 20)
        self._message("in", "uchinchi", 10)

        rows = self.api.get(f"/api/inbox/conversations/{self.contact.pk}/messages/").data
        self.assertEqual([row["text"] for row in rows], ["birinchi", "ikkinchi", "uchinchi"])


class ReplyTests(ConversationApiTests):
    def test_an_operator_reply_goes_out_and_is_named(self):
        response = self.api.post(
            f"/api/inbox/conversations/{self.contact.pk}/messages/", {"text": "Salom! Narxlar shu yerda."}
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["direction"], "out")
        self.assertEqual(response.data["operatorName"], "Aziza", "a person answered, not the bot")
        self.assertEqual(Message.objects.filter(direction="out").count(), 1)

    def test_an_empty_message_is_refused_before_it_is_sent(self):
        response = self.api.post(f"/api/inbox/conversations/{self.contact.pk}/messages/", {"text": "   "})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Message.objects.exists())

    def test_an_analyst_may_read_the_thread_and_not_answer_in_it(self):
        analyst = User.objects.create_user(email="c@d.uz", password="Parol12345", name="Anvar", email_verified=True)
        Membership.objects.create(
            workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST
        )
        api = APIClient()
        api.force_authenticate(analyst)

        self.assertEqual(api.get(f"/api/inbox/conversations/{self.contact.pk}/messages/").status_code, 200)
        response = api.post(f"/api/inbox/conversations/{self.contact.pk}/messages/", {"text": "salom"})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Message.objects.exists(), "nothing was sent either")

    def test_a_blocked_contact_is_told_before_the_send_is_attempted(self):
        Contact.objects.filter(pk=self.contact.pk).update(is_blocked=True)

        response = self.api.post(f"/api/inbox/conversations/{self.contact.pk}/messages/", {"text": "salom"})
        self.assertEqual(response.status_code, 409)
        self.assertFalse(Message.objects.exists())
