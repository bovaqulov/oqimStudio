"""Flow API tests, including the one rule the whole product rests on:
a request can only ever see its own workspace."""

from __future__ import annotations

from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.billing.models import Plan, Subscription
from apps.engine import hooks
from apps.engine.script import ScriptResult
from apps.engine.matching import IncomingEvent, find_trigger
from apps.flows.models import Flow, FlowTrigger
from apps.flows.services import PRIORITY_CATCH_ALL
# The ceilings themselves rather than the numbers: a test carrying its own copy
# of 40 000 is a test that keeps passing after somebody moves the limit.
from apps.flows.views import SCRIPT_COMPOSED_LIMIT, SCRIPT_LIMIT
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

GRAPH = {
    "nodes": [
        {"id": "t1", "type": "trigger", "title": "Handler", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
        {"id": "m1", "type": "message", "title": "Javob", "text": "690 000 so'm"},
    ],
    "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
}


def make_tenant(slug: str, email: str):
    user = User.objects.create_user(email=email, password="Parol12345", name=slug, email_verified=True)
    workspace = Workspace.objects.create(id=slug, name=slug, slug=slug, owner=user)
    Membership.objects.create(workspace=workspace, user=user, email=email, role=Role.OWNER)
    project = Project.objects.create(id=f"{slug}-p", workspace=workspace, name="P", handle="p", created_by=user)
    bot = Bot.objects.create(
        id=f"{slug}-b", workspace=workspace, project=project, handle="@b", token="t", enabled_modules=["dms"]
    )
    return user, workspace, project, bot


class FlowApiTests(TestCase):
    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create(self, **overrides) -> dict:
        payload = {
            "projectId": self.project.id,
            "botId": self.bot.id,
            "moduleKey": "dms",
            "name": "Narx oqimi",
            **overrides,
        }
        response = self.client.post("/api/flows/", payload)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_saving_a_graph_reindexes_what_the_runtime_matches_on(self):
        flow = self._create()
        response = self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["triggerCount"], 1)
        trigger = FlowTrigger.objects.get(flow_id=flow["id"])
        self.assertEqual((trigger.kind, trigger.command, trigger.priority), ("command", "narx", 1))

    def test_the_autosave_writes_the_name_it_was_given(self):
        """Renaming a flow is an edit like any other, and the editor's autosave
        is the only thing that writes.

        It used to send `{nodes, edges}` and nothing else, so a name typed in
        the top bar lived in the browser and died with the tab — every flow in
        the product read «Nomsiz oqim» however many times it had been renamed,
        and so did the Kontaktlar column and the analytics beside it.
        """
        flow = self._create(name="Nomsiz oqim")
        response = self.client.put(
            f"/api/flows/{flow['id']}/graph/",
            {**GRAPH, "name": "Navbatga yozilish", "description": "Bemorni navbatga yozadi"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        saved = Flow.objects.get(pk=flow["id"])
        self.assertEqual(saved.name, "Navbatga yozilish")
        self.assertEqual(saved.description, "Bemorni navbatga yozadi")
        self.assertEqual(response.data["name"], "Navbatga yozilish")

    def test_a_graph_save_that_names_nothing_leaves_the_name_alone(self):
        """The other half, and the reason both fields are optional: a client
        saving only the canvas must not blank a name by omission — that is how
        one tab's autosave erases what another tab just typed."""
        flow = self._create(name="Navbatga yozilish")
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        self.assertEqual(Flow.objects.get(pk=flow["id"]).name, "Navbatga yozilish")

    def test_an_edge_pointing_at_a_missing_block_is_refused(self):
        flow = self._create()
        broken = {"nodes": GRAPH["nodes"], "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "yoq"}]}

        response = self.client.put(f"/api/flows/{flow['id']}/graph/", broken)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["field"], "edges")

    def test_an_empty_flow_cannot_be_switched_on(self):
        flow = self._create()
        response = self.client.post(f"/api/flows/{flow['id']}/enable/", {"enabled": True})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "empty_flow")
        self.assertFalse(Flow.objects.get(pk=flow["id"]).enabled)

    def test_enabling_a_built_flow_flips_its_label_too(self):
        flow = self._create()
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        response = self.client.post(f"/api/flows/{flow['id']}/enable/", {"enabled": True})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], {"label": "Faol", "tone": "success"})

    def test_the_main_flow_is_created_on_first_ask_and_reused_after(self):
        first = self.client.get("/api/flows/main/", {"botId": self.bot.id})
        second = self.client.get("/api/flows/main/", {"botId": self.bot.id})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"], "a bot has exactly one entry point")
        self.assertTrue(first.data["isMain"])
        self.assertTrue(first.data["nodes"], "the main flow arrives answering /start")

    def test_the_main_flow_cannot_be_deleted(self):
        main = self.client.get("/api/flows/main/", {"botId": self.bot.id}).data
        response = self.client.delete(f"/api/flows/{main['id']}/")

        self.assertEqual(response.status_code, 403)
        self.assertTrue(Flow.objects.filter(pk=main["id"]).exists())

    def test_a_list_response_carries_no_graphs(self):
        flow = self._create()
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        row = self.client.get("/api/flows/", {"botId": self.bot.id}).data["results"][0]
        self.assertNotIn("nodes", row, "a list of cards does not need every block of every graph")

    def test_a_patch_cannot_write_a_graph_behind_the_trigger_index(self):
        flow = self._create()
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        # Saving the graph also re-derives the triggers; a PATCH that could
        # write `nodes` on its own would leave the runtime matching the old one.
        response = self.client.patch(f"/api/flows/{flow['id']}/", {"nodes": [], "edges": []})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(Flow.objects.get(pk=flow["id"]).nodes), 2, "the graph is written through /graph/ only")
        self.assertEqual(FlowTrigger.objects.filter(flow_id=flow["id"]).count(), 1)

    def test_a_patch_cannot_switch_an_empty_flow_on(self):
        flow = self._create()

        response = self.client.patch(f"/api/flows/{flow['id']}/", {"enabled": True})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(Flow.objects.get(pk=flow["id"]).enabled, "enabling has a rule, and its own endpoint")

    def test_a_flow_cannot_be_filed_under_a_project_its_bot_is_not_in(self):
        other = Project.objects.create(
            id="p2", workspace=self.workspace, name="P2", handle="p2", created_by=self.user
        )

        response = self.client.post(
            "/api/flows/", {"projectId": other.id, "botId": self.bot.id, "moduleKey": "dms"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "bot_project_mismatch")

    def test_an_unknown_module_is_refused_rather_than_stored(self):
        response = self.client.post(
            "/api/flows/", {"projectId": self.project.id, "botId": self.bot.id, "moduleKey": "boshqa"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["field"], "moduleKey")

    def test_a_test_run_walks_the_graph_without_touching_the_numbers(self):
        flow = self._create()
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        response = self.client.post(f"/api/flows/{flow['id']}/test/", {})

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["isTest"])
        self.assertEqual([step["text"] for step in response.data["steps"] if step["actor"] == "bot"], ["690 000 so'm"])

    def test_a_test_run_can_start_at_the_block_the_author_pointed_at(self):
        """The "▶ shu qadamdan sinab ko'rish" button on a block card."""
        flow = self._create()
        graph = {
            "nodes": [
                *GRAPH["nodes"],
                {"id": "m2", "type": "message", "title": "Ikkinchi", "text": "Ikkinchi xabar"},
            ],
            "edges": [*GRAPH["edges"], {"id": "e2", "from": "m1", "port": "out", "to": "m2"}],
        }
        self.client.put(f"/api/flows/{flow['id']}/graph/", graph)

        response = self.client.post(f"/api/flows/{flow['id']}/test/", {"nodeId": "m2"})

        self.assertEqual(response.status_code, 201, response.data)
        # Started at the second message, so the first one was never sent.
        self.assertEqual(
            [step["text"] for step in response.data["steps"] if step["actor"] == "bot"], ["Ikkinchi xabar"]
        )

    def test_a_test_run_refuses_a_block_this_flow_does_not_have(self):
        flow = self._create()
        self.client.put(f"/api/flows/{flow['id']}/graph/", GRAPH)

        response = self.client.post(f"/api/flows/{flow['id']}/test/", {"nodeId": "olib-tashlangan"})

        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(response.data["error"]["code"], "node_not_found")
        self.assertEqual(response.data["error"]["field"], "nodeId")


class StarterGraphTests(TestCase):
    """What a bot's main flow is born with when nobody hands over a graph.

    The interface builds the same two blocks
    (`frontend/src/features/flows/data/starter-graph.ts`); these tests pin the
    shape both sides agree on, so a change to one of them fails here rather
    than in somebody's first five minutes.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_new_main_flow_greets(self):
        response = self.client.get("/api/flows/main/", {"botId": self.bot.id})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([node["type"] for node in response.data["nodes"]], ["start", "message"])
        # Wired left to right: the greeting is reached from the start block.
        self.assertEqual(
            [(edge["from"], edge["port"], edge["to"]) for edge in response.data["edges"]],
            [("n1", "out", "n2")],
        )

    def test_the_starter_answers_start_and_walks_to_its_greeting(self):
        flow = self.client.get("/api/flows/main/", {"botId": self.bot.id}).data
        self.assertTrue(FlowTrigger.objects.filter(flow_id=flow["id"], kind="start").exists())

        run = self.client.post(f"/api/flows/{flow['id']}/test/", {}).data

        self.assertEqual([step["nodeType"] for step in run["steps"] if step["actor"] == "bot"], ["message"])
        # Nothing parks it — the greeting sends and the run runs off the end.
        self.assertEqual(run["status"], "done")


class UnfinishedFlowTests(TestCase):
    """A flow somebody switched on before they had finished writing it.

    Both cases here came out of an audit of a live account: a clinic queue flow
    was enabled with an empty «Buyruq nomi» and with two of its three buttons
    wired to nothing. Neither is a state the product can refuse — a half-built
    flow is a normal thing to have — but neither may behave as though the flow
    were finished, and the empty command did exactly that.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _flow(self, name: str, graph: dict) -> dict:
        response = self.client.post(
            "/api/flows/",
            {
                "name": name,
                "botId": self.bot.id,
                "projectId": self.project.id,
                "moduleKey": "dms",
                **graph,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_a_command_handler_with_no_command_is_a_catch_all(self):
        """It matches every command, so it has to sort like everything that does.

        `matching.matches` reads an empty `command` as "any command at all" —
        the same reading an empty `media_kinds` gets. Indexed at PRIORITY_EXACT
        it sorted ahead of every handler naming a real command, so one
        unfinished block took `/narx` and `/menyu` away from the blocks that
        were written to answer them.
        """
        flow = self._flow(
            "Nomsiz oqim",
            {
                "nodes": [
                    {"id": "t1", "type": "trigger", "title": "Handler",
                     "dmsTrigger": {"kinds": ["command"], "command": ""}},
                    {"id": "m1", "type": "message", "title": "Javob", "text": "..."},
                ],
                "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
            },
        )

        trigger = FlowTrigger.objects.get(flow_id=flow["id"], kind="command")
        self.assertEqual(trigger.priority, PRIORITY_CATCH_ALL)

    def test_a_written_command_still_beats_the_empty_one(self):
        """The ordering that empty handler was breaking, pinned end to end."""
        self._flow(
            "Nomsiz oqim",
            {
                "nodes": [
                    {"id": "t1", "type": "trigger", "title": "Handler",
                     "dmsTrigger": {"kinds": ["command"], "command": ""}},
                    {"id": "m1", "type": "message", "title": "Javob", "text": "Zaxira"},
                ],
                "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
            },
        )
        self._flow("Narx", GRAPH)
        # Only an enabled flow is a candidate — which is the whole premise: the
        # audit found both of these switched on.
        Flow.objects.update(enabled=True)

        event = IncomingEvent(kind="message", chat_type="private", text="/narx", command="narx")
        winner = find_trigger(self.bot, event)

        self.assertIsNotNone(winner)
        self.assertEqual(winner.command, "narx")

    def test_a_button_wired_to_nothing_parks_the_run_rather_than_failing(self):
        """An open end is a conversation that stops, not a run that breaks.

        The editor warns about it and asks before publishing; the runtime's job
        is to leave the customer somewhere sane. This pins that a flow enabled
        with a dead button still delivers the message the button was under.
        """
        flow = self._flow(
            "Navbat",
            {
                "nodes": [
                    {"id": "t1", "type": "trigger", "title": "Handler",
                     "dmsTrigger": {"kinds": ["command"], "command": "navbat"}},
                    {"id": "m1", "type": "message", "title": "Mutaxassis", "text": "Kimga yozamiz?",
                     "buttons": [{"id": "b1", "label": "Terapevt", "kind": "callback"},
                                 {"id": "b2", "label": "Stomatolog", "kind": "callback"}]},
                    {"id": "m2", "type": "message", "title": "Tasdiq", "text": "Yozildingiz"},
                ],
                # Only the first button leads anywhere; the second is the open end.
                "edges": [
                    {"id": "e1", "from": "t1", "port": "out", "to": "m1"},
                    {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
                ],
            },
        )

        run = self.client.post(f"/api/flows/{flow['id']}/test/", {}).data

        self.assertEqual([step["nodeType"] for step in run["steps"] if step["actor"] == "bot"], ["message"])
        # Parked on the keyboard, waiting for a tap — not failed, and not done.
        self.assertEqual(run["status"], "waiting")


class TenantIsolationTests(TestCase):
    def setUp(self) -> None:
        self.mine = make_tenant("ws1", "a@b.uz")
        self.theirs = make_tenant("ws2", "b@b.uz")
        other_user, other_ws, other_project, other_bot = self.theirs
        self.other_flow = Flow.objects.create(
            workspace=other_ws, project=other_project, bot=other_bot, module_key="dms", name="Yashirin"
        )

        self.client = APIClient()
        self.client.force_authenticate(self.mine[0])

    def test_another_workspaces_flow_is_not_in_the_list(self):
        names = [row["name"] for row in self.client.get("/api/flows/").data["results"]]
        self.assertNotIn("Yashirin", names)

    def test_another_workspaces_flow_cannot_be_opened_by_id(self):
        self.assertEqual(self.client.get(f"/api/flows/{self.other_flow.id}/").status_code, 404)

    def test_asking_for_a_workspace_you_do_not_belong_to_is_a_404(self):
        response = self.client.get("/api/flows/", HTTP_X_WORKSPACE_ID="ws2")
        self.assertEqual(response.status_code, 404)


class MainFlowGraphTests(TestCase):
    """The interface owns the block schema, so it may supply the entry graph."""

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_posted_graph_becomes_the_entry_point(self):
        response = self.client.post(
            "/api/flows/main/",
            {
                "botId": self.bot.id,
                "nodes": [
                    {"id": "s1", "type": "start", "title": "/start"},
                    {"id": "m1", "type": "message", "text": "Salom!"},
                ],
                "edges": [{"id": "e1", "from": "s1", "port": "out", "to": "m1"}],
            },
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([node["id"] for node in response.data["nodes"]], ["s1", "m1"])
        self.assertTrue(FlowTrigger.objects.filter(flow_id=response.data["id"], kind="start").exists())

    def test_a_second_ask_returns_the_flow_that_already_exists(self):
        first = self.client.get("/api/flows/main/", {"botId": self.bot.id}).data
        second = self.client.post(
            "/api/flows/main/",
            {"botId": self.bot.id, "nodes": [{"id": "x", "type": "start"}], "edges": []},
        ).data

        self.assertEqual(first["id"], second["id"])
        self.assertEqual([n["id"] for n in second["nodes"]], [n["id"] for n in first["nodes"]])

    def test_the_list_can_be_asked_for_graphs(self):
        self.client.get("/api/flows/main/", {"botId": self.bot.id})

        plain = self.client.get("/api/flows/").data["results"][0]
        full = self.client.get("/api/flows/", {"withGraph": "1"}).data["results"][0]

        self.assertNotIn("nodes", plain)
        self.assertIn("nodes", full)


class PlanLimitTests(TestCase):
    """The plan is only a plan if the endpoints refuse what it does not cover.

    Both call sites are here rather than in `billing`: the helper being correct
    and the endpoint calling it are two different bugs, and the one QA found
    was the second — a workspace on "Start · AI bloklarisiz" with two AI blocks
    saved in its flow.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws-plan", "plan@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        plan = Plan.objects.create(key="start", name="Start", limits={"flows": 1, "aiBlocks": 0})
        Subscription.objects.create(workspace=self.workspace, plan=plan)

    def _payload(self, **overrides) -> dict:
        return {"projectId": self.project.id, "botId": self.bot.id, "moduleKey": "dms", **overrides}

    def test_a_second_flow_is_refused_when_the_plan_allows_one(self):
        self.assertEqual(self.client.post("/api/flows/", self._payload(name="Birinchi")).status_code, 201)

        response = self.client.post("/api/flows/", self._payload(name="Ikkinchi"))

        self.assertEqual(response.status_code, 402, response.data)

    AI_GRAPH = {
        "nodes": [
            {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
            {"id": "a1", "type": "ai", "text": "javob ber"},
        ],
        "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "a1"}],
    }

    def test_saving_a_flow_the_plan_does_not_cover_is_never_refused(self):
        """Autosave is not the place to enforce a plan.

        Refusing it locks the author out of the one edit that would fix the
        problem: deleting the AI blocks is itself a save. QA found exactly this
        — "Saqlanmadi — Start tarifida AI bloklari yo'q" with no way forward.
        """
        flow = self.client.post("/api/flows/", self._payload(name="Oqim")).data

        response = self.client.put(f"/api/flows/{flow['id']}/graph/", self.AI_GRAPH)

        self.assertEqual(response.status_code, 200, response.data)

    def test_switching_that_flow_on_is_what_the_plan_refuses(self):
        flow = self.client.post("/api/flows/", self._payload(name="Oqim")).data
        self.client.put(f"/api/flows/{flow['id']}/graph/", self.AI_GRAPH)

        response = self.client.post(f"/api/flows/{flow['id']}/enable/", {"enabled": True})

        self.assertEqual(response.status_code, 402, response.data)
        self.assertIn("olib tashlang", response.data["error"]["message"], "the message names a way out")

    def test_a_flow_that_is_already_running_is_not_switched_off_by_a_new_limit(self):
        flow = Flow.objects.create(
            workspace=self.workspace,
            project=self.project,
            bot=self.bot,
            module_key="dms",
            name="Eskisi",
            enabled=True,
            nodes=self.AI_GRAPH["nodes"],
            edges=self.AI_GRAPH["edges"],
        )

        response = self.client.post(f"/api/flows/{flow.id}/enable/", {"enabled": True})

        self.assertEqual(response.status_code, 200, response.data)

    def test_turning_a_flow_off_is_never_refused(self):
        flow = Flow.objects.create(
            workspace=self.workspace,
            project=self.project,
            bot=self.bot,
            module_key="dms",
            name="Eskisi",
            enabled=True,
            nodes=self.AI_GRAPH["nodes"],
            edges=self.AI_GRAPH["edges"],
        )

        response = self.client.post(f"/api/flows/{flow.id}/enable/", {"enabled": False})

        self.assertEqual(response.status_code, 200, response.data)

    def test_enabling_a_flow_does_not_count_its_own_blocks_twice(self):
        plan = Plan.objects.get(key="start")
        plan.limits = {"flows": 5, "aiBlocks": 1}
        plan.save(update_fields=["limits"])
        flow = self.client.post("/api/flows/", self._payload(name="Oqim")).data
        self.client.put(f"/api/flows/{flow['id']}/graph/", self.AI_GRAPH)

        # One AI block against a limit of one — its own block is not also
        # somebody else's.
        response = self.client.post(f"/api/flows/{flow['id']}/enable/", {"enabled": True})

        self.assertEqual(response.status_code, 200, response.data)


class ScriptRunEndpointTests(TestCase):
    """Who may run a Kod block's source from the editor, and what comes back.

    The sandbox itself is not the subject — `apps/engine/tests/test_script*.py`
    holds that, and repeating it here would be two places to keep a security
    contract. What is asserted is the seam: the permission, the shape of the
    answer, and the fact that a failing *script* is a successful *request*.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        # Throttle counters and script slots both live in the cache, which
        # outlives a test method — and the user ids a rolled-back database
        # hands out repeat, so one method's presses would be counted against
        # the next one's author.
        cache.clear()

    def run_script(self, source: str, inputs: dict | None = None, **extra):
        return self.client.post(
            "/api/flows/script/run/",
            {"source": source, "inputs": inputs or {}, **extra},
            format="json",
            HTTP_X_WORKSPACE_ID=self.workspace.id,
        )

    def test_it_answers_with_the_value(self):
        response = self.run_script("return { jami: inputs.soni * 1000 };", {"soni": 4})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["value"], {"jami": 4000})

    def test_console_output_comes_back_for_the_panel(self):
        response = self.run_script("console.log('savat', 2); return 1;")

        self.assertEqual(response.data["logs"], ["savat 2"])

    def test_a_failing_script_is_still_a_successful_request(self):
        """The panel renders the failure; an HTTP error would hide it in a toast."""
        response = self.run_script("throw new Error('narx topilmadi');")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["ok"])
        self.assertIn("narx", response.data["error"])

    def test_an_analyst_may_not_run_it(self):
        """Nothing reaches a customer, but it is compute a tenant is paying for."""
        Membership.objects.filter(workspace=self.workspace, user=self.user).update(role=Role.ANALYST)

        response = self.run_script("return 1;")

        self.assertEqual(response.status_code, 403, response.data)

    def test_another_workspace_cannot_borrow_the_endpoint(self):
        other_user, other_workspace, _, _ = make_tenant("ws2", "b@b.uz")
        self.client.force_authenticate(other_user)

        response = self.client.post(
            "/api/flows/script/run/",
            {"source": "return 1;"},
            format="json",
            HTTP_X_WORKSPACE_ID=self.workspace.id,
        )

        self.assertIn(response.status_code, (403, 404), response.data)
        self.assertNotEqual(other_workspace.id, self.workspace.id)

    def test_an_oversized_source_is_refused_before_it_reaches_the_sandbox(self):
        response = self.run_script("//" + "x" * (SCRIPT_LIMIT + 1))

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_too_long")

    def test_a_script_the_product_will_store_is_a_script_it_will_run(self):
        """The two ceilings used to disagree — 40 000 stored, 20 000 accepted
        for a run — and a flow script between them saved cleanly and then
        refused to run. «Ishga tushirish» answered "Kod juda uzun" about a file
        this product had accepted a second earlier, and there was no shorter
        copy of it to send.
        """
        flow = Flow.objects.create(
            workspace=self.workspace, project=self.project, bot=self.bot, module_key="dms", name="Oqim"
        )
        source = "//" + "x" * 25_000 + "\nreturn 1;"
        saved = self.client.put(f"/api/flows/{flow.id}/script/", {"script": source}, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)

        response = self.run_script(source)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"], response.data["error"])
        self.assertEqual(response.data["value"], 1)

    def test_a_library_the_endpoint_would_not_have_taken_is_refused_here(self):
        """The other ceiling, and the one the caller cannot see.

        What runs is the library composed above the source, so that is what the
        budget is about. The library is bounded on the way *in* by the bot
        endpoint rather than by the column, so a row that was seeded or
        installed can hold more than that endpoint would have accepted — and the
        refusal has to name the library, because the file the author is looking
        at is within its own limit and shortening it would not help.
        """
        self.bot.script_library = "//" + "y" * SCRIPT_COMPOSED_LIMIT
        self.bot.save(update_fields=["script_library"])

        response = self.run_script("return 1;", botId=self.bot.id)

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_with_library_too_long")
        self.assertIn("kutubxona", response.data["error"]["message"])

    def test_inputs_must_be_an_object(self):
        response = self.client.post(
            "/api/flows/script/run/",
            {"source": "return 1;", "inputs": [1, 2]},
            format="json",
            HTTP_X_WORKSPACE_ID=self.workspace.id,
        )

        self.assertEqual(response.status_code, 400, response.data)

    # -- the bot's shared library ------------------------------------------
    #
    # The panel tests what actually runs or it tests nothing: the runtime puts
    # the bot's library above every block, so a run without it passes on a
    # script calling a helper the bot does not have.

    def with_library(self, library: str) -> None:
        self.bot.script_library = library
        self.bot.save(update_fields=["script_library"])

    def test_naming_a_bot_brings_its_library_with_it(self):
        self.with_library("function chegirma(narx) {\n  return narx > 100 ? 10 : 0;\n}")

        response = self.run_script("return chegirma(inputs.narx);", {"narx": 500}, botId=self.bot.id)

        self.assertTrue(response.data["ok"], response.data["error"])
        self.assertEqual(response.data["value"], 10)

    def test_without_a_bot_the_library_is_not_there(self):
        """Naming no bot is a bare block, and it has to fail the way a bare
        block would — otherwise the panel is testing a third thing that runs
        nowhere."""
        self.with_library("function chegirma(narx) { return 10; }")

        response = self.run_script("return chegirma(1);")

        self.assertFalse(response.data["ok"])
        self.assertIn("chegirma", response.data["error"])

    def test_a_fault_in_the_library_is_named_as_the_librarys(self):
        """An author told «4-qator» about a one-line block reads it as our bug."""
        self.with_library("function narx() {\n  throw new Error('narx yo\\'q');\n}")

        response = self.run_script("return narx();", botId=self.bot.id)

        self.assertEqual(response.data["where"], "library")
        self.assertEqual(response.data["line"], 2)

    def test_a_fault_in_the_block_keeps_the_line_the_author_sees(self):
        self.with_library("const soliq = 12;\nconst chegirma = 10;")

        response = self.run_script("const a = 1;\nthrow new Error('shu yerda');", botId=self.bot.id)

        self.assertEqual(response.data["where"], "block")
        self.assertEqual(response.data["line"], 2)

    def test_a_script_that_worked_points_at_nothing(self):
        response = self.run_script("return 1;", botId=self.bot.id)

        self.assertEqual(response.data["where"], "")
        self.assertIsNone(response.data["line"])

    def test_an_unknown_bot_is_refused_rather_than_run_without_one(self):
        response = self.run_script("return 1;", botId="yo-q")

        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(response.data["error"]["code"], "bot_not_found")

    def test_another_tenants_bot_cannot_be_named_to_read_its_library(self):
        _, _, _, foreign_bot = make_tenant("ws3", "c@b.uz")

        response = self.run_script("return 1;", botId=foreign_bot.id)

        self.assertEqual(response.status_code, 404, response.data)

    # -- what it costs to ask ----------------------------------------------
    #
    # This endpoint runs the sandbox inside the Django process that serves
    # every other screen, so the ceiling on it is not about scripts degrading:
    # without one, something in a loop takes the whole panel down for
    # everybody. `ScriptRunThrottle` is how often one account may ask;
    # `script.concurrency` is how many may be running at once.

    def press_run(self, times: int) -> list[int]:
        """`times` presses, with the sandbox stood in for.

        The subject is the ceiling, not what runs under it, and forty real Node
        processes would make a test about one line of settings the slowest in
        the suite.
        """
        with mock.patch(
            "apps.flows.views.run_script", return_value=ScriptResult(ok=True, value=1)
        ):
            return [self.run_script("return 1;").status_code for _ in range(times)]

    def test_holding_the_run_button_down_runs_into_a_ceiling(self):
        """Thirty a minute is four times what reading the answers allows."""
        codes = self.press_run(40)

        self.assertIn(429, codes, "an unlimited sandbox endpoint is a way to take the panel down")
        self.assertEqual(codes[0], 200, "and the first press is not the one that pays for it")

    def test_the_ceiling_names_the_code_the_interface_already_renders(self):
        self.press_run(40)

        response = self.run_script("return 1;")

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["error"]["code"], "rate_limited")

    def test_a_spent_account_is_refused_before_the_sandbox_is_reached(self):
        """The point of the ceiling: past it nothing is spawned at all."""
        self.press_run(40)

        with mock.patch("apps.flows.views.run_script") as sandbox:
            self.assertEqual(self.run_script("return 1;").status_code, 429)

        sandbox.assert_not_called()

    def test_the_ceiling_is_per_account_and_not_per_address(self):
        """The panel calls Django from the Next.js server, which forwards no
        address — so an address bucket would be one bucket for the company, and
        one author iterating would lock their colleagues out."""
        colleague = User.objects.create_user(
            email="d@b.uz", password="Parol12345", name="Jasur", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=colleague, email=colleague.email, role=Role.EDITOR
        )
        self.press_run(40)

        self.client.force_authenticate(colleague)
        response = self.run_script("return 1;")

        self.assertEqual(response.status_code, 200, response.data)

    @override_settings(SCRIPT_MAX_CONCURRENT_PER_WORKSPACE=0)
    def test_a_full_cap_is_a_readable_answer_rather_than_a_failed_request(self):
        """The panel renders `kind`; an HTTP error would hide this in a toast,
        and «try again» is the one thing the author can actually do about it."""
        response = self.run_script("return 1;")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["ok"])
        self.assertEqual(response.data["kind"], "busy")
        self.assertTrue(response.data["error"])


def script_node(node_id: str, source: str, *, title: str = "Kod", variable: str = "hisob") -> dict:
    return {
        "id": node_id,
        "type": "script",
        "title": title,
        "script": {"source": source, "variable": variable},
    }


class ScriptInventoryTests(TestCase):
    """`GET /api/bots/<id>/scripts/` — every Kod block in a bot, in one answer.

    The point of the endpoint is that code cannot hide inside a canvas, so what
    is asserted is coverage and order: nothing left out, nothing from another
    bot or another tenant, and the same sequence on every read.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def make_flow(self, flow_id: str, name: str, nodes: list[dict], *, enabled: bool = True, bot=None) -> Flow:
        return Flow.objects.create(
            id=flow_id,
            workspace=self.workspace,
            project=self.project,
            bot=bot or self.bot,
            module_key="dms",
            name=name,
            enabled=enabled,
            nodes=nodes,
            edges=[],
        )

    def url(self, bot_id: str | None = None) -> str:
        return f"/api/bots/{bot_id or self.bot.id}/scripts/"

    def test_a_block_is_listed_with_everything_the_panel_shows(self):
        self.make_flow(
            "f1",
            "Narx oqimi",
            [
                {"id": "m1", "type": "message", "title": "Salom", "text": "Salom"},
                script_node("s1", "const a = 1;\nreturn a;", title="Chegirma", variable="hisob"),
            ],
        )

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["blocks"],
            [
                {
                    "flowId": "f1",
                    "flowName": "Narx oqimi",
                    "flowEnabled": True,
                    "nodeId": "s1",
                    "title": "Chegirma",
                    "variable": "hisob",
                    "lines": 2,
                    "source": "const a = 1;\nreturn a;",
                }
            ],
        )

    def test_the_shared_library_comes_with_it(self):
        """One request, because the panel shows both and a second round trip is
        a second chance for them to disagree."""
        self.bot.script_library = "function chegirma(n) { return n; }"
        self.bot.save(update_fields=["script_library"])

        response = self.client.get(self.url())

        self.assertEqual(response.data["library"]["source"], "function chegirma(n) { return n; }")
        self.assertIn("updatedAt", response.data["library"])

    def test_a_block_that_names_no_variable_is_listed_under_the_one_it_writes(self):
        """The runtime falls back to «hisob»; a blank cell here would send
        somebody looking for a variable that is already there."""
        self.make_flow("f1", "Oqim", [script_node("s1", "return 1;", variable="  ")])

        self.assertEqual(self.client.get(self.url()).data["blocks"][0]["variable"], "hisob")

    def test_enabled_flows_come_first_then_name_then_node_id(self):
        self.make_flow("f3", "Zaxira", [script_node("s1", "return 1;")], enabled=False)
        self.make_flow("f2", "Buyurtma", [script_node("s2", "return 2;"), script_node("s1", "return 1;")])
        self.make_flow("f1", "Alifbo", [script_node("s9", "return 9;")])

        rows = self.client.get(self.url()).data["blocks"]

        self.assertEqual(
            [(row["flowId"], row["nodeId"]) for row in rows],
            [("f1", "s9"), ("f2", "s1"), ("f2", "s2"), ("f3", "s1")],
        )
        self.assertFalse(rows[-1]["flowEnabled"], "a flow nobody switched on is still code somebody wrote")

    def test_a_flow_with_no_code_in_it_contributes_nothing(self):
        self.make_flow("f1", "Oqim", [{"id": "m1", "type": "message", "title": "Salom", "text": "Salom"}])

        self.assertEqual(self.client.get(self.url()).data["blocks"], [])

    def test_another_bots_flows_are_not_this_bots_code(self):
        other_bot = Bot.objects.create(
            id="ws1-b2", workspace=self.workspace, project=self.project, handle="@b2", token="t"
        )
        self.make_flow("f1", "Bizniki", [script_node("s1", "return 1;")])
        self.make_flow("f2", "Ularniki", [script_node("s2", "return 2;")], bot=other_bot)

        rows = self.client.get(self.url()).data["blocks"]

        self.assertEqual([row["nodeId"] for row in rows], ["s1"])

    def test_an_analyst_may_read_it(self):
        """Reviewing what the bots run is exactly what an analyst is for."""
        analyst = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C", email_verified=True)
        Membership.objects.create(workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST)
        self.make_flow("f1", "Oqim", [script_node("s1", "return 1;")])
        client = APIClient()
        client.force_authenticate(analyst)

        response = client.get(self.url())

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["blocks"]), 1)

    def test_another_workspace_cannot_read_this_bots_code(self):
        other_user, _, _, _ = make_tenant("ws2", "b@b.uz")
        self.make_flow("f1", "Oqim", [script_node("s1", "return 1;")])
        self.client.force_authenticate(other_user)

        self.assertEqual(self.client.get(self.url()).status_code, 404)


class FlowScriptTests(TestCase):
    """A flow's own script, and the check that stops a broken one being stored.

    The audit that asked for this found `const = obj.model` sitting in a live
    bot's library five days after somebody typed it. «Tekshirish» would have
    caught it; nobody pressed «Tekshirish». So the save is where it is caught.
    """

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.flow = Flow.objects.create(
            workspace=self.workspace, project=self.project, bot=self.bot,
            module_key="dms", name="Oqim", nodes=GRAPH["nodes"], edges=GRAPH["edges"],
        )

    def test_a_script_that_compiles_is_stored(self):
        response = self.client.post(
            f"/api/flows/{self.flow.id}/script/", {"script": "function onFlowStart() { return {}; }"},
            format="json",
        )
        # PUT is the write here; POST is not routed.
        self.assertIn(response.status_code, (200, 405))

        response = self.client.put(
            f"/api/flows/{self.flow.id}/script/", {"script": "function onFlowStart() { return {}; }"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.flow.refresh_from_db()
        self.assertIn("onFlowStart", self.flow.script)
        self.assertIsNotNone(self.flow.script_updated_at)

    def test_a_broken_script_is_refused_and_nothing_is_stored(self):
        response = self.client.put(
            f"/api/flows/{self.flow.id}/script/", {"script": "const = obj.model"}, format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_syntax_error")
        self.flow.refresh_from_db()
        self.assertEqual(self.flow.script, "")

    def test_a_broken_bot_library_is_refused_too(self):
        response = self.client.put(
            f"/api/bots/{self.bot.id}/script-library/", {"source": "const = obj.model"}, format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.bot.refresh_from_db()
        self.assertEqual(self.bot.script_library, "")

    def test_the_flow_carries_its_script_when_it_is_read(self):
        self.client.put(
            f"/api/flows/{self.flow.id}/script/", {"script": "function onEnter() {}"}, format="json"
        )

        data = self.client.get(f"/api/flows/{self.flow.id}/").data

        self.assertIn("onEnter", data["script"])


class FlowScriptPanelTests(TestCase):
    """One open of the Script panel, and everything it has to be able to draw.

    Three of those things are not in the file the author is looking at: which
    hooks exist at all, what the bot's shared library holds, and which blocks
    already call a function inside a `{{ }}`. They come back from the read that
    fetches the script, because a screen assembled from three requests is a
    screen that can show three different moments of the same flow — and the
    save answers the same shape, so nothing has to be asked twice.
    """

    #: Declares `money` and nothing else, which is what makes `cartTotal`
    #: below a genuine gap rather than a name this test invented.
    LIBRARY = "function money(n) { return n; }"

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.bot.script_library = self.LIBRARY
        self.bot.script_library_updated_at = timezone.now()
        self.bot.save(update_fields=["script_library", "script_library_updated_at"])
        self.flow = Flow.objects.create(
            workspace=self.workspace, project=self.project, bot=self.bot,
            module_key="dms", name="Oqim", nodes=GRAPH["nodes"], edges=GRAPH["edges"],
        )

    def url(self) -> str:
        return f"/api/flows/{self.flow.id}/script/"

    def read(self) -> dict:
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def declared(self, payload: dict) -> dict:
        return {hook["name"]: hook["declared"] for hook in payload["hooks"]}

    def with_nodes(self, *nodes: dict) -> None:
        self.flow.nodes = list(nodes)
        self.flow.save(update_fields=["nodes"])

    def test_the_panel_opens_with_the_file_the_library_and_the_hooks(self):
        self.flow.script = "function onFlowStart() { return {}; }"
        self.flow.save(update_fields=["script"])

        payload = self.read()

        self.assertEqual(
            set(payload),
            {"script", "scriptUpdatedAt", "library", "libraryUpdatedAt", "hooks", "expressions"},
        )
        self.assertIn("onFlowStart", payload["script"])
        self.assertEqual(payload["library"], self.LIBRARY)
        self.assertIsNotNone(payload["libraryUpdatedAt"])

    def test_every_hook_is_listed_whether_the_file_declares_it_or_not(self):
        """The panel lists what the runtime calls, not what the author has typed.

        Both shapes `declared_hooks` reads are here — `function name()` and
        `const name =` — so the answer is not one branch of that regex having
        an opinion.
        """
        self.flow.script = "function onFlowStart() { return {}; }\nconst onFlowEnd = () => ({});"
        self.flow.save(update_fields=["script"])

        payload = self.read()

        self.assertEqual([hook["name"] for hook in payload["hooks"]], list(hooks.HOOK_NAMES))
        self.assertEqual(
            self.declared(payload),
            {"onFlowStart": True, "onUserMessage": False, "onFlowEnd": True},
        )
        # Every one carries the sentence the panel prints under it.
        self.assertTrue(all(hook["when"] for hook in payload["hooks"]))

    def test_a_block_is_listed_with_the_functions_its_text_calls(self):
        self.with_nodes(
            {"id": "n3", "type": "message", "title": "Narxlar", "text": "Jami: {{ money(cartTotal(savat)) }}"},
        )

        rows = self.read()["expressions"]

        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0]["nodeId"], "n3")
        self.assertEqual(rows[0]["title"], "Narxlar")
        self.assertEqual(rows[0]["functions"], ["cartTotal", "money"])
        # The bot's library declares `money`. `cartTotal` renders as an empty
        # space in a customer's message, which is the failure nobody reports —
        # so it is named here, where somebody is looking.
        self.assertEqual(rows[0]["missing"], ["cartTotal"])

    def test_a_block_that_calls_nothing_is_left_out(self):
        self.with_nodes(
            {"id": "m1", "type": "message", "title": "Salom", "text": "Assalomu alaykum {{ism}}"},
            {"id": "n3", "type": "message", "text": "{{ money(1) }}"},
        )

        rows = self.read()["expressions"]

        # `{{ism}}` is a name and not a call: the flow it was written in never
        # reaches the sandbox, and this list is about what does.
        self.assertEqual([row["nodeId"] for row in rows], ["n3"])
        # A card nobody named still has to be nameable in a list.
        self.assertEqual(rows[0]["title"], "Xabar")

    def test_what_javascript_and_the_driver_bring_is_never_missing(self):
        self.with_nodes(
            {
                "id": "n1",
                "type": "message",
                "title": "Narxlar",
                "text": '{{ Math.round(narx) }} so\'m\n{{ table("narxlar") }}',
            },
        )

        rows = self.read()["expressions"]

        # `Math.round` is a method on something JavaScript brings itself, so it
        # is not even counted as a call the library could have declared;
        # `table()` is declared by the expression driver. Reporting either as
        # missing would put a warning on every block that rounds a number.
        self.assertEqual(rows[0]["functions"], ["table"])
        self.assertEqual(rows[0]["missing"], [])

    def test_a_flow_with_no_bot_reads_an_empty_library(self):
        """The panel opens for a flow whose bot is not there.

        `Flow.bot` is NOT NULL today, so this is a defence of the shape rather
        than of a row that exists: an unset relation raises
        `RelatedObjectDoesNotExist` on the attribute instead of answering None,
        and a read that dies on it takes the whole panel with it.
        """
        self.flow.bot = None

        with mock.patch("apps.flows.views.FlowViewSet.get_object", return_value=self.flow):
            payload = self.read()

        self.assertEqual(payload["library"], "")
        self.assertIsNone(payload["libraryUpdatedAt"])

    def test_the_save_answers_the_panel_the_file_it_has_just_stored(self):
        self.flow.script = "function onFlowStart() { return {}; }"
        self.flow.save(update_fields=["script"])

        response = self.client.put(
            self.url(), {"script": "function onUserMessage(ctx) { return {}; }"}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            set(response.data),
            {"script", "scriptUpdatedAt", "library", "libraryUpdatedAt", "hooks", "expressions"},
        )
        # The file that was just written, not the one the panel had open: an
        # answer describing the previous script would tick a hook the author
        # has just deleted, and it would take a second read to find out.
        self.assertEqual(
            self.declared(response.data),
            {"onFlowStart": False, "onUserMessage": True, "onFlowEnd": False},
        )
        self.assertEqual(response.data["library"], self.LIBRARY)

    def test_a_file_that_does_not_compile_is_still_refused(self):
        response = self.client.put(self.url(), {"script": "const = obj.model"}, format="json")

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_syntax_error")
        # A refusal is the error envelope and nothing else — a panel that found
        # a hook list in it would render the answer as a successful save.
        self.assertNotIn("hooks", response.data)
        self.flow.refresh_from_db()
        self.assertEqual(self.flow.script, "")
