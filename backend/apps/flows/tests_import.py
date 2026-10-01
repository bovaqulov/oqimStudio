"""Graphs that arrive from outside the editor.

The editor cannot draw a block type that does not exist or an edge leaving a
port nobody published, so every case here is one that could only ever come from
somewhere else — another model asked to write a flow, a script, a hand-edited
file. The fixtures are written the way such a graph actually goes wrong: not
malformed JSON, which anything would catch, but a graph that parses perfectly
and names an exit called `success`.

What is asserted throughout is what the caller *sees* — the status, the code on
the finding, the message it is expected to act on — rather than which function
produced it.
"""

from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIClient

from apps.billing.models import Plan, Subscription
from apps.flows.models import Flow, FlowTrigger
from apps.flows.views import SCRIPT_LIMIT
from apps.workspaces.models import Membership, Role

from .tests import make_tenant

#: What another AI, given the schema endpoint, plausibly produces: a Handler, a
#: greeting and a menu whose one button leads somewhere.
GOOD_GRAPH = {
    "nodes": [
        {"id": "s1", "type": "trigger", "title": "Boshlanish", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
        {"id": "m1", "type": "message", "title": "Salom", "text": "Assalomu alaykum!"},
        {
            "id": "k1",
            "type": "message",
            "title": "Menyu",
            "text": "Tanlang:",
            "buttons": [{"id": "b1", "label": "Narxlar", "kind": "callback"}],
        },
        {"id": "m2", "type": "message", "title": "Narx", "text": "690 000 so'm"},
        {"id": "x1", "type": "end", "title": "Tugatish", "text": "Suhbat tugadi"},
    ],
    "edges": [
        {"id": "e1", "from": "s1", "port": "out", "to": "m1"},
        {"id": "e2", "from": "m1", "port": "out", "to": "k1"},
        {"id": "e3", "from": "k1", "port": "btn:b1", "to": "m2"},
        {"id": "e4", "from": "m2", "port": "out", "to": "x1"},
    ],
}


class ImportTestCase(TestCase):
    """One workspace, signed in as its owner."""

    def setUp(self) -> None:
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def validate(self, graph: dict):
        return self.client.post("/api/flows/import/validate/", {"graph": graph}, format="json")

    def do_import(self, graph: dict, **overrides):
        payload = {
            "graph": graph,
            "projectId": self.project.id,
            "botId": self.bot.id,
            "moduleKey": "dms",
            "name": "Yuklangan narx oqimi",
            **overrides,
        }
        return self.client.post("/api/flows/import/", payload, format="json")

    def codes(self, response, severity: str | None = None) -> list[str]:
        return [
            finding["code"]
            for finding in response.data["findings"]
            if severity is None or finding["severity"] == severity
        ]


class ValidateEndpointTests(ImportTestCase):
    def test_a_graph_another_ai_wrote_correctly_passes(self):
        response = self.validate(GOOD_GRAPH)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["ok"], response.data["findings"])
        self.assertEqual(self.codes(response, "error"), [])

    def test_the_summary_counts_what_was_sent(self):
        """The header of the report: how big the thing is, before what is wrong
        with it. Somebody who pasted the wrong file finds out here."""
        response = self.validate(GOOD_GRAPH)

        self.assertEqual(response.data["summary"]["nodes"], 5)
        self.assertEqual(response.data["summary"]["edges"], 4)
        self.assertEqual(response.data["summary"]["types"]["message"], 3)

    def test_an_invented_port_name_is_an_error_that_names_the_real_ones(self):
        """The failure this whole feature is about.

        A model that has read about flow builders writes `"port": "success"`,
        which is a perfectly reasonable name and not one this product uses. The
        graph parses, saves, indexes — and the conversation stops at that block
        for every customer who reaches it, because `walk` looks for an edge by
        the port's exact name and finds none.
        """
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "c1", "type": "condition", "text": "x = 1"},
                {"id": "m1", "type": "message", "text": "Bo'ldi"},
            ],
            "edges": [
                {"id": "e1", "from": "s1", "port": "out", "to": "c1"},
                {"id": "e2", "from": "c1", "port": "success", "to": "m1"},
            ],
        }

        response = self.validate(graph)

        self.assertFalse(response.data["ok"])
        self.assertIn("unknown_port", self.codes(response, "error"))
        finding = next(one for one in response.data["findings"] if one["code"] == "unknown_port")
        self.assertEqual(finding["edgeId"], "e2")
        self.assertIn("success", finding["message"])
        # The half that makes it actionable: the exits the block really has.
        self.assertIn("`yes`", finding["message"])
        self.assertIn("`no`", finding["message"])

    def test_an_unknown_block_type_is_an_error(self):
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "k1", "type": "kod", "title": "Hisob"},
            ],
            "edges": [{"id": "e1", "from": "s1", "port": "out", "to": "k1"}],
        }

        response = self.validate(graph)

        self.assertFalse(response.data["ok"])
        finding = next(one for one in response.data["findings"] if one["code"] == "unknown_type")
        self.assertEqual(finding["nodeId"], "k1")
        self.assertIn("kod", finding["message"])
        # The vocabulary is listed, because "unknown" without the list leaves
        # the author guessing at a spelling.
        self.assertIn("message", finding["message"])

    def test_an_edge_with_no_port_is_refused(self):
        """The easiest thing in the world for a generator to leave out, and
        entirely invisible: `Flow.edge` compares the value literally, so an edge
        without one matches no port ever asked for."""
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "m1", "type": "message", "text": "Salom"},
            ],
            "edges": [{"id": "e1", "from": "s1", "to": "m1"}],
        }

        response = self.validate(graph)

        self.assertFalse(response.data["ok"])
        self.assertIn("missing_port", self.codes(response, "error"))

    def test_an_edge_into_an_entry_block_is_refused(self):
        """A generator that reads a Handler as an ordinary step wires the flow
        through it. The canvas has no input dot there and the runtime never
        walks the edge — the run simply ends at the block before."""
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "m1", "type": "message", "text": "Salom"},
            ],
            "edges": [
                {"id": "e1", "from": "s1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "out", "to": "s1"},
            ],
        }

        response = self.validate(graph)

        self.assertIn("edge_into_entry", self.codes(response, "error"))

    def test_two_entry_blocks_are_refused(self):
        """`applyEntryRule` keeps the first and deletes the rest the next time
        the graph is opened. Accepting this would hand back a flow that loses
        blocks on its first edit."""
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "s2", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menu"}},
                {"id": "m1", "type": "message", "text": "Salom"},
            ],
            "edges": [
                {"id": "e1", "from": "s1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "s2", "port": "out", "to": "m1"},
            ],
        }

        response = self.validate(graph)

        self.assertIn("multiple_entries", self.codes(response, "error"))

    def test_two_group_event_blocks_are_not(self):
        """The other half of that rule, and the reason it is not "one entry
        block". A groups flow answering both a join and a leave has two entry
        blocks on purpose — they are ordinary palette blocks, and nothing
        deletes them."""
        graph = {
            "nodes": [
                {"id": "g1", "type": "groupjoin", "text": "Kirdi"},
                {"id": "g2", "type": "groupleave", "text": "Chiqdi"},
                {"id": "m1", "type": "message", "text": "Xush kelibsiz"},
                {"id": "m2", "type": "message", "text": "Xayr"},
            ],
            "edges": [
                {"id": "e1", "from": "g1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "g2", "port": "out", "to": "m2"},
            ],
        }

        response = self.validate(graph)

        self.assertTrue(response.data["ok"], response.data["findings"])

    def test_duplicate_and_missing_ids_are_refused(self):
        graph = {
            "nodes": [
                {"id": "m1", "type": "message", "text": "Bir"},
                {"id": "m1", "type": "message", "text": "Ikki"},
                {"type": "message", "text": "Uch"},
            ],
            "edges": [],
        }

        response = self.validate(graph)

        self.assertIn("duplicate_node_id", self.codes(response, "error"))
        self.assertIn("missing_node_id", self.codes(response, "error"))

    def test_half_built_work_warns_and_stays_importable(self):
        """Everything an author would recognise as "not finished yet": a branch
        wired to nothing, a message with no body, a block nothing routes into.
        None of it refuses the import — a graph is uploaded in order to be
        finished."""
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "q1", "type": "condition", "condition": {"combinator": "AND", "rules": []}},
                {"id": "m1", "type": "message", "text": ""},
                {"id": "m9", "type": "message", "text": "Hech kim kelmaydi"},
            ],
            "edges": [
                {"id": "e1", "from": "s1", "port": "out", "to": "q1"},
                {"id": "e2", "from": "q1", "port": "yes", "to": "m1"},
            ],
        }

        response = self.validate(graph)

        self.assertTrue(response.data["ok"], response.data["findings"])
        warnings = self.codes(response, "warning")
        self.assertIn("dangling_port", warnings)  # the condition's "no"
        self.assertIn("empty_body", warnings)  # m1 sends nothing
        self.assertIn("unreachable", warnings)  # m9

    def test_a_graph_with_no_entry_block_warns_once(self):
        """One problem said once. Reporting every block as unreachable as well
        would bury it under its own consequences."""
        graph = {
            "nodes": [{"id": "m1", "type": "message", "text": "Salom"}],
            "edges": [],
        }

        response = self.validate(graph)

        self.assertTrue(response.data["ok"])
        self.assertEqual(self.codes(response, "warning"), ["no_entry"])

    def test_a_graph_that_is_not_a_graph_says_so(self):
        response = self.validate({"blocks": []})

        self.assertFalse(response.data["ok"])
        self.assertEqual(self.codes(response, "error"), ["invalid_graph"])

    def test_a_read_only_member_may_not_ask(self):
        """Validation is the first half of an import, not a report."""
        Membership.objects.filter(workspace=self.workspace, user=self.user).update(role=Role.ANALYST)

        response = self.validate(GOOD_GRAPH)

        self.assertEqual(response.status_code, 403, response.data)


class ImportEndpointTests(ImportTestCase):
    def test_a_valid_graph_becomes_a_new_flow_the_runtime_can_match(self):
        response = self.do_import(GOOD_GRAPH)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["name"], "Yuklangan narx oqimi")
        self.assertEqual([node["id"] for node in response.data["nodes"]], ["s1", "m1", "k1", "m2", "x1"])
        # The index is derived on the way in, like every other graph write —
        # a flow whose triggers were never built answers nothing.
        trigger = FlowTrigger.objects.get(flow_id=response.data["id"])
        self.assertEqual((trigger.kind, trigger.command), ("command", "narx"))

    def test_it_is_never_switched_on_by_the_import(self):
        """Uploading a file is not the same decision as pointing a live bot at
        it. Switching a flow on is `enable`, which is also where the plan is
        spent on what the blocks cost."""
        response = self.do_import(GOOD_GRAPH)

        self.assertFalse(response.data["enabled"])
        self.assertFalse(Flow.objects.get(pk=response.data["id"]).is_main)

    def test_importing_twice_leaves_the_first_flow_untouched(self):
        """The rule this endpoint is built around: an import creates, it never
        replaces. There is no id in the payload and no way to supply one — the
        alternative is a file quietly overwriting a bot somebody is running."""
        first = self.do_import(GOOD_GRAPH).data
        self.client.put(
            f"/api/flows/{first['id']}/graph/",
            {"nodes": GOOD_GRAPH["nodes"], "edges": GOOD_GRAPH["edges"], "name": "Qo'lda tahrirlangan"},
            format="json",
        )

        second = self.do_import(GOOD_GRAPH).data

        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(Flow.objects.get(pk=first["id"]).name, "Qo'lda tahrirlangan")
        self.assertEqual(Flow.objects.count(), 2)

    def test_a_graph_with_errors_is_refused_with_the_whole_report(self):
        """One line is not enough here. The caller is holding a file with no
        canvas to open it on, so the answer has to be the list of what to
        change — while still carrying the one-message envelope every other
        screen renders errors with."""
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "k1", "type": "kod"},
                {"id": "m1", "type": "message", "text": "Salom"},
            ],
            "edges": [{"id": "e1", "from": "s1", "port": "davom", "to": "m1"}],
        }

        response = self.client.post(
            "/api/flows/import/",
            {"graph": graph, "projectId": self.project.id, "botId": self.bot.id, "moduleKey": "dms"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "graph_invalid")
        self.assertEqual(response.data["error"]["field"], "graph")
        codes = self.codes(response, "error")
        self.assertIn("unknown_type", codes)
        self.assertIn("unknown_port", codes)
        self.assertEqual(Flow.objects.count(), 0, "nothing is written when the graph is refused")

    def test_warnings_alone_do_not_refuse_it(self):
        graph = {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "c1", "type": "condition", "condition": {"combinator": "AND", "rules": []}},
            ],
            "edges": [{"id": "e1", "from": "s1", "port": "out", "to": "c1"}],
        }

        response = self.do_import(graph)

        self.assertEqual(response.status_code, 201, response.data)

    def test_a_bot_from_another_workspace_is_not_found(self):
        _, other_workspace, other_project, other_bot = make_tenant("ws2", "b@b.uz")

        response = self.do_import(GOOD_GRAPH, botId=other_bot.id, projectId=other_project.id)

        self.assertEqual(response.status_code, 404, response.data)
        self.assertEqual(Flow.objects.filter(workspace=other_workspace).count(), 0)

    def test_a_bot_that_belongs_to_another_project_is_refused(self):
        from apps.projects.models import Project

        other = Project.objects.create(id="ws1-p2", workspace=self.workspace, name="P2", handle="p2")

        response = self.do_import(GOOD_GRAPH, projectId=other.id)

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "bot_project_mismatch")

    def test_an_analyst_may_not_import(self):
        Membership.objects.filter(workspace=self.workspace, user=self.user).update(role=Role.ANALYST)

        response = self.do_import(GOOD_GRAPH)

        self.assertEqual(response.status_code, 403, response.data)

    def test_the_flow_cap_is_not_worked_round_by_uploading(self):
        """The whole point of a limit is that every door into the resource
        honours it. `create` checks the plan; a second door that did not would
        make the first one decorative."""
        plan = Plan.objects.create(key="start", name="Start", limits={"flows": 1})
        Subscription.objects.create(workspace=self.workspace, plan=plan)
        self.do_import(GOOD_GRAPH)

        response = self.do_import(GOOD_GRAPH)

        self.assertEqual(response.status_code, 402, response.data)
        self.assertEqual(Flow.objects.count(), 1)


class SchemaEndpointTests(ImportTestCase):
    def test_it_describes_the_envelope_before_the_blocks(self):
        """What somebody pastes into another model. A list of block types with
        no statement of what a node and an edge look like produces graphs whose
        every block is right and whose edges go nowhere."""
        response = self.client.get("/api/flows/schema/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["version"], 1)
        self.assertIn("nodes", response.data["howTo"])
        self.assertIn("port", response.data["howTo"])

    def test_every_block_type_carries_its_exits(self):
        response = self.client.get("/api/flows/schema/")
        by_type = {row["type"]: row for row in response.data["nodeTypes"]}

        self.assertEqual(by_type["condition"]["ports"], ["yes", "no"])
        self.assertEqual(by_type["end"]["ports"], [])
        self.assertTrue(by_type["trigger"]["entry"])
        self.assertFalse(by_type["message"]["entry"])
        self.assertTrue(by_type["message"]["buttonPorts"])
        self.assertIn("language", by_type["language"]["fields"])

    def test_a_graph_written_only_from_the_schema_validates(self):
        """The claim the endpoint is making, checked rather than asserted: what
        it says about ports is enough to wire a flow the validator accepts."""
        schema = self.client.get("/api/flows/schema/").data
        by_type = {row["type"]: row for row in schema["nodeTypes"]}
        nodes = [
            {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
            {
                "id": "c1",
                "type": "condition",
                "text": "til = uz",
                "condition": {
                    "combinator": "AND",
                    "rules": [{"id": "r1", "negate": False, "field": "variable",
                               "variableName": "mijoz_tili", "operator": "equals", "value": "uz"}],
                },
            },
            {"id": "m1", "type": "message", "text": "Ha"},
            {"id": "m2", "type": "message", "text": "Yo'q"},
        ]
        yes, no = by_type["condition"]["ports"]
        edges = [
            {"id": "e1", "from": "s1", "port": by_type["trigger"]["ports"][0], "to": "c1"},
            {"id": "e2", "from": "c1", "port": yes, "to": "m1"},
            {"id": "e3", "from": "c1", "port": no, "to": "m2"},
        ]

        response = self.validate({"nodes": nodes, "edges": edges})

        self.assertTrue(response.data["ok"], response.data["findings"])
        self.assertEqual(response.data["findings"], [])

    def test_any_member_may_read_it(self):
        """It carries no tenant data — the same bytes for every workspace — and
        the alternative is people reconstructing the vocabulary by hand."""
        Membership.objects.filter(workspace=self.workspace, user=self.user).update(role=Role.ANALYST)

        response = self.client.get("/api/flows/schema/")

        self.assertEqual(response.status_code, 200, response.data)


class ExportEndpointTests(ImportTestCase):
    def test_it_hands_back_the_graph_and_nothing_that_ties_it_to_this_flow(self):
        flow = self.do_import(GOOD_GRAPH).data

        response = self.client.get(f"/api/flows/{flow['id']}/export/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["schemaVersion"], 1)
        self.assertEqual(response.data["moduleKey"], "dms")
        self.assertEqual(response.data["graph"], {"nodes": GOOD_GRAPH["nodes"], "edges": GOOD_GRAPH["edges"]})
        # A file naming the id, the bot or `enabled` would read as a flow being
        # moved rather than copied.
        for absent in ("id", "botId", "enabled", "runs"):
            self.assertNotIn(absent, response.data)

    def test_an_exported_flow_imports_back(self):
        """The round trip, which is the only thing that makes an export worth
        having: what comes out has to be what goes in."""
        first = self.do_import(GOOD_GRAPH).data
        exported = self.client.get(f"/api/flows/{first['id']}/export/").data

        second = self.do_import(exported["graph"], name=exported["name"], moduleKey=exported["moduleKey"])

        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["nodes"], first["nodes"])
        self.assertEqual(second.data["edges"], first["edges"])

    def test_any_member_may_export(self):
        flow = self.do_import(GOOD_GRAPH).data
        Membership.objects.filter(workspace=self.workspace, user=self.user).update(role=Role.ANALYST)

        response = self.client.get(f"/api/flows/{flow['id']}/export/")

        self.assertEqual(response.status_code, 200, response.data)

    def test_another_workspace_cannot_export_this_flow(self):
        flow = self.do_import(GOOD_GRAPH).data
        other_user, _, _, _ = make_tenant("ws2", "b@b.uz")
        self.client.force_authenticate(other_user)

        response = self.client.get(f"/api/flows/{flow['id']}/export/")

        self.assertEqual(response.status_code, 404, response.data)


class ScriptTravelsWithTheFlowTests(ImportTestCase):
    """The flow's own JavaScript, across the three ways a flow is moved.

    All three used to drop it silently. An export handed somebody a file that
    drew the same canvas and answered differently; an import filed a flow whose
    hooks were not in it; «Nusxa olish» produced the copy nobody could tell from
    the original until a customer did.

    What is asserted here is the same thing the rest of this file asserts — what
    the caller sees — plus one thing they cannot: that a script which does not
    compile is never in the table, which is the whole reason the endpoint that
    stores one refuses first and asks nothing.
    """

    #: A real hook, not merely a file that parses: this is the vocabulary
    #: `hooks.HOOKS` publishes, so what travels is what the runtime would call.
    SCRIPT = "function onFlowStart(ctx) {\n  return { oqim: ctx.flow.name };\n}"

    #: The fault `check_syntax` was written after — five days in a bot's
    #: library before anybody pressed the button that would have found it.
    BROKEN = "const = obj.model"

    def flow_with_script(self, script: str | None = None) -> dict:
        """An imported flow with its script saved through the endpoint that
        compiles one, so the row under test got there the way a real one does."""
        flow = self.do_import(GOOD_GRAPH).data
        saved = self.client.put(
            f"/api/flows/{flow['id']}/script/", {"script": script or self.SCRIPT}, format="json"
        )
        self.assertEqual(saved.status_code, 200, saved.data)
        return flow

    def export(self, flow_id: str) -> dict:
        response = self.client.get(f"/api/flows/{flow_id}/export/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_the_file_carries_the_script_the_author_wrote(self):
        flow = self.flow_with_script()

        exported = self.export(flow["id"])

        self.assertEqual(exported["script"], self.SCRIPT)
        # It travels beside the graph and not inside it: the two are edited in
        # different panels and read by different halves of the runtime.
        self.assertEqual(exported["graph"], {"nodes": GOOD_GRAPH["nodes"], "edges": GOOD_GRAPH["edges"]})

    def test_a_flow_with_no_script_exports_no_script_key(self):
        """Left out rather than sent empty.

        The file's second job is to be pasted into another model as a worked
        example, and `/api/flows/schema/` describes the graph and says nothing
        about hooks — so `"script": ""` sitting in that example is an invitation
        to fill it with JavaScript calling moments that do not exist.
        """
        flow = self.do_import(GOOD_GRAPH).data

        exported = self.export(flow["id"])

        self.assertNotIn("script", exported)
        # And the version does not move for a key that was added: a reader
        # written for 1 ignores what it has never heard of, and this importer
        # takes a file with no `script` in it at all.
        self.assertEqual(exported["schemaVersion"], 1)

    def test_the_round_trip_keeps_the_code(self):
        """Export, import, and the same hooks are running on the other side —
        which is the only thing that makes either endpoint worth having."""
        first = self.flow_with_script()
        exported = self.export(first["id"])

        second = self.do_import(
            exported["graph"],
            name=exported["name"],
            moduleKey=exported["moduleKey"],
            script=exported["script"],
        )

        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(second.data["id"], first["id"])
        self.assertEqual(second.data["script"], self.SCRIPT)
        # Written now, because the file carries the source and not the moment it
        # was written. A row holding code beside an empty timestamp reads in the
        # panel as a file nobody has ever saved.
        self.assertIsNotNone(Flow.objects.get(pk=second.data["id"]).script_updated_at)

    def test_a_payload_with_no_script_imports_exactly_as_it_did_before(self):
        response = self.do_import(GOOD_GRAPH)

        self.assertEqual(response.status_code, 201, response.data)
        flow = Flow.objects.get(pk=response.data["id"])
        self.assertEqual(flow.script, "")
        # Null and not `now`: nothing has been written, and a timestamp on an
        # empty file is a save that never happened.
        self.assertIsNone(flow.script_updated_at)

    def test_a_script_that_does_not_compile_refuses_the_whole_import(self):
        """The decision, stated as a test: the flow does not land.

        Storing it anyway is the failure this feature exists to prevent — a file
        that does not compile means every hook in it silently never runs.
        Landing the flow *without* its code and mentioning it in the 201 is the
        quieter version of the same thing: the import ends in a redirect to the
        new canvas, so a warning in that body is a warning nobody ever reads,
        and the author would arrive at a flow missing half of what they
        uploaded. So the whole import is refused, and the author is told in the
        same words the Script panel refuses a save with.
        """
        response = self.do_import(GOOD_GRAPH, script=self.BROKEN)

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_syntax_error")
        self.assertEqual(response.data["error"]["field"], "script")
        self.assertIn("Kodda xato", response.data["error"]["message"])
        self.assertEqual(Flow.objects.count(), 0, "nothing is written when the script is refused")

    def test_that_refusal_is_one_sentence_and_not_a_report(self):
        """Unlike `graph_invalid` directly above it in the same endpoint.

        A graph produces one finding per block and there is no canvas to look at
        yet, so the list is the answer. A script produces exactly one sentence
        with the line number already in it, and a list of one is a report
        pretending to be one.
        """
        response = self.do_import(GOOD_GRAPH, script=self.BROKEN)

        self.assertNotIn("findings", response.data)

    def test_a_script_over_the_ceiling_is_refused_before_a_process_is_spent(self):
        response = self.do_import(GOOD_GRAPH, script="//" + "x" * SCRIPT_LIMIT)

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "script_too_long")
        self.assertEqual(Flow.objects.count(), 0)

    def test_a_copy_is_a_copy_of_the_code_as_well(self):
        """The worst of the three to drop, because nothing on screen said so:
        «Nusxa olish» produced a flow that drew identically and behaved
        differently."""
        flow = self.flow_with_script()

        response = self.client.post(f"/api/flows/{flow['id']}/duplicate/")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["script"], self.SCRIPT)
        self.assertNotEqual(response.data["id"], flow["id"])

    def test_the_copy_keeps_the_day_the_code_was_written(self):
        """`script_updated_at` is not touched by the copy.

        The field says when this *code* was last written, and nobody wrote a
        line of it by pressing «Nusxa olish» — the panel prints it beside the
        file, so `now` would tell an author that code from March changed today.
        When the row itself came into being is `created_at`.
        """
        flow = self.flow_with_script()
        original = Flow.objects.get(pk=flow["id"])

        response = self.client.post(f"/api/flows/{flow['id']}/duplicate/")

        copy = Flow.objects.get(pk=response.data["id"])
        self.assertEqual(copy.script_updated_at, original.script_updated_at)

    def test_a_flow_with_no_script_still_duplicates(self):
        flow = self.do_import(GOOD_GRAPH).data

        response = self.client.post(f"/api/flows/{flow['id']}/duplicate/")

        self.assertEqual(response.status_code, 201, response.data)
        copy = Flow.objects.get(pk=response.data["id"])
        self.assertEqual(copy.script, "")
        self.assertIsNone(copy.script_updated_at)


class GraphSaveIsProtectedTests(ImportTestCase):
    """The autosave, which is worth more than the import feature it came with.

    `PUT /flows/<id>/graph/` is where nearly every graph in the product is
    written, and until now it checked ids and edge endpoints and nothing else.
    """

    def _flow(self) -> str:
        return self.client.post(
            "/api/flows/",
            {"projectId": self.project.id, "botId": self.bot.id, "moduleKey": "dms", "name": "Oqim"},
            format="json",
        ).data["id"]

    def test_an_unknown_block_type_can_no_longer_be_saved(self):
        flow_id = self._flow()

        response = self.client.put(
            f"/api/flows/{flow_id}/graph/",
            {"nodes": [{"id": "k1", "type": "kod", "text": "salom"}], "edges": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["field"], "nodes")
        self.assertIn("kod", response.data["error"]["message"])
        self.assertEqual(Flow.objects.get(pk=flow_id).nodes, [])

    def test_an_edge_leaving_a_port_the_block_does_not_publish_is_refused(self):
        flow_id = self._flow()

        response = self.client.put(
            f"/api/flows/{flow_id}/graph/",
            {
                "nodes": [
                    {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                    {"id": "e1", "type": "end", "text": "Tugadi"},
                    {"id": "m1", "type": "message", "text": "Keyin"},
                ],
                # «Tugatish» publishes no ports at all — this is the stale `out`
                # edge the runtime deliberately refuses to follow.
                "edges": [{"id": "x1", "from": "e1", "port": "out", "to": "m1"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["field"], "edges")

    def test_a_half_built_canvas_still_saves(self):
        """The autosave's own rule, unchanged. A branch nobody has wired yet is
        most of what anybody saves, and refusing it would lock the author out of
        the edit that finishes it."""
        flow_id = self._flow()

        response = self.client.put(
            f"/api/flows/{flow_id}/graph/",
            {
                "nodes": [
                    {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                    {"id": "c1", "type": "condition", "condition": {"combinator": "AND", "rules": []}},
                ],
                "edges": [{"id": "e1", "from": "s1", "port": "out", "to": "c1"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)

    def test_the_message_counts_the_rest_of_the_errors(self):
        """One envelope, one message — so it says how much else is wrong rather
        than letting the author fix one line and be refused again."""
        flow_id = self._flow()

        response = self.client.put(
            f"/api/flows/{flow_id}/graph/",
            {
                "nodes": [{"id": "a", "type": "kod"}, {"id": "b", "type": "boshqa"}],
                "edges": [],
            },
            format="json",
        )

        self.assertIn("jami 2", response.data["error"]["message"])


class CreateIsProtectedTests(ImportTestCase):
    """`POST /flows/` — the other door into the same table.

    The graph save was hardened and this was not, so for a while the way to get
    an unwalkable graph into the product was to send it to the *create*
    endpoint instead: same blocks, same edges, one URL to the left, and
    `reindex_triggers` runs on it either way. A flow made this way is indexed,
    matches a real command, and stops dead at the first block whose edge names
    a port that does not exist.

    The blank-canvas cases below are why this is not simply "run the same check
    and be done": a flow is normally created *empty* — that is what the «yangi
    oqim» button does — and a check that refused an empty graph would refuse
    the most ordinary request in the product.
    """

    def _create(self, **payload):
        return self.client.post(
            "/api/flows/",
            {"projectId": self.project.id, "botId": self.bot.id, "moduleKey": "dms", "name": "Oqim", **payload},
            format="json",
        )

    def test_an_unknown_block_type_cannot_be_created_either(self):
        response = self._create(nodes=[{"id": "k1", "type": "kod", "text": "salom"}], edges=[])

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["field"], "nodes")
        self.assertIn("kod", response.data["error"]["message"])
        self.assertFalse(Flow.objects.filter(name="Oqim").exists())

    def test_an_invented_port_never_becomes_a_trigger_row(self):
        """What the hole actually cost: the flow was stored *and* indexed, so
        the bot answered the command and then went silent at the first block."""
        response = self._create(
            nodes=[
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "m1", "type": "message", "text": "690 000 so'm"},
            ],
            edges=[{"id": "e1", "from": "s1", "port": "success", "to": "m1"}],
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["field"], "edges")
        self.assertIn("success", response.data["error"]["message"])
        self.assertFalse(FlowTrigger.objects.filter(command="narx").exists())

    def test_it_refuses_exactly_what_the_autosave_refuses(self):
        """The point of sharing the rule rather than copying it: one graph, two
        endpoints, the same envelope down to the message. Two copies of this
        check would drift, and the quieter door is the one that would be left
        open again."""
        graph = {
            "nodes": [{"id": "a", "type": "kod"}, {"id": "b", "type": "boshqa"}],
            "edges": [],
        }
        flow_id = self._create().data["id"]

        saved = self.client.put(f"/api/flows/{flow_id}/graph/", graph, format="json")
        created = self._create(**graph)

        self.assertEqual(saved.status_code, 400, saved.data)
        self.assertEqual(created.status_code, 400, created.data)
        self.assertEqual(created.data["error"]["field"], saved.data["error"]["field"])
        self.assertEqual(created.data["error"]["message"], saved.data["error"]["message"])
        self.assertIn("jami 2", created.data["error"]["message"])

    def test_a_flow_is_still_created_with_no_graph_at_all(self):
        """The «yangi oqim» button. A blank canvas is where every flow starts,
        and a check that called it invalid would be a check nobody could get
        past."""
        response = self._create()

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["nodes"], [])

    def test_an_explicitly_empty_graph_is_the_same_thing(self):
        response = self._create(nodes=[], edges=[])

        self.assertEqual(response.status_code, 201, response.data)

    def test_half_built_work_is_created_the_way_it_is_saved(self):
        """Errors only, here as everywhere: an unwired branch is what a flow
        split out of another one looks like on arrival."""
        response = self._create(
            nodes=[
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["start"]}},
                {"id": "c1", "type": "condition", "condition": {"combinator": "AND", "rules": []}},
            ],
            edges=[{"id": "e1", "from": "s1", "port": "out", "to": "c1"}],
        )

        self.assertEqual(response.status_code, 201, response.data)


class AlbumBackRowTests(ImportTestCase):
    """«Orqaga» on a block Telegram sends as an album.

    `sendMediaGroup` is the one Bot API method that accepts no `reply_markup`
    at all, so an album's keyboard never leaves the machine. The author's own
    buttons have been read through the content kind for as long as
    `runner.node_buttons` has existed — the back row was the one row nobody had
    told. It published a `back` exit anyway: the canvas drew a dot for it, this
    validator accepted the edge leaving it, and `walk` then waited on a port no
    tap can ever produce. The conversation stopped at the album, and nothing
    anywhere said why.

    The exit is gone now, on both sides — the same rule the button ports have
    always followed, applied to the row that was missed. What is *stored* is not
    gone, and must not be: a graph saved while the port existed still carries
    the edge, and refusing it would lock the author out of the one edit that
    removes it. So the leftover is a warning, and it names the row rather than
    the port — what to change is the row or what the block sends, not a
    misspelled exit.
    """

    def _album(self, *, back: str | None = "", kind: str = "album") -> dict:
        node = {
            "id": "n2",
            "type": "message",
            "title": "Albom",
            "text": "Rasmlar",
            "contentKind": kind,
            "album": [
                {"id": "a1", "kind": "photo", "source": {"kind": "url", "value": "https://x/1.jpg"}},
                {"id": "a2", "kind": "photo", "source": {"kind": "url", "value": "https://x/2.jpg"}},
            ],
        }
        if back is not None:
            node["back"] = back
        return node

    def _graph(self, node: dict) -> dict:
        return {
            "nodes": [
                {"id": "s1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "albom"}},
                node,
                {"id": "n3", "type": "message", "text": "Yoqdimi?"},
            ],
            "edges": [
                {"id": "e1", "from": "s1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "out", "to": "n3"},
                {"id": "e3", "from": "n2", "port": "back", "to": "n3"},
            ],
        }

    def test_an_album_publishes_no_back_exit(self):
        """The vocabulary itself, because it is the half the editor mirrors."""
        from apps.flows.vocabulary import published_ports

        self.assertNotIn("back", published_ports(self._album()))

    def test_the_same_row_on_a_photo_still_publishes_one(self):
        """The gate is what the block *sends*, not the fact that it has a row —
        a caption takes a keyboard perfectly happily."""
        from apps.flows.vocabulary import published_ports

        self.assertIn("back", published_ports(self._album(kind="photo")))

    def test_the_leftover_edge_is_a_warning_that_names_the_row(self):
        response = self.validate(self._graph(self._album()))

        self.assertTrue(response.data["ok"], response.data["findings"])
        self.assertIn("unsent_back_row", self.codes(response, "warning"))
        finding = next(one for one in response.data["findings"] if one["code"] == "unsent_back_row")
        self.assertEqual(finding["edgeId"], "e3")
        self.assertIn("albom", finding["message"])

    def test_a_graph_already_carrying_one_still_saves(self):
        """The whole reason it is a warning. An author opening a flow saved
        while the port existed has to be able to fix something else in it and
        press save."""
        flow_id = self.client.post(
            "/api/flows/",
            {"projectId": self.project.id, "botId": self.bot.id, "moduleKey": "dms", "name": "Albom"},
            format="json",
        ).data["id"]
        graph = self._graph(self._album())

        response = self.client.put(f"/api/flows/{flow_id}/graph/", graph, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [edge["port"] for edge in Flow.objects.get(pk=flow_id).edges],
            ["out", "out", "back"],
            "the author's edge is kept, not quietly dropped on the way in",
        )

    def test_a_block_with_no_back_row_at_all_is_still_the_other_warning(self):
        """Two different mistakes, two different sentences: a row that was
        removed, and a row that is there and cannot be sent."""
        response = self.validate(self._graph(self._album(back=None, kind="text")))

        self.assertIn("missing_back_row", self.codes(response, "warning"))
        self.assertNotIn("unsent_back_row", self.codes(response, "warning"))

    def test_the_hint_on_an_album_does_not_offer_a_button_port(self):
        """The other half of the same fact. An album's buttons publish nothing
        either, so a refusal that told the reader to write `btn:<id>` would send
        them round the same refusal a second time."""
        graph = self._graph(self._album())
        graph["nodes"][1]["buttons"] = [{"id": "b1", "label": "Narxlar", "kind": "callback"}]
        graph["edges"].append({"id": "e4", "from": "n2", "port": "muvaffaqiyat", "to": "n3"})

        response = self.validate(graph)

        finding = next(one for one in response.data["findings"] if one["code"] == "unknown_port")
        self.assertNotIn("btn:", finding["message"])
        self.assertIn("`out`", finding["message"])

    def test_a_sendable_back_row_is_not_reported_at_all(self):
        response = self.validate(self._graph(self._album(kind="photo")))

        self.assertNotIn("unsent_back_row", self.codes(response))
        self.assertNotIn("missing_back_row", self.codes(response))
