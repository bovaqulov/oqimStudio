"""Project API tests, including the cost of a list."""

from __future__ import annotations

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.agents.models import Agent
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace


class ProjectApiTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _project_with_traffic(self, key: str) -> Project:
        project = Project.objects.create(
            id=key, workspace=self.workspace, name=key, handle=key, created_by=self.user
        )
        bot = Bot.objects.create(
            id=f"{key}-bot", workspace=self.workspace, project=project, handle=f"@{key}", token="t"
        )
        Flow.objects.create(workspace=self.workspace, project=project, bot=bot, module_key="dms", name="Oqim")
        Contact.objects.create(
            workspace=self.workspace, bot=bot, telegram_user_id=hash(key) % 10_000, chat_id=1, first_name="X"
        )
        return project

    def test_creating_a_project_derives_a_readable_handle(self):
        response = self.client.post("/api/projects/", {"name": "Sunrise Academy", "description": "Kurslar"})

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["handle"], "sunrise-academy")
        # The name, not the email: a Telegram account's address is synthetic.
        self.assertEqual(response.data["createdBy"], self.user.name)

    def test_the_card_counts_come_from_the_rows_that_exist(self):
        self._project_with_traffic("alfa")

        row = self.client.get("/api/projects/").data["results"][0]

        self.assertEqual(row["flowCountLabel"], "1 oqim")
        self.assertEqual(row["channelsLabel"], "1 bot")
        self.assertEqual(row["contactCountLabel"], "1 kontakt")

    def test_a_longer_list_does_not_cost_more_queries(self):
        self._project_with_traffic("alfa")
        with CaptureQueriesContext(connection) as one_row:
            self.client.get("/api/projects/")

        for key in ("beta", "gamma", "delta"):
            self._project_with_traffic(key)
        with CaptureQueriesContext(connection) as four_rows:
            self.client.get("/api/projects/")

        # The three counts on a card are annotations, not three queries per row.
        self.assertEqual(len(four_rows), len(one_row))


class ProjectDeleteTests(TestCase):
    """Deleting a folder must not delete what is filed in it.

    `Bot.project`, `Flow.project` and `Agent.project` are all `CASCADE`, so the
    refusal in `perform_destroy` is the only thing between a tidy-up and a bot
    that stops answering. None of it was covered until an agent became a
    project's — which is the case the old two-count check would have missed
    outright, because a project holding only agents reads as empty.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.project = Project.objects.create(
            id="p1", workspace=self.workspace, name="Klinika", handle="klinika", created_by=self.user
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _delete(self):
        return self.client.delete(f"/api/projects/{self.project.pk}/", HTTP_X_WORKSPACE_ID="ws")

    def test_an_empty_project_is_deleted(self):
        self.assertEqual(self._delete().status_code, 204)
        self.assertFalse(Project.objects.filter(pk="p1").exists())

    def test_a_project_holding_only_an_agent_is_refused(self):
        """The one the two-count check let through."""
        Agent.objects.create(workspace=self.workspace, project=self.project, name="Qabulxona")

        response = self._delete()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "project_not_empty")
        self.assertIn("agent", response.data["error"]["message"])
        self.assertTrue(Agent.objects.exists(), "refused, so nothing cascaded")

    def test_a_bot_still_refuses_it(self):
        Bot.objects.create(id="b1", workspace=self.workspace, project=self.project, handle="@b", token="t")

        response = self._delete()

        self.assertEqual(response.status_code, 409)
        self.assertIn("bot", response.data["error"]["message"])

    def test_the_message_names_everything_that_is_in_the_way(self):
        """One trip, not three: an author who moves the bots and presses delete
        again should not then be told about the agents."""
        bot = Bot.objects.create(id="b1", workspace=self.workspace, project=self.project, handle="@b", token="t")
        Flow.objects.create(
            workspace=self.workspace, project=self.project, bot=bot, module_key="dms", name="Oqim"
        )
        Agent.objects.create(workspace=self.workspace, project=self.project, name="Qabulxona")

        message = self._delete().data["error"]["message"]

        for expected in ("bot", "oqim", "agent"):
            self.assertIn(expected, message, message)
