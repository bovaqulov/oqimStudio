"""What a key is, who may make one, and the four ways one is refused.

The security cases are the point of this file and they are written as things
that must not work. A key is the one credential in this product that is handed
to somebody outside the company, so every line below is a statement about what
the far side cannot do:

- a key from workspace A never sees workspace B, however the request asks,
- a key without a scope is refused, and told which one it wanted,
- a revoked key is not a key,
- a made-up key is not a key,
- and the string itself is nowhere in the database.
"""

from __future__ import annotations

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.apikeys.models import KEY_PREFIX, ApiKey, hash_key, issue_key
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.workspaces.models import Membership, Role, Workspace

NODES = [
    {"id": "t1", "type": "trigger", "title": "Salom", "dmsTrigger": {"kinds": ["command"], "command": "start"}},
    {"id": "m1", "type": "message", "title": "Javob", "text": "Assalomu alaykum"},
]
EDGES = [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}]


def make_tenant(slug: str, email: str):
    user = User.objects.create_user(email=email, password="Parol12345", name=slug.title(), email_verified=True)
    workspace = Workspace.objects.create(id=slug, name=slug, slug=slug, owner=user)
    Membership.objects.create(workspace=workspace, user=user, email=email, role=Role.OWNER)
    project = Project.objects.create(id=f"{slug}-p", workspace=workspace, name="P", handle="p", created_by=user)
    bot = Bot.objects.create(
        id=f"{slug}-b", workspace=workspace, project=project, handle=f"@{slug}", token="t", enabled_modules=["dms"]
    )
    return user, workspace, project, bot


def bearer(raw: str) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {raw}"}


class KeyShapeTests(TestCase):
    """The key itself: what it looks like, and what is kept of it."""

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
        self.user, self.workspace, _, _ = make_tenant("ws1", "a@b.uz")

    def test_a_key_has_the_documented_shape(self):
        key, raw = issue_key(workspace=self.workspace, name="CRM", scopes=["flows:read"], created_by=self.user)
        self.assertTrue(raw.startswith(KEY_PREFIX))
        self.assertEqual(len(raw), len(KEY_PREFIX) + 32)
        self.assertEqual(key.prefix, raw[: len(KEY_PREFIX) + 4])

    def test_the_full_key_is_never_stored(self):
        """The hash, and nothing else. Read straight off the row and out of the
        raw table, so a column added later that happened to hold the secret
        would fail this rather than pass it."""
        key, raw = issue_key(workspace=self.workspace, name="CRM", scopes=["flows:read"], created_by=self.user)

        self.assertEqual(key.hashed, hash_key(raw))
        self.assertNotIn(raw, key.hashed)

        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM apikeys_apikey WHERE id = %s", [key.id])
            columns = [column[0] for column in cursor.description]
            row = cursor.fetchone()
        stored = {name: value for name, value in zip(columns, row)}
        self.assertNotIn(raw, [str(value) for value in stored.values()])
        # The secret's own body must not appear even as a fragment of some
        # other column — `prefix` is allowed its four characters and no more.
        body = raw[len(KEY_PREFIX):]
        for name, value in stored.items():
            self.assertNotIn(body, str(value), f"{name} holds the secret")

    def test_two_keys_never_collide(self):
        raws = {issue_key(workspace=self.workspace, name="k", scopes=["flows:read"])[1] for _ in range(50)}
        self.assertEqual(len(raws), 50)

    def test_unknown_scopes_are_dropped_on_the_way_out(self):
        key, _ = issue_key(workspace=self.workspace, name="k", scopes=["flows:read", "billing:read"])
        self.assertEqual(key.scope_list, ["flows:read"])


class ManagementEndpointTests(TestCase):
    """`/api/api-keys/` — the panel's three, and who may reach them."""

    def setUp(self) -> None:
        cache.clear()  # see the first setUp in this file
        self.owner, self.workspace, _, _ = make_tenant("ws1", "owner@b.uz")
        self.editor = User.objects.create_user(
            email="editor@b.uz", password="Parol12345", name="Jasur", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.editor, email="editor@b.uz", role=Role.EDITOR
        )
        self.analyst = User.objects.create_user(
            email="analyst@b.uz", password="Parol12345", name="Nodira", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.analyst, email="analyst@b.uz", role=Role.ANALYST
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _create(self, **body):
        payload = {"name": "CRM ulanish", "scopes": ["flows:write"], **body}
        return self.client.post("/api/api-keys/", payload, HTTP_X_WORKSPACE_ID="ws1")

    def test_creating_returns_the_key_once(self):
        response = self._create()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["key"].startswith(KEY_PREFIX))
        # Exactly the contract the frontend was given.
        for field in ("id", "name", "prefix", "scopes", "createdBy", "createdAt", "lastUsedAt", "revokedAt"):
            self.assertIn(field, response.data)
        self.assertEqual(response.data["createdBy"], "Ws1")
        self.assertIsNone(response.data["lastUsedAt"])
        self.assertIsNone(response.data["revokedAt"])

    def test_the_list_never_carries_the_key(self):
        raw = self._create().data["key"]
        response = self.client.get("/api/api-keys/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 200)
        rows = response.data["results"]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("key", rows[0])
        self.assertNotIn(raw, str(response.data))

    def test_the_list_is_this_workspace_only(self):
        self._create()
        _, other_workspace, _, _ = make_tenant("ws2", "z@b.uz")
        issue_key(workspace=other_workspace, name="Ularniki", scopes=["flows:read"])

        response = self.client.get("/api/api-keys/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual([row["name"] for row in response.data["results"]], ["CRM ulanish"])

    def test_an_editor_may_mint_a_key(self):
        """The scopes name exactly what an editor already does from the panel,
        so a key hands its maker nothing new. Refusing here would only send
        them to a personal DRF token, which is strictly worse."""
        self.client.force_authenticate(self.editor)
        response = self._create()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["createdBy"], "Jasur")

    def test_an_analyst_may_not_mint_a_key(self):
        """The one refusal that matters: an analyst reads, and `flows:write`
        would be handing out more than they hold."""
        self.client.force_authenticate(self.analyst)
        response = self._create()
        self.assertEqual(response.status_code, 403)
        # `permission_denied` and not a code of this app's own: the refusal
        # comes from `IsWorkspaceMember`, which is the point — keys are gated
        # by the same rule as every other write in the product.
        self.assertEqual(response.data["error"]["code"], "permission_denied")
        self.assertFalse(ApiKey.objects.exists())

    def test_an_analyst_may_not_revoke_a_key(self):
        key_id = self._create().data["id"]
        self.client.force_authenticate(self.analyst)
        response = self.client.delete(f"/api/api-keys/{key_id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(ApiKey.objects.get(pk=key_id).revoked_at)

    def test_an_editor_may_revoke_a_key(self):
        """Turning a leaked credential off must not wait for an admin."""
        key_id = self._create().data["id"]
        self.client.force_authenticate(self.editor)
        response = self.client.delete(f"/api/api-keys/{key_id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(ApiKey.objects.get(pk=key_id).revoked_at)

    def test_an_analyst_may_still_read_the_list(self):
        """An inventory of credentials is what makes them reviewable, and no
        secret is in it."""
        self._create()
        self.client.force_authenticate(self.analyst)
        response = self.client.get("/api/api-keys/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)

    def test_every_scope_is_inside_what_a_write_role_already_has(self):
        """The assumption the role rule rests on, written down so that adding a
        scope an editor cannot exercise fails here instead of silently widening
        what an editor may hand out. If this fails, that scope needs its own
        gate — see the module docstring in `views.py`."""
        from apps.apikeys.models import SCOPES

        self.assertEqual(
            set(SCOPES), {"flows:read", "flows:write", "bots:read", "contacts:read"}
        )

    def test_a_key_with_no_scopes_is_refused(self):
        response = self._create(scopes=[])
        self.assertEqual(response.status_code, 400)

    def test_an_unknown_scope_is_refused(self):
        response = self._create(scopes=["billing:read"])
        self.assertEqual(response.status_code, 400)

    def test_revoking_keeps_the_row(self):
        key_id = self._create().data["id"]
        response = self.client.delete(f"/api/api-keys/{key_id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["revokedAt"])
        self.assertTrue(ApiKey.objects.filter(pk=key_id).exists())

    def test_revoking_twice_is_the_same_answer(self):
        key_id = self._create().data["id"]
        first = self.client.delete(f"/api/api-keys/{key_id}/", HTTP_X_WORKSPACE_ID="ws1")
        second = self.client.delete(f"/api/api-keys/{key_id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["revokedAt"], second.data["revokedAt"])

    def test_another_tenants_key_cannot_be_revoked(self):
        _, other_workspace, _, _ = make_tenant("ws2", "z@b.uz")
        theirs, _ = issue_key(workspace=other_workspace, name="Ularniki", scopes=["flows:read"])
        response = self.client.delete(f"/api/api-keys/{theirs.id}/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(ApiKey.objects.get(pk=theirs.id).revoked_at)

    def test_the_creator_leaving_does_not_break_the_key(self):
        """The decision written up in `models.py`, checked from both ends: the
        key still authenticates, and the audit line still names who made it."""
        raw = self._create(scopes=["flows:read"]).data["key"]
        creator_name = self.owner.name

        # The harshest version of "left": the account is gone entirely.
        self.workspace.owner = self.editor
        self.workspace.save(update_fields=["owner"])
        self.owner.delete()

        key = ApiKey.objects.get(hashed=hash_key(raw))
        self.assertIsNone(key.created_by_id)
        self.assertTrue(key.is_usable)

        response = APIClient().get("/api/v1/flows/", **bearer(raw))
        self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(self.editor)
        Membership.objects.filter(workspace=self.workspace, user=self.editor).update(role=Role.ADMIN)
        listed = self.client.get("/api/api-keys/", HTTP_X_WORKSPACE_ID="ws1").data["results"][0]
        self.assertEqual(listed["createdBy"], creator_name)


class PublicApiAuthTests(TestCase):
    """The four refusals, and the tenant line."""

    def setUp(self) -> None:
        cache.clear()  # see the first setUp in this file
        self.user, self.workspace, self.project, self.bot = make_tenant("ws1", "a@b.uz")
        self.other_user, self.other_workspace, self.other_project, self.other_bot = make_tenant("ws2", "b@b.uz")

        self.flow = Flow.objects.create(
            id="f1", workspace=self.workspace, project=self.project, bot=self.bot,
            module_key="dms", name="Bizniki", nodes=NODES, edges=EDGES,
        )
        self.their_flow = Flow.objects.create(
            id="f2", workspace=self.other_workspace, project=self.other_project, bot=self.other_bot,
            module_key="dms", name="Ularniki", nodes=NODES, edges=EDGES,
        )
        Contact.objects.create(
            id="c1", workspace=self.workspace, bot=self.bot, telegram_user_id=1, chat_id=1, first_name="Ali"
        )
        Contact.objects.create(
            id="c2", workspace=self.other_workspace, bot=self.other_bot,
            telegram_user_id=2, chat_id=2, first_name="Vali",
        )

        _, self.read_key = issue_key(
            workspace=self.workspace, name="O'qish",
            scopes=["flows:read", "bots:read", "contacts:read"], created_by=self.user,
        )
        self.write_row, self.write_key = issue_key(
            workspace=self.workspace, name="Yozish", scopes=["flows:write"], created_by=self.user
        )
        self.revoked_row, self.revoked_key = issue_key(
            workspace=self.workspace, name="Bekor", scopes=["flows:read"], created_by=self.user
        )
        self.revoked_row.revoked_at = timezone.now()
        self.revoked_row.save(update_fields=["revoked_at"])
        _, self.their_key = issue_key(
            workspace=self.other_workspace, name="Ularniki", scopes=["flows:read"], created_by=self.other_user
        )
        self.client = APIClient()

    # -- who gets in -------------------------------------------------------

    def test_a_valid_key_reads_its_own_flows(self):
        response = self.client.get("/api/v1/flows/", **bearer(self.read_key))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["results"]], ["f1"])

    def test_a_made_up_key_is_401(self):
        response = self.client.get("/api/v1/flows/", **bearer(f"{KEY_PREFIX}{'x' * 32}"))
        self.assertEqual(response.status_code, 401)

    def test_a_key_of_the_wrong_shape_is_401(self):
        response = self.client.get("/api/v1/flows/", **bearer("some-drf-token"))
        self.assertEqual(response.status_code, 401)

    def test_no_credential_at_all_is_401(self):
        self.assertEqual(self.client.get("/api/v1/flows/").status_code, 401)

    def test_a_revoked_key_is_401(self):
        response = self.client.get("/api/v1/flows/", **bearer(self.revoked_key))
        self.assertEqual(response.status_code, 401)
        self.assertIn("bekor", response.data["error"]["message"].lower())

    def test_a_revoked_key_is_refused_on_writes_too(self):
        response = self.client.post(
            "/api/v1/flows/import/",
            {"graph": {"nodes": NODES, "edges": EDGES}, "projectId": "ws1-p",
             "botId": "ws1-b", "moduleKey": "dms"},
            format="json", **bearer(self.revoked_key),
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(Flow.objects.filter(workspace=self.workspace).count(), 1)

    def test_a_session_cannot_use_the_public_api(self):
        """The panel's own credential is not a key. Refused rather than
        allowed through, so "what a scope means" has exactly one answer."""
        panel = APIClient()
        panel.force_authenticate(self.user)
        response = panel.get("/api/v1/flows/", HTTP_X_WORKSPACE_ID="ws1")
        self.assertEqual(response.status_code, 401)

    def test_a_key_cannot_mint_another_key(self):
        """The scopes would mean nothing if one of them could write a fifth."""
        response = self.client.post(
            "/api/api-keys/", {"name": "yana", "scopes": ["flows:read"]}, format="json", **bearer(self.read_key)
        )
        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(ApiKey.objects.filter(workspace=self.workspace).count(), 3)

    def test_a_key_cannot_reach_the_internal_api(self):
        """Not routed there, and refused even so — the second lock in
        `tenancy.memberships_of`."""
        for url in ("/api/flows/", "/api/bots/", "/api/contacts/", "/api/billing/usage/"):
            response = self.client.get(url, HTTP_X_WORKSPACE_ID="ws1", **bearer(self.read_key))
            self.assertIn(response.status_code, (401, 403), url)

    def test_a_key_cannot_reveal_a_bot_token(self):
        response = self.client.post(
            f"/api/bots/{self.bot.id}/reveal-token/", HTTP_X_WORKSPACE_ID="ws1", **bearer(self.read_key)
        )
        self.assertIn(response.status_code, (401, 403, 404))
        self.assertNotIn("t", str(response.data.get("token", "")))

    # -- the tenant line ---------------------------------------------------

    def test_another_workspace_id_in_the_header_is_404(self):
        response = self.client.get("/api/v1/flows/", HTTP_X_WORKSPACE_ID="ws2", **bearer(self.read_key))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_another_workspace_id_in_the_query_is_404(self):
        response = self.client.get("/api/v1/flows/?workspaceId=ws2", **bearer(self.read_key))
        self.assertEqual(response.status_code, 404)

    def test_the_keys_own_workspace_id_is_fine(self):
        response = self.client.get("/api/v1/flows/", HTTP_X_WORKSPACE_ID="ws1", **bearer(self.read_key))
        self.assertEqual(response.status_code, 200)

    def test_another_tenants_flow_is_404_not_403(self):
        response = self.client.get(f"/api/v1/flows/{self.their_flow.id}/", **bearer(self.read_key))
        self.assertEqual(response.status_code, 404)

    def test_another_tenants_graph_cannot_be_replaced(self):
        response = self.client.put(
            f"/api/v1/flows/{self.their_flow.id}/graph/",
            {"nodes": [], "edges": []}, format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 404)
        self.their_flow.refresh_from_db()
        self.assertEqual(len(self.their_flow.nodes), 2)

    def test_a_flow_cannot_be_imported_into_another_tenants_bot(self):
        response = self.client.post(
            "/api/v1/flows/import/",
            {"graph": {"nodes": NODES, "edges": EDGES}, "projectId": self.other_project.id,
             "botId": self.other_bot.id, "moduleKey": "dms"},
            format="json", **bearer(self.write_key),
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Flow.objects.filter(workspace=self.other_workspace).count(), 1)

    def test_contacts_are_this_workspace_only(self):
        response = self.client.get("/api/v1/contacts/", **bearer(self.read_key))
        self.assertEqual([row["id"] for row in response.data["results"]], ["c1"])

    def test_bots_are_this_workspace_only(self):
        response = self.client.get("/api/v1/bots/", **bearer(self.read_key))
        self.assertEqual([row["id"] for row in response.data["results"]], ["ws1-b"])

    def test_their_key_reads_their_own_rows(self):
        """The mirror image, so the isolation is not one-directional luck."""
        response = self.client.get("/api/v1/flows/", **bearer(self.their_key))
        self.assertEqual([row["id"] for row in response.data["results"]], ["f2"])

    # -- scopes ------------------------------------------------------------

    def test_a_missing_scope_is_403_and_names_it(self):
        response = self.client.post(
            "/api/v1/flows/import/",
            {"graph": {"nodes": NODES, "edges": EDGES}, "projectId": "ws1-p",
             "botId": "ws1-b", "moduleKey": "dms"},
            format="json", **bearer(self.read_key),
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "insufficient_scope")
        self.assertIn("flows:write", response.data["error"]["message"])

    def test_write_does_not_imply_read(self):
        response = self.client.get("/api/v1/flows/", **bearer(self.write_key))
        self.assertEqual(response.status_code, 403)
        self.assertIn("flows:read", response.data["error"]["message"])

    def test_bots_read_does_not_open_contacts(self):
        _, raw = issue_key(workspace=self.workspace, name="Faqat botlar", scopes=["bots:read"])
        self.assertEqual(self.client.get("/api/v1/bots/", **bearer(raw)).status_code, 200)
        response = self.client.get("/api/v1/contacts/", **bearer(raw))
        self.assertEqual(response.status_code, 403)
        self.assertIn("contacts:read", response.data["error"]["message"])

    def test_the_tenant_check_runs_before_the_scope_check(self):
        """A key pointed at somebody else's workspace is told the workspace
        does not exist — never that it exists and needs a bigger scope."""
        response = self.client.get("/api/v1/contacts/", HTTP_X_WORKSPACE_ID="ws2", **bearer(self.write_key))
        self.assertEqual(response.status_code, 404)

    # -- last_used_at ------------------------------------------------------

    def test_using_a_key_records_it(self):
        self.assertIsNone(self.write_row.last_used_at)
        self.client.get("/api/v1/flows/", **bearer(self.write_key))
        self.write_row.refresh_from_db()
        self.assertIsNotNone(self.write_row.last_used_at)

    def test_a_refused_request_still_counts_as_use(self):
        """Written at authentication, before any permission runs — because the
        question after a leak is "was this key used", and a stolen key probing
        endpoints it has no scope for is exactly the answer you want."""
        self.client.get("/api/v1/flows/", **bearer(self.write_key))
        self.write_row.refresh_from_db()
        self.assertIsNotNone(self.write_row.last_used_at)
