"""`studio` — the library that manages flows, and the door in front of it.

Three things are being held here, and only the third is an API test.

1. **The door.** `studio.*` is refused anywhere a customer's message is what
   started the code. It is asserted per command rather than once, because a
   gate that covers eleven of twelve commands is not a gate.
2. **One validator.** The JavaScript check in `script/graphcheck.mjs` exists to
   save a round trip, and a second validator is how a graph comes to be legal
   on one side of a wire and illegal on the other. `GraphCheckContractTests`
   runs the same broken graphs through both and fails when the two stop
   agreeing — a contract, not a unit test: when it fails it is telling you the
   two checks have drifted, and it names which codes.
3. **What the commands do**, which is the ordinary half.

Every test that really runs JavaScript is marked `SCRIPTS`, the same skip
`test_script.py` uses, because a deployment without Node is a supported one —
and the Python half of every rule is asserted without it.
"""

import json
import shutil
import subprocess
from pathlib import Path
from unittest import skipUnless

from apps.engine import commands
from apps.engine import studio as studio_module
from apps.billing.models import Plan
from apps.billing.services import PlanLimitExceeded
from apps.engine.studio import (
    CONVERSATION,
    COMMANDS,
    CREATE_FATAL,
    MANAGEMENT,
    Studio,
    StudioError,
    surface_of,
)
from apps.flows import vocabulary
from apps.flows.graph_validation import errors_of, validate_graph

from .base import *  # noqa: F401,F403

SCRIPT_DIR = Path(__file__).resolve().parent.parent / "script"
NODE = shutil.which("node")
SCRIPTS = skipUnless(bool(NODE), "node topilmadi — skript muhiti yo'q")

#: One process answers many questions.
#:
#: A Node launch is ~90 ms before a line of anything runs, so a test file that
#: spawned one per assertion would cost more than the rest of the engine suite
#: put together. Every JS test below sends a *list* of requests and reads a
#: list of answers back.
DRIVER = """
const graphcheck = await import(__GRAPHCHECK__);
const studio = await import(__STUDIO__);

const answers = [];
for (const request of __REQUESTS__) {
  if (request.action === "check") {
    answers.push({ findings: graphcheck.checkGraph(request.graph) });
  } else if (request.action === "constants") {
    answers.push({
      entryTypes: graphcheck.ENTRY_TYPES,
      ownedEntryTypes: graphcheck.OWNED_ENTRY_TYPES,
      createFatal: graphcheck.CREATE_FATAL_CODES,
    });
  } else {
    const sent = [];
    const call = async (name, payload) => {
      sent.push({ name, payload });
      return request.answer === undefined ? null : request.answer;
    };
    const api = studio.createStudio({ call, ctx: request.ctx });
    const method = request.method.split(".").reduce((held, key) => held[key], api);
    try {
      answers.push({ ok: true, value: await method(...(request.args || [])), sent });
    } catch (error) {
      answers.push({ ok: false, code: error.code || "", message: String(error.message), sent });
    }
  }
}
console.log(JSON.stringify(answers));
"""


def run_js(requests: list[dict]) -> list[dict]:
    """The answers to `requests`, from one Node process."""
    script = (
        DRIVER.replace("__GRAPHCHECK__", json.dumps(str(SCRIPT_DIR / "graphcheck.mjs")))
        .replace("__STUDIO__", json.dumps(str(SCRIPT_DIR / "studio.mjs")))
        .replace("__REQUESTS__", json.dumps(requests))
    )
    completed = subprocess.run(
        [NODE, "--input-type=module", "--no-warnings", "-e", script],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise AssertionError(f"node failed ({completed.returncode}): {completed.stderr[-800:]}")
    return json.loads(completed.stdout.strip().splitlines()[-1])


def good_graph() -> dict:
    """A graph with nothing wrong with it — no errors and no warnings either.

    Warnings matter here because `studio.flows.create` refuses on two of them,
    so a fixture that merely "imports cleanly" would not prove what the create
    tests below say it proves.
    """
    return {
        "nodes": [
            {"id": "n1", "type": "trigger", "title": "Narx", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
            {"id": "n2", "type": "message", "title": "Javob", "text": "Narxlar ro'yxati."},
        ],
        "edges": [{"id": "e1", "from": "n1", "port": "out", "to": "n2"}],
    }


#: One broken graph per rule `studio.flows.create` refuses on, keyed by the
#: code that refuses it. Shared by the Python tests and the JS contract test,
#: which is the point: two lists would let one of them stop covering a rule.
BROKEN_GRAPHS: dict[str, dict] = {
    "empty_graph": {"nodes": [], "edges": []},
    "no_entry": {
        "nodes": [{"id": "m1", "type": "message", "text": "Salom"}],
        "edges": [],
    },
    "multiple_entries": {
        "nodes": [
            {"id": "s1", "type": "start"},
            {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
            {"id": "m1", "type": "message", "text": "Salom"},
        ],
        "edges": [
            {"id": "e1", "from": "s1", "port": "out", "to": "m1"},
            {"id": "e2", "from": "t1", "port": "out", "to": "m1"},
        ],
    },
    "duplicate_node_id": {
        "nodes": [{"id": "n1", "type": "start"}, {"id": "n1", "type": "message", "text": "Salom"}],
        "edges": [],
    },
    "missing_node_id": {
        "nodes": [{"type": "start"}, {"id": "m1", "type": "message", "text": "Salom"}],
        "edges": [],
    },
    "missing_port": {
        "nodes": [{"id": "n1", "type": "start"}, {"id": "m1", "type": "message", "text": "Salom"}],
        "edges": [{"id": "e1", "from": "n1", "to": "m1"}],
    },
    "edge_to_missing_node": {
        "nodes": [{"id": "n1", "type": "start"}, {"id": "m1", "type": "message", "text": "Salom"}],
        "edges": [{"id": "e1", "from": "n1", "port": "out", "to": "yo-q-blok"}],
    },
    "edge_into_entry": {
        "nodes": [{"id": "n1", "type": "start"}, {"id": "m1", "type": "message", "text": "Salom"}],
        "edges": [
            {"id": "e1", "from": "n1", "port": "out", "to": "m1"},
            {"id": "e2", "from": "m1", "port": "out", "to": "n1"},
        ],
    },
    "unreachable": {
        "nodes": [
            {"id": "n1", "type": "start"},
            {"id": "m1", "type": "message", "text": "Salom"},
            {"id": "m2", "type": "message", "text": "Hech kim ko'rmaydi"},
        ],
        "edges": [{"id": "e1", "from": "n1", "port": "out", "to": "m1"}],
    },
}


class StudioTestCase(EngineTestCase):
    """A workspace with a bot, and a studio session on each surface."""

    def setUp(self) -> None:
        super().setUp()
        self.studio = Studio(
            workspace=self.workspace, project=self.project, bot=self.bot, surface=MANAGEMENT
        )
        self.in_conversation = Studio(
            workspace=self.workspace, project=self.project, bot=self.bot, surface=CONVERSATION
        )

    def create(self, graph: dict | None = None, **spec) -> dict:
        spec.setdefault("name", "Skript oqimi")
        spec["graph"] = good_graph() if graph is None else graph
        return self.studio.call("studio.flows.create", {"spec": spec})

    def refusal(self, name: str, payload: dict) -> StudioError:
        with self.assertRaises(StudioError) as caught:
            self.studio.call(name, payload)
        return caught.exception


class SurfaceTests(StudioTestCase):
    """The door. Nothing below this class matters if this one is wrong.

    A bot that creates a flow on every customer message destroys itself within
    an hour and does it quietly — each individual call succeeded. So the gate
    is asserted on every command in the table, not on the one the design
    happened to name.
    """

    def test_creating_a_flow_inside_a_conversation_is_refused_in_those_words(self):
        with self.assertRaises(StudioError) as caught:
            self.in_conversation.call("studio.flows.create", {"spec": {"graph": good_graph()}})

        self.assertEqual(str(caught.exception.detail), "studio.flows.create faqat boshqaruv rejimida ishlaydi")
        self.assertEqual(caught.exception.code, "studio_conversation")
        self.assertEqual(Flow.objects.count(), 0, "and nothing was written on the way to the refusal")

    def test_every_command_is_closed_in_a_conversation(self):
        for name in COMMANDS:
            with self.subTest(command=name):
                with self.assertRaises(StudioError) as caught:
                    self.in_conversation.call(name, {})
                self.assertEqual(str(caught.exception.detail), f"{name} faqat boshqaruv rejimida ishlaydi")

    def test_an_unknown_command_in_a_conversation_says_the_same_thing(self):
        """The gate is read before the name is looked up: otherwise the
        difference between «noma'lum buyruq» and the refusal is a way to ask,
        from inside a conversation, which commands exist."""
        with self.assertRaises(StudioError) as caught:
            self.in_conversation.call("studio.flows.destroyEverything", {})

        self.assertEqual(caught.exception.code, "studio_conversation")

    def test_anything_that_is_not_plainly_management_is_a_conversation(self):
        """The test is for the open value, so every context nobody thought
        about — an older runtime's, one built by hand, none at all — is closed."""
        for ctx in ({}, None, {"mode": "live"}, {"mode": "test"}, {"surface": "Management"}, {"surface": ""}):
            with self.subTest(ctx=ctx):
                self.assertEqual(surface_of(ctx), CONVERSATION)

        self.assertEqual(surface_of({"surface": MANAGEMENT}), MANAGEMENT)

    def test_mode_and_surface_are_different_questions(self):
        """`ctx.mode` answers "test chat or real customer"; `ctx.surface`
        answers "conversation or management". All four combinations are real —
        the Script panel is management *and* a test — which is why this is a
        second key and not a third value of the first one."""
        self.assertEqual(surface_of({"mode": "test", "surface": MANAGEMENT}), MANAGEMENT)
        self.assertEqual(surface_of({"mode": "live", "surface": MANAGEMENT}), MANAGEMENT)
        self.assertEqual(surface_of({"mode": "test"}), CONVERSATION)

    @SCRIPTS
    def test_the_library_refuses_before_anything_reaches_the_host(self):
        """The same door on the JavaScript side, and the half that matters: the
        host is never called at all, so a refusal costs no round trip and no
        transaction."""
        closed, open_ = run_js(
            [
                {"action": "studio", "ctx": {"mode": "live"}, "method": "flows.create", "args": [good_graph()]},
                {
                    "action": "studio",
                    "ctx": {"surface": MANAGEMENT},
                    "method": "flows.create",
                    "args": [{"name": "X", "graph": good_graph()}],
                    "answer": {"ok": True, "value": {"id": "f1"}},
                },
            ]
        )

        self.assertFalse(closed["ok"])
        self.assertEqual(closed["message"], "studio.flows.create faqat boshqaruv rejimida ishlaydi")
        self.assertEqual(closed["sent"], [], "nothing left the machine")
        self.assertTrue(open_["ok"], open_)
        self.assertEqual([call["name"] for call in open_["sent"]], ["studio.flows.create"])


class CreateValidationTests(StudioTestCase):
    """The eight refusals, each one asserted to happen before the write.

    This list is the answer to a live clinic flow, switched on, whose trigger
    carried an empty command and two of whose three buttons were wired
    nowhere. A flow a script builds passes the same check as one somebody drew.
    """

    def test_each_broken_graph_is_refused_by_name(self):
        for code, graph in BROKEN_GRAPHS.items():
            with self.subTest(rule=code):
                before = Flow.objects.count()
                with self.assertRaises(StudioError) as caught:
                    self.create(graph)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(Flow.objects.count(), before, "refused before anything was written")

    def test_the_refusal_names_the_block_it_is_about(self):
        """«Grafik noto'g'ri» tells the script's author nothing they can act on.
        Every message below carries the id they can search their own file for."""
        error = self.refusal("studio.flows.create", {"spec": {"graph": BROKEN_GRAPHS["unreachable"]}})

        self.assertIn("m2", str(error.detail))
        self.assertIn("studio.flows.create", str(error.detail))

    def test_two_group_event_blocks_are_not_two_entries(self):
        """The one place «more than one entry block» is deliberately not the
        rule: `groupjoin` and its three neighbours are ordinary palette blocks,
        and a groups flow answering both a join and a leave has two on purpose.
        `vocabulary.OWNED_ENTRY_TYPES` is where that is decided, and this asks
        the studio to agree with it rather than with the shorter sentence."""
        graph = {
            "nodes": [
                {"id": "j1", "type": "groupjoin"},
                {"id": "l1", "type": "groupleave"},
                {"id": "m1", "type": "message", "text": "Salom"},
            ],
            "edges": [
                {"id": "e1", "from": "j1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "l1", "port": "out", "to": "m1"},
            ],
        }

        created = self.create(graph, moduleKey="groups")

        self.assertEqual(len(created["nodes"]), 3)


class CreateTests(StudioTestCase):
    def test_a_valid_create_produces_a_flow_the_server_validator_also_accepts(self):
        created = self.create()

        flow = Flow.objects.get(pk=created["id"])
        self.assertEqual(errors_of(validate_graph({"nodes": flow.nodes, "edges": flow.edges})), [])
        self.assertEqual(validate_graph({"nodes": flow.nodes, "edges": flow.edges}), [], "and no warnings either")
        self.assertEqual(flow.workspace_id, self.workspace.id)
        self.assertEqual(flow.bot_id, self.bot.id)

    def test_a_created_flow_is_indexed_so_the_runtime_can_match_it(self):
        """`FlowTrigger` rows are derived from the graph on every save. A flow
        created without them is a flow the dispatcher cannot see, which looks
        from the panel exactly like a flow that works."""
        created = self.create()

        self.assertEqual(FlowTrigger.objects.filter(flow_id=created["id"]).count(), 1)

    def test_a_created_flow_is_not_switched_on(self):
        """A flow that started answering customers the instant a script wrote
        it would be a bot changed by code nobody reviewed."""
        created = self.create()

        self.assertFalse(created["enabled"])
        self.assertFalse(Flow.objects.get(pk=created["id"]).enabled)

    def test_an_unknown_module_is_refused_rather_than_stored(self):
        """A free-text module stores happily and then matches nothing — the
        dispatcher looks flows up by this exact string."""
        error = self.refusal("studio.flows.create", {"spec": {"graph": good_graph(), "moduleKey": "dm"}})

        self.assertEqual(error.code, "invalid_module")
        self.assertEqual(Flow.objects.count(), 0)

    def test_a_bot_from_another_workspace_is_not_found(self):
        other = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=self.user)
        project = Project.objects.create(id="p2", workspace=other, name="P2", handle="p2", created_by=self.user)
        stranger = Bot.objects.create(id="b2", workspace=other, project=project, handle="@b2", token="t2")

        error = self.refusal("studio.flows.create", {"spec": {"graph": good_graph(), "botId": stranger.id}})

        self.assertEqual(error.code, "not_found")
        self.assertEqual(Flow.objects.count(), 0)


class QuotaTests(StudioTestCase):
    """The plan limit, and the fact that it is *said*.

    A Marketplace install button that failed silently is the finding this is
    written against: a refusal nobody can see is indistinguishable from a
    feature that does not work, and the person holding the script has no
    server log to read.
    """

    def setUp(self) -> None:
        super().setUp()
        Plan.objects.create(key="start", name="Start", limits={"flows": 1})
        self.workspace.plan_key = "start"
        self.workspace.save(update_fields=["plan_key"])

    def test_a_full_plan_refuses_the_create_and_leaves_no_row(self):
        self.create(name="Birinchi")
        self.assertEqual(Flow.objects.count(), 1)

        with self.assertRaises(PlanLimitExceeded) as caught:
            self.create(name="Ikkinchi")

        self.assertEqual(Flow.objects.count(), 1, "and the row that would have been the second one is not there")
        self.assertEqual(caught.exception.status_code, 402)

    def test_the_refusal_says_the_plan_the_number_and_the_way_out(self):
        """Not a code a script has to look up: the sentence names the plan, what
        it allows and both ways past it, because it is read by whoever wrote
        the script rather than by whoever set the price."""
        self.create(name="Birinchi")

        with self.assertRaises(PlanLimitExceeded) as caught:
            self.create(name="Ikkinchi")

        message = str(caught.exception.detail)
        self.assertIn("Start", message)
        self.assertIn("oqimlar", message)
        self.assertIn("tarifni oshiring", message)

    def test_the_limit_is_checked_before_the_graph_is_written_not_after(self):
        """A 402 that arrives once the row exists is a refusal nobody honoured."""
        self.create(name="Birinchi")

        with self.assertRaises(PlanLimitExceeded):
            self.create(name="Ikkinchi")

        self.assertEqual(list(Flow.objects.values_list("name", flat=True)), ["Birinchi"])
        self.assertEqual(FlowTrigger.objects.count(), 1)


class SwitchTests(StudioTestCase):
    def make_stored(self, graph: dict | None = None, **extra):
        graph = good_graph() if graph is None else graph
        extra.setdefault("enabled", False)
        return self.make_flow(graph["nodes"], graph["edges"], **extra)

    def test_enable_moves_the_column(self):
        flow = self.make_stored()

        answer = self.studio.call("studio.flows.enable", {"id": flow.id})

        flow.refresh_from_db()
        self.assertTrue(flow.enabled)
        self.assertTrue(answer["enabled"])
        self.assertEqual(flow.status, "Faol")

    def test_disable_moves_it_back(self):
        flow = self.make_stored()
        self.studio.call("studio.flows.enable", {"id": flow.id})

        answer = self.studio.call("studio.flows.disable", {"id": flow.id})

        flow.refresh_from_db()
        self.assertFalse(flow.enabled)
        self.assertFalse(answer["enabled"])
        self.assertEqual(flow.status, "To'xtatilgan")

    def test_a_flow_nothing_can_start_may_not_be_switched_on(self):
        """The one thing «enabled» cannot mean. `graph_validation` calls this a
        warning because an import lands on a canvas somebody is looking at;
        there is no canvas here and nobody to read a warning."""
        flow = self.make_stored(BROKEN_GRAPHS["no_entry"])

        error = self.refusal("studio.flows.enable", {"id": flow.id})

        flow.refresh_from_db()
        self.assertEqual(error.code, "no_entry")
        self.assertFalse(flow.enabled)

    def test_switching_off_is_never_refused(self):
        """Nobody may be trapped in a state they are being billed for, and a
        script that cannot stop a misbehaving flow is worse than one that
        cannot start it."""
        flow = self.make_stored(BROKEN_GRAPHS["no_entry"], enabled=True)

        self.studio.call("studio.flows.disable", {"id": flow.id})

        flow.refresh_from_db()
        self.assertFalse(flow.enabled)

    def test_an_unreachable_block_does_not_stop_a_switch_on(self):
        """Narrower than `create` on purpose: the panel's own switch has never
        refused this, and a flow a person can turn on and a script cannot is a
        rule nobody can hold in their head."""
        flow = self.make_stored(BROKEN_GRAPHS["unreachable"])

        self.studio.call("studio.flows.enable", {"id": flow.id})

        flow.refresh_from_db()
        self.assertTrue(flow.enabled)

    def test_a_flow_in_another_workspace_is_not_found(self):
        other = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=self.user)
        project = Project.objects.create(id="p2", workspace=other, name="P2", handle="p2", created_by=self.user)
        bot = Bot.objects.create(id="b2", workspace=other, project=project, handle="@b2", token="t2")
        stranger = Flow.objects.create(
            id="f-other", workspace=other, project=project, bot=bot, module_key="dms", name="Boshqa"
        )

        error = self.refusal("studio.flows.enable", {"id": stranger.id})

        self.assertEqual(error.code, "not_found")
        self.assertEqual(error.status_code, 404)
        stranger.refresh_from_db()
        self.assertFalse(stranger.enabled)


class ReadTests(StudioTestCase):
    def test_list_answers_this_workspace_only(self):
        self.create(name="Meniki")
        other = Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=self.user)
        project = Project.objects.create(id="p2", workspace=other, name="P2", handle="p2", created_by=self.user)
        bot = Bot.objects.create(id="b2", workspace=other, project=project, handle="@b2", token="t2")
        Flow.objects.create(id="f-other", workspace=other, project=project, bot=bot, module_key="dms", name="Boshqa")

        rows = self.studio.call("studio.flows.list", {"filter": {}})

        self.assertEqual([row["name"] for row in rows], ["Meniki"])

    def test_an_unknown_filter_is_refused_rather_than_ignored(self):
        """A filter nobody applied is a longer list than the script asked for,
        acted on as if it were the right one."""
        error = self.refusal("studio.flows.list", {"filter": {"botID": self.bot.id}})

        self.assertEqual(error.code, "unknown_filter")
        self.assertIn("botID", str(error.detail))

    def test_get_carries_the_graph(self):
        created = self.create()

        flow = self.studio.call("studio.flows.get", {"id": created["id"]})

        self.assertEqual(len(flow["nodes"]), 2)
        self.assertEqual(len(flow["edges"]), 1)

    def test_validate_reports_without_refusing(self):
        """The reporting half of the pair: `create` and `enable` refuse, this
        one only tells — which is what a script wants *before* it switches
        something on, and what a person wants when it refused."""
        flow = self.make_flow(
            BROKEN_GRAPHS["unreachable"]["nodes"], BROKEN_GRAPHS["unreachable"]["edges"], enabled=False
        )

        report = self.studio.call("studio.flows.validate", {"id": flow.id})

        self.assertTrue(report["ok"], "an unreachable block is not an error")
        self.assertIn("unreachable", {finding["code"] for finding in report["findings"]})
        self.assertIn("unreachable", report["blocksCreate"])
        self.assertNotIn("unreachable", report["blocksEnable"])


class EditTests(StudioTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.flow = self.make_flow(good_graph()["nodes"], good_graph()["edges"], enabled=False)

    def test_a_block_is_added_even_though_nothing_reaches_it_yet(self):
        """The threshold that makes building a flow possible at all: the block
        is always added before the edge that reaches it. `create` refuses an
        unreachable block because the whole graph arrives at once; an edit is
        one step of a sequence."""
        self.studio.call("studio.nodes.add", {"flowId": self.flow.id, "node": {"id": "n3", "type": "message", "text": "Ikki"}})

        self.flow.refresh_from_db()
        self.assertEqual([node["id"] for node in self.flow.nodes], ["n1", "n2", "n3"])

    def test_an_added_block_with_no_id_gets_one(self):
        answer = self.studio.call("studio.nodes.add", {"flowId": self.flow.id, "node": {"type": "message", "text": "Uch"}})

        self.assertTrue(answer["nodes"][-1]["id"])

    def test_a_duplicate_block_id_is_refused(self):
        """By `graph_validation`, through `_save_graph`, and not by a check of
        this module's own — the id rule has one wording in this product."""
        error = self.refusal("studio.nodes.add", {"flowId": self.flow.id, "node": {"id": "n2", "type": "message", "text": "X"}})

        self.flow.refresh_from_db()
        self.assertEqual(error.code, "duplicate_node_id")
        self.assertEqual(len(self.flow.nodes), 2)

    def test_a_duplicate_edge_id_is_refused_by_this_module(self):
        """The one id rule the studio owns. `graph_validation` has nothing to
        say about a repeated edge id — the runtime never looks an edge up by
        one — but `studio.edges.remove` does, and a remove that deleted two
        connections is a wire vanishing from a canvas nobody was looking at."""
        self.studio.call("studio.nodes.add", {"flowId": self.flow.id, "node": {"id": "n3", "type": "message", "text": "Uch"}})

        error = self.refusal(
            "studio.edges.add", {"flowId": self.flow.id, "edge": {"id": "e1", "from": "n2", "port": "out", "to": "n3"}}
        )

        self.flow.refresh_from_db()
        self.assertEqual(error.code, "duplicate_edge_id")
        self.assertEqual(len(self.flow.edges), 1)

    def test_a_block_is_updated_without_moving_its_id(self):
        """An edge names a block by its id, so a rename here would be a rename
        in one of two places."""
        self.studio.call(
            "studio.nodes.update", {"flowId": self.flow.id, "nodeId": "n2", "patch": {"text": "Yangi matn", "id": "boshqa"}}
        )

        self.flow.refresh_from_db()
        self.assertEqual(self.flow.node("n2")["text"], "Yangi matn")
        self.assertIsNone(self.flow.node("boshqa"))

    def test_removing_a_block_takes_its_wires_with_it(self):
        """Not a convenience: every edge touching a removed block becomes
        `edge_to_missing_node`, which is an error, so a removal that left them
        behind could never be stored at all."""
        self.studio.call("studio.nodes.remove", {"flowId": self.flow.id, "nodeId": "n2"})

        self.flow.refresh_from_db()
        self.assertEqual([node["id"] for node in self.flow.nodes], ["n1"])
        self.assertEqual(self.flow.edges, [])

    def test_an_edge_with_no_port_is_refused(self):
        """`Flow.edge` compares the port literally, so an edge without one is
        an edge the runtime can never follow — and it is the single most likely
        thing for a generator to leave out."""
        self.studio.call("studio.nodes.add", {"flowId": self.flow.id, "node": {"id": "n3", "type": "message", "text": "Uch"}})

        error = self.refusal("studio.edges.add", {"flowId": self.flow.id, "edge": {"id": "e2", "from": "n2", "to": "n3"}})

        self.flow.refresh_from_db()
        self.assertEqual(error.code, "missing_port")
        self.assertEqual(len(self.flow.edges), 1)

    def test_an_edge_wires_two_blocks_and_re_indexes_the_flow(self):
        self.studio.call("studio.nodes.add", {"flowId": self.flow.id, "node": {"id": "n3", "type": "message", "text": "Uch"}})

        self.studio.call(
            "studio.edges.add", {"flowId": self.flow.id, "edge": {"id": "e2", "from": "n2", "port": "out", "to": "n3"}}
        )

        self.flow.refresh_from_db()
        self.assertEqual(self.flow.next_node_id("n2", "out"), "n3")
        self.assertEqual(FlowTrigger.objects.filter(flow=self.flow).count(), 1)

    def test_an_edge_is_removed_by_id(self):
        self.studio.call("studio.edges.remove", {"flowId": self.flow.id, "edgeId": "e1"})

        self.flow.refresh_from_db()
        self.assertEqual(self.flow.edges, [])

    def test_an_edge_that_is_not_there_is_said_so(self):
        error = self.refusal("studio.edges.remove", {"flowId": self.flow.id, "edgeId": "e9"})

        self.assertEqual(error.code, "edge_not_found")

    def test_a_flow_is_renamed(self):
        self.studio.call("studio.flows.update", {"id": self.flow.id, "patch": {"name": "Boshqa nom"}})

        self.flow.refresh_from_db()
        self.assertEqual(self.flow.name, "Boshqa nom")

    def test_a_patch_key_nobody_supports_is_refused_rather_than_dropped(self):
        """`enabled` has its own two commands and `moduleKey` decides which
        updates the dispatcher even offers this flow. Silently ignoring either
        would be a script that believes it switched a flow on."""
        error = self.refusal("studio.flows.update", {"id": self.flow.id, "patch": {"enabled": True}})

        self.flow.refresh_from_db()
        self.assertEqual(error.code, "unknown_field")
        self.assertFalse(self.flow.enabled)

    def test_replacing_the_graph_re_derives_the_trigger_index(self):
        """A graph saved without its reindex leaves the dispatcher matching
        against the flow as it was before the edit."""
        replacement = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "boshqa"}},
                {"id": "s2", "type": "message", "text": "Yangi"},
            ],
            "edges": [{"id": "e1", "from": "s1", "port": "out", "to": "s2"}],
        }

        self.studio.call("studio.flows.update", {"id": self.flow.id, "patch": {"graph": replacement}})

        self.assertEqual(
            list(FlowTrigger.objects.filter(flow=self.flow).values_list("command", flat=True)), ["boshqa"]
        )


@SCRIPTS
class GraphCheckContractTests(StudioTestCase):
    """The JavaScript check against the Python one.

    `graphcheck.mjs` exists to save a round trip, and a second validator is how
    a graph comes to be legal on one side of a wire and illegal on the other —
    the failure `vocabulary.py` and its contract test were written after. When
    this class fails it is telling you the two have drifted, and the assertion
    names the codes that moved.
    """

    def test_the_two_checks_name_the_same_errors(self):
        graphs = {code: graph for code, graph in BROKEN_GRAPHS.items() if code != "empty_graph"}
        graphs["good"] = good_graph()
        answers = run_js([{"action": "check", "graph": graph} for graph in graphs.values()])

        for (name, graph), answer in zip(graphs.items(), answers, strict=True):
            with self.subTest(graph=name):
                mine = {finding["code"] for finding in answer["findings"]}
                theirs = {finding.code for finding in validate_graph(graph)}
                self.assertEqual(mine, theirs)

    def test_the_empty_graph_is_the_one_rule_only_the_studio_has(self):
        """`graph_validation` has nothing to say about a graph with no blocks —
        a blank canvas is the most ordinary thing a person creates. It is never
        a thing a script means to create, so both halves of the studio state
        the rule, and this is where that divergence is written down."""
        (answer,) = run_js([{"action": "check", "graph": BROKEN_GRAPHS["empty_graph"]}])

        self.assertEqual([finding["code"] for finding in answer["findings"]], ["empty_graph"])
        self.assertNotIn("empty_graph", {f.code for f in validate_graph(BROKEN_GRAPHS["empty_graph"])})
        self.assertEqual(
            self.refusal("studio.flows.create", {"spec": {"graph": BROKEN_GRAPHS["empty_graph"]}}).code,
            "empty_graph",
            "and the host says the same word",
        )

    def test_the_entry_block_names_are_the_vocabulary_s_own(self):
        """The one thing `graphcheck.mjs` copies. Every rule in it about "an
        entry block" needs these six strings, and a copy that drifts is a check
        that stops seeing an edge into a block nothing may route into."""
        (constants,) = run_js([{"action": "constants"}])

        self.assertEqual(set(constants["entryTypes"]), set(vocabulary.ENTRY_TYPES))
        self.assertEqual(set(constants["ownedEntryTypes"]), set(vocabulary.OWNED_ENTRY_TYPES))

    def test_the_two_halves_refuse_a_create_on_the_same_codes(self):
        (constants,) = run_js([{"action": "constants"}])

        self.assertEqual(set(constants["createFatal"]) - {"empty_graph"}, set(CREATE_FATAL))

    def test_a_broken_graph_never_reaches_the_host(self):
        """What the local check buys: the sentence arrives in the author's own
        `catch`, with nothing written and nothing spent."""
        answers = run_js(
            [
                {
                    "action": "studio",
                    "ctx": {"surface": MANAGEMENT},
                    "method": "flows.create",
                    "args": [{"name": "X", "graph": graph}],
                }
                for graph in BROKEN_GRAPHS.values()
            ]
        )

        for code, answer in zip(BROKEN_GRAPHS, answers, strict=True):
            with self.subTest(rule=code):
                self.assertFalse(answer["ok"], answer)
                self.assertEqual(answer["code"], code)
                self.assertEqual(answer["sent"], [])


class BridgeTests(StudioTestCase):
    """The wire between a script and `studio.py`.

    Everything above tests the studio itself. This tests that a script can
    reach it at all — which is a separate thing and was, for a while, missing:
    `commands.SCOPES` listed `studio` and `perform` had no branch for it, so a
    complete and well-tested API sat behind a dispatcher that answered
    «Noma'lum so'rov turi» to every call.
    """

    def ask(self, name: str, payload: dict | None = None, *, studio=None) -> dict:
        """One `studio.*` effect through the command dispatcher."""
        effects = [{"id": "s1", "kind": "studio", "name": name, "payload": payload or {}}]
        return commands.perform(effects, bot_id=self.bot.id, studio=studio)["s1"]

    def test_a_management_session_reaches_the_command(self):
        answer = self.ask("studio.flows.list", studio=self.studio)

        self.assertTrue(answer["ok"], answer.get("error"))
        self.assertIsInstance(answer["value"], list)

    def test_a_conversation_session_is_refused_in_the_studio_words(self):
        answer = self.ask("studio.flows.list", studio=self.in_conversation)

        self.assertFalse(answer["ok"])
        self.assertIn("boshqaruv rejimida", answer["error"])
        self.assertEqual(answer["code"], "studio_conversation")

    def test_no_session_at_all_is_a_conversation(self):
        """A caller that forgot to hand one over must get the closed answer.
        The opening is the thing that has to be asked for."""
        answer = self.ask("studio.flows.list")

        self.assertFalse(answer["ok"])
        self.assertEqual(answer["code"], "studio_conversation")

    def test_a_refusal_carries_its_code_so_a_script_can_branch(self):
        """«limit to'ldi» and «bunday oqim yo'q» are different things to do
        about. A refusal with nothing to branch on is B-09 seen from inside."""
        answer = self.ask("studio.flows.get", {"id": "yo-q"}, studio=self.studio)

        self.assertFalse(answer["ok"])
        self.assertEqual(answer["code"], "not_found")

    def test_the_runtime_hands_over_a_closed_session(self):
        """`runner._fire` names the surface rather than leaving it out, so a
        script calling `studio.*` mid-conversation is told which surface it
        needs instead of being told the request type is unknown."""
        flow = Flow.objects.get(pk=self.create()["id"])

        session = studio_module.Studio.for_flow(flow)

        self.assertEqual(session.surface, CONVERSATION)
        self.assertEqual(session.workspace, flow.workspace)

