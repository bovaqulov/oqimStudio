"""Market tests: what a workspace can see, and what installing one does.

Two things are worth pinning down here and they pull in opposite directions.
The catalogue is deliberately *not* tenant-scoped — a market nobody else can
see is not a market — so the isolation has to hold at the two points where a
template touches a workspace instead: `?mine=1`, which is the shelf a workspace
published, and `install`, which writes a flow into one.

The other is the promise in `views.py`: an install is a copy. A template
improving later must never change a bot that is already answering customers,
and the only way to know that is still true is to change the template
afterwards and look.
"""

from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.flows.models import Flow, FlowTrigger
from apps.marketplace.models import MarketTemplate, TemplateReview
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

#: A graph with one trigger in it, so an install can be checked for having
#: reindexed what the runtime matches on — a copied graph nobody indexed is a
#: flow that looks installed and answers nothing.
NODES = [
    {"id": "t1", "type": "trigger", "title": "Salom", "dmsTrigger": {"kinds": ["command"], "command": "start"}},
    {"id": "m1", "type": "message", "title": "Javob", "text": "Assalomu alaykum"},
]
EDGES = [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}]


def make_tenant(slug: str, email: str):
    user = User.objects.create_user(email=email, password="Parol12345", name=slug, email_verified=True)
    workspace = Workspace.objects.create(id=slug, name=slug, slug=slug, owner=user)
    Membership.objects.create(workspace=workspace, user=user, email=email, role=Role.OWNER)
    project = Project.objects.create(id=f"{slug}-p", workspace=workspace, name="P", handle="p", created_by=user)
    bot = Bot.objects.create(
        id=f"{slug}-b", workspace=workspace, project=project, handle=f"@{slug}", token="t", enabled_modules=["dms"]
    )
    return user, workspace, project, bot


class MarketCatalogueTests(TestCase):
    def setUp(self) -> None:
        self.user, self.workspace, _, self.bot = make_tenant("ws1", "a@b.uz")
        self.other_user, self.other_workspace, _, self.other_bot = make_tenant("ws2", "b@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        self.public = MarketTemplate.objects.create(
            id="tpl-public", name="Sotuv voronkasi", description="Sotuv", author="Oqim",
            category="sales", module_key="dms", nodes=NODES, edges=EDGES,
        )
        self.draft = MarketTemplate.objects.create(
            id="tpl-draft", name="Qoralama", description="Hali tayyor emas", author="Biz",
            category="support", module_key="dms", is_published=False, owner_workspace=self.workspace,
        )
        self.theirs = MarketTemplate.objects.create(
            id="tpl-theirs", name="Ularniki", description="Boshqa ish maydoni", author="Ular",
            category="content", module_key="dms", is_published=False, owner_workspace=self.other_workspace,
        )

    def _ids(self, response) -> set[str]:
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {row["id"] for row in rows}

    def test_the_catalogue_shows_published_templates_only(self):
        response = self.client.get("/api/market/templates/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._ids(response), {"tpl-public"})

    def test_the_catalogue_is_shared_and_says_so(self):
        """Not tenant-scoped by design: `ws2` browses what `ws1` browses."""
        self.client.force_authenticate(self.other_user)
        response = self.client.get("/api/market/templates/", HTTP_X_WORKSPACE_ID="ws2")
        self.assertEqual(self._ids(response), {"tpl-public"})

    def test_mine_is_the_workspace_shelf_and_stops_at_its_edge(self):
        response = self.client.get("/api/market/templates/?mine=1", HTTP_X_WORKSPACE_ID="ws1")

        # Its own unpublished draft, which the public list never shows — and
        # nothing belonging to the other workspace, published or not.
        self.assertEqual(self._ids(response), {"tpl-draft"})

    def test_a_list_row_carries_no_graph_but_the_detail_does(self):
        listed = self.client.get("/api/market/templates/", HTTP_X_WORKSPACE_ID="ws1")
        rows = listed.data["results"] if isinstance(listed.data, dict) else listed.data
        self.assertNotIn("nodes", rows[0])

        detail = self.client.get("/api/market/templates/tpl-public/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(detail.data["nodes"], NODES)

    def test_an_unpublished_template_is_not_reachable_by_guessing_its_id(self):
        self.client.force_authenticate(self.other_user)
        response = self.client.get("/api/market/templates/tpl-draft/", HTTP_X_WORKSPACE_ID="ws2")
        self.assertEqual(response.status_code, 404)

    def test_signing_in_is_required(self):
        # 403 and not 401: `SessionAuthentication` is first in the list and
        # offers no `WWW-Authenticate`, so DRF has no challenge to send back.
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/market/templates/").status_code, 403)


class InstallTests(TestCase):
    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.other_user, self.other_workspace, _, self.other_bot = make_tenant("ws2", "b@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.template = MarketTemplate.objects.create(
            id="tpl", name="Sotuv voronkasi", description="Sotuv", author="Oqim",
            category="sales", module_key="dms", nodes=NODES, edges=EDGES,
        )

    def _install(self, **overrides):
        payload = {"botId": self.bot.id, **overrides}
        return self.client.post("/api/market/templates/tpl/install/", payload, HTTP_X_WORKSPACE_ID="ws1")

    def test_installing_lays_the_graph_down_as_a_flow_of_this_workspace(self):
        response = self._install()

        self.assertEqual(response.status_code, 201, response.data)
        flow = Flow.objects.get(pk=response.data["id"])
        self.assertEqual((flow.workspace_id, flow.bot_id, flow.project_id), ("ws1", self.bot.id, self.project.id))
        self.assertEqual(flow.nodes, NODES)
        self.assertEqual(flow.origin, {"kind": "template", "key": "tpl", "label": "Shablon · Sotuv voronkasi"})

    def test_the_installed_flow_is_indexed_and_therefore_answers(self):
        flow_id = self._install().data["id"]
        trigger = FlowTrigger.objects.get(flow_id=flow_id)
        self.assertEqual((trigger.kind, trigger.command), ("command", "start"))

    def test_the_copy_does_not_follow_the_template_afterwards(self):
        """The claim in `views.py`: a template improving later must not change
        a bot that is already answering customers."""
        flow_id = self._install().data["id"]

        self.template.nodes = [{"id": "m9", "type": "message", "title": "Yangi", "text": "Boshqacha"}]
        self.template.save(update_fields=["nodes"])

        self.assertEqual(Flow.objects.get(pk=flow_id).nodes, NODES)

    def test_installing_counts(self):
        self._install()
        self._install()
        self.template.refresh_from_db()
        self.assertEqual(self.template.installs, 2)

    def test_a_template_the_runtime_could_not_walk_is_not_installed(self):
        """A shelf nobody can publish to still gets checked.

        Installing writes the blocks verbatim and `reindex_triggers` builds the
        match index off them, so a bad template does not fail at install time —
        it becomes a bot that matches a command, walks to the entry block,
        finds no edge on the port it wants, and goes silent. Refusing here is
        the only place the fault is still attached to the thing that caused it.
        """
        MarketTemplate.objects.filter(pk="tpl").update(
            nodes=[
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "k1", "type": "kod", "title": "Yo'q blok", "text": "salom"},
            ],
            edges=[{"id": "e1", "from": "t1", "port": "success", "to": "k1"}],
        )

        response = self._install()

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "template_invalid")
        self.assertFalse(Flow.objects.exists(), "refused before the write, not after")
        self.assertFalse(FlowTrigger.objects.exists(), "and therefore never indexed")
        self.assertEqual(MarketTemplate.objects.get(pk="tpl").installs, 0, "a refusal is not an install")

    def test_the_refusal_says_the_template_is_at_fault_and_why(self):
        """The person who pressed «install» did nothing wrong, and the reason
        still has to reach whoever maintains the shelf."""
        MarketTemplate.objects.filter(pk="tpl").update(
            nodes=[{"id": "k1", "type": "kod", "title": "Yo'q blok", "text": "salom"}], edges=[]
        )

        message = self._install().data["error"]["message"]

        self.assertIn("shablon", message.lower(), "whose fault it is")
        self.assertIn("kod", message, "and which block")

    def test_it_cannot_be_installed_onto_another_workspaces_bot(self):
        """The one place a template touches a tenant. The bot id is the
        attacker-controlled half, so it is looked up *within* the workspace the
        request resolved to and not on its own."""
        response = self._install(botId=self.other_bot.id)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "bot_not_found")
        self.assertFalse(Flow.objects.filter(workspace=self.other_workspace).exists())

    def test_an_unknown_module_is_refused_before_anything_is_written(self):
        response = self._install(moduleKey="yoq-bunday-bolim")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_module")
        self.assertFalse(Flow.objects.exists())

    def test_an_analyst_may_browse_but_not_install(self):
        analyst = User.objects.create_user(
            email="analitik@b.uz", password="Parol12345", name="Analitik", email_verified=True
        )
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        client = APIClient()
        client.force_authenticate(analyst)

        self.assertEqual(client.get("/api/market/templates/", HTTP_X_WORKSPACE_ID="ws1").status_code, 200)
        response = client.post("/api/market/templates/tpl/install/", {"botId": self.bot.id}, HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Flow.objects.exists())


class ReviewTests(TestCase):
    """A review is a report from use, so every test here installs first.

    That is the rule and not a fixture convenience: the endpoint refuses a
    workspace that has not installed the template, and `test_a_workspace_that_
    never_installed_it_cannot_review` is the one that says so.
    """

    def setUp(self) -> None:
        self.user, self.workspace, _, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.template = MarketTemplate.objects.create(
            id="tpl", name="Shablon", description="D", author="Oqim", category="sales", module_key="dms",
            nodes=NODES, edges=EDGES,
        )
        self.client.post("/api/market/templates/tpl/install/", {"botId": self.bot.id}, HTTP_X_WORKSPACE_ID="ws1")

    def test_a_workspace_that_never_installed_it_cannot_review(self):
        """The verdict on the catalogue's own screen is the one number a reader
        cannot check for themselves, so it is owed by somebody who ran it."""
        stranger, _, _, _ = make_tenant("ws2", "b@b.uz")
        client = APIClient()
        client.force_authenticate(stranger)

        response = client.post(
            "/api/market/templates/tpl/review/", {"rating": 5, "text": "Zo'r"}, HTTP_X_WORKSPACE_ID="ws2"
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["error"]["code"], "not_installed")
        self.assertEqual(TemplateReview.objects.count(), 0)

    def test_deleting_the_installed_flow_takes_the_right_to_review_with_it(self):
        """The origin stamp is the only record of an install, and that is the
        right answer: nothing of it is left in the workspace."""
        Flow.objects.filter(workspace=self.workspace).delete()

        response = self.client.post(
            "/api/market/templates/tpl/review/", {"rating": 4}, HTTP_X_WORKSPACE_ID="ws1"
        )

        self.assertEqual(response.status_code, 403)

    def test_a_review_is_attributed_to_whoever_sent_it(self):
        response = self.client.post(
            "/api/market/templates/tpl/review/", {"rating": 5, "text": "Zo'r"}, HTTP_X_WORKSPACE_ID="ws1"
        )

        self.assertEqual(response.status_code, 201)
        review = TemplateReview.objects.get(pk=response.data["id"])
        self.assertEqual((review.user_id, review.author_name, review.rating), (self.user.id, "ws1", 5))

    def test_a_rating_outside_one_to_five_writes_nothing(self):
        for rating in (0, 6, -1):
            response = self.client.post(
                "/api/market/templates/tpl/review/", {"rating": rating}, HTTP_X_WORKSPACE_ID="ws1"
            )
            self.assertEqual(response.status_code, 400, rating)
            self.assertEqual(response.data["error"]["code"], "invalid_rating")
        self.assertFalse(TemplateReview.objects.exists())

    def test_a_long_review_is_cut_rather_than_refused(self):
        """The column is 500 wide. Truncating loses the tail of an opinion;
        refusing loses the whole of it, and the rating with it."""
        self.client.post(
            "/api/market/templates/tpl/review/", {"rating": 4, "text": "a" * 900}, HTTP_X_WORKSPACE_ID="ws1"
        )
        self.assertEqual(len(TemplateReview.objects.get().text), 500)

    def test_the_score_a_browser_sees_is_the_average_of_the_reviews(self):
        for rating in (5, 4, 3):
            self.client.post("/api/market/templates/tpl/review/", {"rating": rating}, HTTP_X_WORKSPACE_ID="ws1")

        detail = self.client.get("/api/market/templates/tpl/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(detail.data["rating"], 4.0)
        self.assertEqual(len(detail.data["reviews"]), 3)


class CatalogueFactsTests(TestCase):
    """Two facts the browsing screen draws from, both of them about honesty.

    `installed` is what the review form is gated on, and `isDemo` is what keeps
    a seeded row's invented numbers from reading as a record of use.
    """

    def setUp(self) -> None:
        self.user, self.workspace, _, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.installed = MarketTemplate.objects.create(
            id="tpl-in", name="Bor", description="D", author="Oqim", category="sales",
            module_key="dms", nodes=NODES, edges=EDGES,
        )
        self.untouched = MarketTemplate.objects.create(
            id="tpl-out", name="Yo'q", description="D", author="Oqim", category="sales",
            module_key="dms", nodes=NODES, edges=EDGES, is_demo=True,
        )

    def _rows(self):
        response = self.client.get("/api/market/templates/", HTTP_X_WORKSPACE_ID="ws1")
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {row["id"]: row for row in rows}

    def test_installed_names_the_rows_this_workspace_actually_installed(self):
        self.client.post("/api/market/templates/tpl-in/install/", {"botId": self.bot.id}, HTTP_X_WORKSPACE_ID="ws1")

        rows = self._rows()
        self.assertTrue(rows["tpl-in"]["installed"])
        self.assertFalse(rows["tpl-out"]["installed"])

    def test_another_workspaces_install_does_not_count_as_ours(self):
        other_user, _, _, other_bot = make_tenant("ws2", "b@b.uz")
        other = APIClient()
        other.force_authenticate(other_user)
        other.post("/api/market/templates/tpl-in/install/", {"botId": other_bot.id}, HTTP_X_WORKSPACE_ID="ws2")

        self.assertFalse(self._rows()["tpl-in"]["installed"])

    def test_a_seeded_row_is_marked_as_a_sample(self):
        rows = self._rows()
        self.assertTrue(rows["tpl-out"]["isDemo"])
        self.assertFalse(rows["tpl-in"]["isDemo"])
