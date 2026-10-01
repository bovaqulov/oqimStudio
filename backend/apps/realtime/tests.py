"""WebSocket tests.

Driven through the real ASGI application, so what is exercised is the same
stack a browser gets: the token middleware, the origin validator, the consumer's
membership check and the channel layer.
"""

from __future__ import annotations

from unittest import mock

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.services import notify
from apps.realtime.broadcast import workspace_group
from apps.realtime.tickets import mint, read
from apps.workspaces.models import Membership, Role, Workspace
from config.asgi import application


class WorkspaceSocketTests(TransactionTestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER)
        self.token = Token.objects.create(user=self.user).key

        # Verified on purpose, so what closes this one's socket is the thing
        # the test is named after and not the gate below it.
        self.outsider = User.objects.create_user(
            email="b@b.uz", password="Parol12345", name="B", email_verified=True
        )
        self.outsider_token = Token.objects.create(user=self.outsider).key

        # A member of this workspace who never clicked the link in their mail.
        self.unverified = User.objects.create_user(email="c@b.uz", password="Parol12345", name="C")
        Membership.objects.create(
            workspace=self.workspace, user=self.unverified, email=self.unverified.email, role=Role.EDITOR
        )
        self.unverified_token = Token.objects.create(user=self.unverified).key

    async def _connect(self, path: str):
        # A real browser always sends Origin, and `AllowedHostsOriginValidator`
        # refuses a handshake without one — so the test sends it too.
        communicator = WebsocketCommunicator(application, path, headers=[(b"origin", b"http://localhost")])
        connected, _ = await communicator.connect()
        return communicator, connected

    async def test_a_member_connects_and_gets_the_events_of_their_workspace(self):
        communicator, connected = await self._connect(f"/ws/workspace/ws/?token={self.token}")
        self.assertTrue(connected)
        self.assertEqual((await communicator.receive_json_from())["event"], "ready")

        # Raised the way the product raises it — from synchronous code, in a
        # thread, exactly as a Celery task or a view would.
        await database_sync_to_async(notify)(
            workspace=self.workspace, title="Operator kerak", text="Dilnoza"
        )

        message = await communicator.receive_json_from()
        self.assertEqual(message["event"], "notification.created")
        self.assertEqual(message["payload"]["title"], "Operator kerak")
        await communicator.disconnect()

    async def test_a_socket_without_a_credential_is_closed(self):
        communicator, connected = await self._connect("/ws/workspace/ws/")
        self.assertFalse(connected, "an unauthenticated socket must not be accepted")
        await communicator.disconnect()

    async def test_a_non_member_cannot_listen_to_someone_elses_workspace(self):
        communicator, connected = await self._connect(f"/ws/workspace/ws/?token={self.outsider_token}")
        self.assertFalse(connected)
        await communicator.disconnect()

    async def test_an_unverified_member_cannot_open_the_socket(self):
        """A member in every other sense, refused for the reason `IsWorkspaceMember`
        refuses them every tenant endpoint.

        `?token=` never touches the ticket endpoint, so tightening that endpoint
        alone left this door exactly as it was: an API token and a membership
        row, and the workspace's messages, contacts and notifications arrive.
        """
        communicator, connected = await self._connect(f"/ws/workspace/ws/?token={self.unverified_token}")
        self.assertFalse(connected, "an unverified account must not be handed the workspace's traffic")
        await communicator.disconnect()

    async def test_a_pass_minted_before_verification_lapsed_opens_nothing(self):
        """A pass outlives the request that minted it — thirty seconds of it.

        So the handshake is where the account is read, not where the pass was
        signed: whoever the pass names is looked up now, and judged as they
        stand now.
        """
        ticket = mint(str(self.unverified.pk), workspace_group(self.workspace.id))

        communicator, connected = await self._connect(f"/ws/workspace/ws/?ticket={ticket}")
        self.assertFalse(connected)
        await communicator.disconnect()

    async def test_a_ping_is_answered_so_idle_sockets_stay_open(self):
        communicator, connected = await self._connect(f"/ws/workspace/ws/?token={self.token}")
        self.assertTrue(connected)
        await communicator.receive_json_from()

        await communicator.send_json_to({"type": "ping"})
        self.assertEqual((await communicator.receive_json_from())["event"], "pong")
        await communicator.disconnect()


class TicketEndpointTests(TestCase):
    """Who may mint a socket pass.

    The endpoint hands out access to everything the workspace socket carries,
    so the question it has to answer is the one every tenant endpoint answers —
    and for a while it answered a weaker one of its own.
    """

    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.owner)
        Membership.objects.create(
            workspace=self.workspace, user=self.owner, email=self.owner.email, role=Role.OWNER
        )

    def mint_as(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client.post("/api/realtime/ticket/", format="json", HTTP_X_WORKSPACE_ID=self.workspace.id)

    def member(self, role: Role, email: str, verified: bool = True) -> User:
        user = User.objects.create_user(
            email=email, password="Parol12345", name=email[:1].upper(), email_verified=verified
        )
        Membership.objects.create(workspace=self.workspace, user=user, email=user.email, role=role)
        return user

    def test_a_member_is_handed_a_pass_for_their_own_workspace(self):
        response = self.mint_as(self.owner)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(read(response.data["ticket"]), (self.owner.pk, workspace_group(self.workspace.id)))

    def test_an_analyst_is_handed_one_too(self):
        """Minting is a POST because a pass must not be cached, not because it
        writes anything — so the role half of `IsWorkspaceMember` must not
        apply. An analyst reads every screen this socket keeps current."""
        response = self.mint_as(self.member(Role.ANALYST, "analyst@b.uz"))

        self.assertEqual(response.status_code, 200, response.data)

    def test_an_unverified_member_is_refused_a_pass(self):
        """The gate the rest of the product applies, applied here.

        `IsAuthenticated` used to be the whole rule, which made this the one
        door an account that cannot read a single tenant endpoint could reach
        the workspace's messages, contacts and notifications through.
        """
        response = self.mint_as(self.member(Role.EDITOR, "c@b.uz", verified=False))

        self.assertEqual(response.status_code, 403)

    def test_a_stranger_is_refused_before_any_workspace_is_resolved(self):
        stranger = User.objects.create_user(
            email="x@y.uz", password="Parol12345", name="X", email_verified=True
        )
        self.assertEqual(self.mint_as(stranger).status_code, 403)

    def test_a_pass_cannot_be_minted_for_a_workspace_the_caller_is_not_in(self):
        Workspace.objects.create(id="ws2", name="WS2", slug="ws2", owner=self.owner)
        client = APIClient()
        client.force_authenticate(self.owner)

        response = client.post("/api/realtime/ticket/", format="json", HTTP_X_WORKSPACE_ID="ws2")

        self.assertEqual(response.status_code, 404, "a workspace the caller is not in does not exist for them")


class BufferedPublishingTests(TestCase):
    """Realtime events are batched off the customer's reply path."""

    def test_publishes_are_held_until_the_buffer_closes(self):
        from apps.realtime import broadcast

        with mock.patch.object(broadcast, "_flush") as flush:
            with mock.patch.object(broadcast, "async_to_sync") as immediate:
                with broadcast.buffered_publishing():
                    broadcast.publish("ws.flow.1", "run.step", {"a": 1})
                    broadcast.publish("ws.bot.1", "run.step", {"a": 1})
                    # Nothing has gone out yet — the sends must not sit between steps.
                    immediate.assert_not_called()

        # One flush for the whole batch, carrying both events in order.
        flush.assert_called_once()
        items = flush.call_args[0][0]
        self.assertEqual([group for group, _ in items], ["ws.flow.1", "ws.bot.1"])

    def test_publish_outside_a_buffer_still_sends_immediately(self):
        from apps.realtime import broadcast

        with mock.patch.object(broadcast, "async_to_sync") as immediate:
            immediate.return_value = lambda *a, **k: None
            broadcast.publish("ws.flow.9", "run.step", {})
            immediate.assert_called_once()

    def test_a_flush_that_raises_does_not_escape(self):
        from apps.realtime import broadcast

        with mock.patch.object(broadcast, "get_channel_layer") as layer:
            layer.return_value = mock.Mock()
            with mock.patch.object(broadcast, "async_to_sync", side_effect=RuntimeError("redis down")):
                # Must not raise — realtime is best-effort, and the customer was
                # already sent their message.
                broadcast._flush([("ws.flow.1", {"type": "broadcast"})])
