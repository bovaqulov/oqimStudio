"""`/api/v1/` — that the rules the panel enforces are enforced here too.

The refusals live in `apikeys.tests`; this file is about the *other* half of
the promise. An open API is only worth having if a graph that cannot walk is
refused at it, a plan limit still holds through it, and the payload it returns
is the one the internal API returns. Each of those is a rule that lives in
shared code, and each of these tests is what would fail if a future edit
quietly gave the public surface a copy of its own.
"""

from __future__ import annotations

from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.apikeys.models import issue_key
from apps.billing.models import Plan, Subscription
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow, FlowTrigger
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

NODES = [
    {"id": "t1", "type": "trigger", "title": "Salom", "dmsTrigger": {"kinds": ["command"], "command": "start"}},
    {"id": "m1", "type": "message", "title": "Javob", "text": "Assalomu alaykum"},
]
EDGES = [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}]

#: A block type nothing in `flows/vocabulary.py` publishes. The runtime would
#: reach it, find no handler and stop mid-conversation.
UNWALKABLE_NODES = [
    {"id": "t1", "type": "trigger", "title": "Salom", "dmsTrigger": {"kinds": ["command"], "command": "start"}},
    {"id": "x1", "type": "kod", "title": "Yo'q blok"},
]
UNWALKABLE_EDGES = [{"id": "e1", "from": "t1", "port": "out", "to": "x1"}]


def bearer(raw: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {raw}"}


class PublicApiTests(TestCase):
    def setUp(self) -> None:
        # The throttle counts in the cache, and the cache is not part of the
        # test database — so it survives every rollback and accumulates across
        # the whole run. `ApiKeyThrottle` keys on the workspace id, and these
        # files build workspaces from fixed slugs, so several classes share one
        # bucket: a fast suite crams enough requests into one wall-clock minute
        # to spend it, and a test fails on a 429 that has nothing to do with
        # what it is testing. In isolation it passes, which is what makes this
        # kind of flake expensive to chase. Same fault, same fix, as
        # `apps/telegram/tests.py::WebhookTests.setUp`.
        cache.clear()
        self.user = User.objects.create_user(
            email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="ws1", name="WS", slug="ws1", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email="a@b.uz", role=Role.OWNER)
        self.project = Project.objects.create(
            id="p1", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="b1", workspace=self.workspace, project=self.project, handle="@b", token="t",
            enabled_modules=["dms"],
        )
        self.flow = Flow.objects.create(
            id="f1", workspace=self.workspace, project=self.project, bot=self.bot,
            module_key="dms", name="Bizniki", nodes=NODES, edges=EDGES,
        )
        _, self.read_key = issue_key(
            workspace=self.workspace, name="O'qish",
            scopes=["flows:read", "bots:read", "contacts:read"], created_by=self.user,
        )
        _, self.write_key = issue_key(
            workspace=self.workspace, name="Yozish", scopes=["flows:write"], created_by=self.user
        )
        self.client = APIClient()

    def _import(self, graph, key=None, **extra):
        return self.client.post(
            "/api/v1/flows/import/",
            {"graph": graph, "projectId": "p1", "botId": "b1", "moduleKey": "dms", **extra},
            format="json",
            **bearer(key or self.write_key),
        )

    # -- reads -------------------------------------------------------------

    def test_the_list_has_no_graph_and_the_detail_does(self):
        listed = self.client.get("/api/v1/flows/", **bearer(self.read_key)).data["results"][0]
        self.assertNotIn("nodes", listed)

        detail = self.client.get("/api/v1/flows/f1/", **bearer(self.read_key))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(len(detail.data["nodes"]), 2)
        self.assertEqual(len(detail.data["edges"]), 1)

    def test_the_payload_is_the_internal_one(self):
        """Same serializer, so the same keys. A public API that answered with a
        near-copy would be a second contract nobody meant to sign."""
        panel = APIClient()
        panel.force_authenticate(self.user)
        internal = panel.get("/api/flows/f1/", HTTP_X_WORKSPACE_ID="ws1")
        public = self.client.get("/api/v1/flows/f1/", **bearer(self.read_key))
        self.assertEqual(set(internal.data), set(public.data))

    def test_a_missing_flow_answers_in_the_api_s_own_words(self):
        """Not DRF's English default — this surface's audience is code that
        branches on `error.code`."""
        response = self.client.get("/api/v1/flows/nope/", **bearer(self.read_key))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "flow_not_found")

    def test_a_bot_row_does_not_carry_a_webhook_url(self):
        """`bots:read` says which bots exist. The webhook URL carries the
        token that lets anybody feed this bot fabricated updates."""
        row = self.client.get("/api/v1/bots/", **bearer(self.read_key)).data["results"][0]
        self.assertNotIn("webhookUrl", row)
        self.assertNotIn("token", row)
        self.assertNotIn(self.bot.webhook_token, str(row))

    def test_flows_can_be_filtered_by_bot(self):
        response = self.client.get("/api/v1/flows/?botId=b1", **bearer(self.read_key))
        self.assertEqual([row["id"] for row in response.data["results"]], ["f1"])
        empty = self.client.get("/api/v1/flows/?botId=nope", **bearer(self.read_key))
        self.assertEqual(empty.data["results"], [])

    # -- import ------------------------------------------------------------

    def test_an_import_creates_a_flow_and_indexes_it(self):
        response = self._import({"nodes": NODES, "edges": EDGES}, name="Yangi")
        self.assertEqual(response.status_code, 201)
        flow = Flow.objects.get(pk=response.data["id"])
        self.assertEqual(flow.workspace_id, "ws1")
        self.assertEqual(flow.origin["label"], "API orqali yuklandi")
        # A graph nobody indexed is a flow that looks installed and answers
        # nothing — the same thing `reindex_triggers` buys the panel.
        self.assertTrue(FlowTrigger.objects.filter(flow=flow).exists())

    def test_an_imported_flow_is_not_switched_on(self):
        response = self._import({"nodes": NODES, "edges": EDGES})
        self.assertFalse(Flow.objects.get(pk=response.data["id"]).enabled)

    def test_an_unwalkable_graph_is_refused_with_the_whole_report(self):
        """The rule `refuse_unwalkable_graph` exists for, applied at the
        quietest door in the product."""
        before = Flow.objects.count()
        response = self._import({"nodes": UNWALKABLE_NODES, "edges": UNWALKABLE_EDGES})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "graph_invalid")
        self.assertTrue(response.data["findings"])
        self.assertEqual(Flow.objects.count(), before)

    def test_an_import_obeys_the_flow_limit(self):
        plan = Plan.objects.create(key="tiny", name="Kichik", price=0, limits={"flows": 1})
        Subscription.objects.create(workspace=self.workspace, plan=plan)
        response = self._import({"nodes": NODES, "edges": EDGES})
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.data["error"]["code"], "plan_limit")
        self.assertEqual(Flow.objects.filter(workspace=self.workspace).count(), 1)

    # -- import: the flow's own script ------------------------------------
    #
    # This endpoint shares `ImportFlowSerializer` with the panel's importer, so
    # it began accepting a `script` key the moment that serializer grew one —
    # and stored the flow without it, silently. A field that looks documented
    # and is discarded is worse than one that does not exist.

    def test_an_imported_script_is_stored(self):
        response = self._import(
            {"nodes": NODES, "edges": EDGES},
            script="function onFlowStart(ctx) {\n  return { keldi: true };\n}\n",
        )
        self.assertEqual(response.status_code, 201)
        flow = Flow.objects.get(pk=response.data["id"])
        self.assertIn("onFlowStart", flow.script)
        self.assertIsNotNone(flow.script_updated_at)

    def test_a_flow_imported_without_one_has_no_timestamp(self):
        """An empty file beside a date reads in the panel as a script somebody
        saved and then emptied, which is a different thing from never writing
        one."""
        flow = Flow.objects.get(pk=self._import({"nodes": NODES, "edges": EDGES}).data["id"])
        self.assertEqual(flow.script, "")
        self.assertIsNone(flow.script_updated_at)

    def test_a_script_that_does_not_compile_refuses_the_whole_import(self):
        """Storing it anyway is the failure the whole feature was built after:
        a file that does not compile means every hook in it never runs, and
        nothing says so."""
        before = Flow.objects.count()
        response = self._import({"nodes": NODES, "edges": EDGES}, script="const = obj.model")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "script_syntax_error")
        self.assertEqual(Flow.objects.count(), before)

    # -- graph replace -----------------------------------------------------

    def test_a_graph_can_be_replaced_and_is_reindexed(self):
        replacement = [
            {"id": "t9", "type": "trigger", "title": "Menyu",
             "dmsTrigger": {"kinds": ["command"], "command": "menu"}},
            {"id": "m9", "type": "message", "title": "Javob", "text": "Menyu"},
        ]
        response = self.client.put(
            "/api/v1/flows/f1/graph/",
            {"nodes": replacement, "edges": [{"id": "e9", "from": "t9", "port": "out", "to": "m9"}]},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 200)
        self.flow.refresh_from_db()
        self.assertEqual([node["id"] for node in self.flow.nodes], ["t9", "m9"])
        self.assertEqual(response.data["triggerCount"], 1)
        self.assertEqual(FlowTrigger.objects.filter(flow=self.flow).count(), 1)

    def test_replacing_with_an_unwalkable_graph_is_refused(self):
        response = self.client.put(
            "/api/v1/flows/f1/graph/",
            {"nodes": UNWALKABLE_NODES, "edges": UNWALKABLE_EDGES},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 400)
        self.flow.refresh_from_db()
        self.assertEqual([node["id"] for node in self.flow.nodes], ["t1", "m1"])

    def test_a_name_left_out_is_not_blanked(self):
        self.client.put(
            "/api/v1/flows/f1/graph/", {"nodes": NODES, "edges": EDGES},
            format="json", **bearer(self.write_key),
        )
        self.flow.refresh_from_db()
        self.assertEqual(self.flow.name, "Bizniki")

    def test_an_enabled_flow_cannot_be_pushed_past_the_ai_limit(self):
        """The one rule stricter here than in the panel's autosave, and the
        reason it is: there is nobody typing, and an enabled flow's blocks cost
        money the moment they run."""
        plan = Plan.objects.create(key="noai", name="AIsiz", price=0, limits={"aiBlocks": 0})
        Subscription.objects.create(workspace=self.workspace, plan=plan)
        self.flow.enabled = True
        self.flow.save(update_fields=["enabled"])

        with_ai = NODES + [{"id": "a1", "type": "ai", "title": "AI"}]
        response = self.client.put(
            "/api/v1/flows/f1/graph/", {"nodes": with_ai, "edges": EDGES},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 402)
        self.flow.refresh_from_db()
        self.assertEqual(len(self.flow.nodes), 2)

    def test_removing_ai_blocks_is_always_allowed(self):
        """The check counts the incoming graph, so the way out is never closed."""
        plan = Plan.objects.create(key="noai", name="AIsiz", price=0, limits={"aiBlocks": 0})
        Subscription.objects.create(workspace=self.workspace, plan=plan)
        self.flow.enabled = True
        self.flow.nodes = NODES + [{"id": "a1", "type": "ai", "title": "AI"}]
        self.flow.save(update_fields=["enabled", "nodes"])

        response = self.client.put(
            "/api/v1/flows/f1/graph/", {"nodes": NODES, "edges": EDGES},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 200)

    def test_a_disabled_flow_is_left_alone_by_the_ai_check(self):
        """Same as the panel: an unstarted flow costs nothing, and the limit is
        spent when somebody switches it on."""
        plan = Plan.objects.create(key="noai", name="AIsiz", price=0, limits={"aiBlocks": 0})
        Subscription.objects.create(workspace=self.workspace, plan=plan)
        with_ai = NODES + [{"id": "a1", "type": "ai", "title": "AI"}]
        response = self.client.put(
            "/api/v1/flows/f1/graph/", {"nodes": with_ai, "edges": EDGES},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 200)

    # -- the surface itself ------------------------------------------------

    def test_the_public_api_publishes_seven_endpoints_and_no_more(self):
        """The whole reason `/api/v1/` is its own app rather than an alias: a
        router would publish whatever a viewset happens to grow next. If this
        fails, somebody added a promise — which is fine, as long as it was on
        purpose."""
        from apps.publicapi.urls import urlpatterns

        self.assertEqual(
            {str(route.pattern) for route in urlpatterns},
            {
                "flows/",
                "flows/import/",
                "flows/<str:pk>/",
                "flows/<str:flow_id>/graph/",
                "bots/",
                "contacts/",
                "me/",
            },
        )

    def test_the_internal_endpoints_the_public_api_does_not_have(self):
        """Named so the absence is deliberate rather than accidental. Each one
        exists internally; none is a promise made to an outside caller."""
        for url, method in (
            ("/api/v1/flows/f1/enable/", "post"),
            ("/api/v1/flows/f1/export/", "get"),
            ("/api/v1/flows/f1/duplicate/", "post"),
            ("/api/v1/flows/script/run/", "post"),
            ("/api/v1/bots/b1/reveal-token/", "post"),
            ("/api/v1/billing/usage/", "get"),
        ):
            response = getattr(self.client, method)(url, **bearer(self.write_key))
            self.assertEqual(response.status_code, 404, url)

    # -- what a write can read back ---------------------------------------

    def test_a_write_only_key_reads_back_everything_it_wrote(self):
        """The reason `flows:write` does not imply `flows:read`.

        The argument for implication is that a key which can write but not read
        cannot check its own work — true of most APIs, and not true of this
        one. Both write endpoints answer with the whole flow, graph included:
        an integration holding only `flows:write` uploads a graph and reads it
        back out of the 201, replaces it and reads it back out of the 200. It
        never needs the list to do its job, so `write` alone is a usable key
        and the two ticks stay two risks.

        If either of these responses ever stops carrying `nodes`, that argument
        is gone and the implication has to be revisited — which is what this
        test is for.
        """
        created = self._import({"nodes": NODES, "edges": EDGES}, name="Yozildi")
        self.assertEqual(created.status_code, 201)
        self.assertEqual([node["id"] for node in created.data["nodes"]], ["t1", "m1"])
        self.assertEqual(len(created.data["edges"]), 1)

        replaced = self.client.put(
            f"/api/v1/flows/{created.data['id']}/graph/",
            {"nodes": NODES, "edges": EDGES}, format="json", **bearer(self.write_key),
        )
        self.assertEqual(replaced.status_code, 200)
        self.assertEqual([node["id"] for node in replaced.data["nodes"]], ["t1", "m1"])

    # -- the key describing itself ----------------------------------------

    def test_me_answers_a_key_holding_no_scope_at_all(self):
        """The whole point of the endpoint: it has to answer the key that
        cannot reach anything else, because that is the key whose holder is
        asking what went wrong."""
        _, raw = issue_key(workspace=self.workspace, name="Bo'sh", scopes=["flows:write"])
        response = self.client.get("/api/v1/me/", **bearer(raw))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scopes"], ["flows:write"])

    def test_me_names_the_key_and_the_workspace_it_acts_in(self):
        response = self.client.get("/api/v1/me/", **bearer(self.read_key))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "O'qish")
        self.assertEqual(response.data["workspaceId"], "ws1")
        self.assertEqual(response.data["workspaceName"], "WS")
        self.assertEqual(response.data["scopes"], ["flows:read", "bots:read", "contacts:read"])

    def test_me_states_the_limit_that_is_actually_enforced(self):
        """Not a number typed into the payload — the one the throttle reads. A
        documented ceiling and an enforced ceiling drift apart exactly once."""
        from django.conf import settings

        response = self.client.get("/api/v1/me/", **bearer(self.read_key))

        self.assertEqual(response.data["rateLimit"]["scope"], "workspace")
        self.assertIn(
            str(response.data["rateLimit"]["perMinute"]),
            settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["api-key"],
        )

    def test_me_carries_nothing_secret(self):
        """Not the key, not its digest, and not one word about the other keys
        in this workspace — the holder of one key has no business enumerating
        the rest."""
        from apps.apikeys.models import ApiKey, hash_key

        other, other_raw = issue_key(workspace=self.workspace, name="Boshqa", scopes=["bots:read"])
        body = str(self.client.get("/api/v1/me/", **bearer(self.read_key)).data)

        self.assertNotIn(self.read_key, body)
        self.assertNotIn(hash_key(self.read_key), body)
        self.assertNotIn(other_raw, body)
        self.assertNotIn(other.prefix, body)
        self.assertNotIn("Boshqa", body)
        self.assertEqual(ApiKey.objects.filter(workspace=self.workspace).count(), 3)

    def test_me_still_needs_a_key(self):
        response = self.client.get("/api/v1/me/")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "api_key_required")

    def test_me_obeys_the_same_tenant_line(self):
        response = self.client.get("/api/v1/me/", HTTP_X_WORKSPACE_ID="ws2", **bearer(self.read_key))

        self.assertEqual(response.status_code, 404)

    # -- the surface itself ------------------------------------------------

    def test_options_does_not_publish_the_views_own_docstring(self):
        """DRF's default `OPTIONS` answers with the view's docstring, and the
        docstrings in this file are design arguments written in English for
        whoever edits them next. Handing those to every key holder is the same
        kind of leak as the technical 404 page: nothing catastrophic, and
        nobody decided it."""
        response = self.client.options("/api/v1/flows/", **bearer(self.read_key))

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("description", response.data)
        self.assertEqual(response.data["scope"], "flows:read")
        self.assertIn("GET", response.data["methods"])


class PublicApiPagingTests(TestCase):
    """Walking a list has to visit every row exactly once.

    The panel never meets this: a screen shows fifty contacts and a human
    scrolls. The open API's contacts endpoint exists to be *walked* — that is
    the whole shape of a CRM sync — and `?limit=`/`?offset=` over a queryset
    ordered by a column that moves is where a walk quietly loses people.

    `Contact.Meta.ordering` is `-last_seen_at`, and `last_seen_at` is rewritten
    on **every incoming Telegram message**. So while a sync is between page one
    and page two, anybody who writes to the bot jumps to the front, every row
    behind them shifts by one, and the row that was at offset 49 is either
    served twice or never served at all. On a busy bot a full sync is
    guaranteed to skip somebody, and nothing on either side reports it.
    """

    def setUp(self) -> None:
        cache.clear()  # see the first setUp in this file
        self.user = User.objects.create_user(
            email="page@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="pws", name="WS", slug="pws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email="page@b.uz", role=Role.OWNER)
        self.project = Project.objects.create(
            id="pp", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="pb", workspace=self.workspace, project=self.project, handle="@pb", token="t",
            enabled_modules=["dms"],
        )
        moment = timezone.now()
        for index in range(6):
            Contact.objects.create(
                id=f"pc{index}", workspace=self.workspace, bot=self.bot,
                telegram_user_id=index, chat_id=index, first_name=f"K{index}",
                first_seen_at=moment - timedelta(minutes=index),
                last_seen_at=moment - timedelta(minutes=index),
            )
        _, self.key = issue_key(
            workspace=self.workspace, name="O'qish", scopes=["contacts:read"], created_by=self.user
        )
        self.client = APIClient()

    def _walk(self, limit=2):
        seen, offset = [], 0
        while True:
            page = self.client.get(
                f"/api/v1/contacts/?limit={limit}&offset={offset}", **bearer(self.key)
            ).data
            seen.extend(row["id"] for row in page["results"])
            if not page["next"]:
                return seen
            offset += limit

    def test_a_walk_that_nobody_disturbs_sees_everybody_once(self):
        self.assertEqual(sorted(self._walk()), [f"pc{index}" for index in range(6)])

    def test_a_customer_writing_mid_walk_does_not_hide_the_rest(self):
        """The failure this is about, at six rows instead of five thousand.

        A page is read, somebody at the back of the list writes to the bot, and
        the next page is asked for by offset. Ordered by when a contact was
        last *seen*, that person has moved to the front and taken somebody
        else's place with them.
        """
        first = self.client.get("/api/v1/contacts/?limit=2&offset=0", **bearer(self.key)).data
        seen = [row["id"] for row in first["results"]]

        oldest = Contact.objects.get(pk="pc5")
        oldest.last_seen_at = timezone.now()
        oldest.save(update_fields=["last_seen_at"])

        for offset in (2, 4):
            page = self.client.get(
                f"/api/v1/contacts/?limit=2&offset={offset}", **bearer(self.key)
            ).data
            seen.extend(row["id"] for row in page["results"])

        self.assertEqual(sorted(set(seen)), [f"pc{index}" for index in range(6)], seen)

    def test_the_order_is_total_so_two_identical_rows_cannot_swap(self):
        """Ties are the other half of it. Six contacts created in one second
        share a timestamp, and a database is free to return tied rows in a
        different order each query — including between two pages of one walk."""
        moment = timezone.now()
        Contact.objects.filter(workspace=self.workspace).update(first_seen_at=moment, last_seen_at=moment)

        walks = {tuple(self._walk(limit=2)) for _ in range(4)}

        self.assertEqual(len(walks), 1, walks)
