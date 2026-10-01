"""WebSocket consumers.

Each socket is scoped to exactly one thing the caller has already been proven
to have access to — a workspace, a flow, a bot — and the whole check happens in
`connect`, not on every message: a socket that should never have been opened is
closed, not filtered.

What `connect` asks is what a tenant endpoint asks, in the same order: signed
in, verified, a member of the thing named in the URL, and holding a pass minted
for this socket if it is holding a pass at all.
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.common.tenancy import is_verified

from .broadcast import bot_group, flow_group, workspace_group


class ScopedConsumer(AsyncJsonWebsocketConsumer):
    """Shared handshake: authenticate, authorise, join one group."""

    group_name: str = ""

    async def connect(self) -> None:
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return

        # The gate `IsWorkspaceMember` applies to every tenant endpoint, applied
        # here because this is the other way in and it does not go past that
        # class: `?token=` reaches a socket with an API token alone, and a pass
        # already minted outlives the endpoint that minted it. Everything these
        # three sockets carry — messages, contacts, notifications — is tenant
        # data an unverified account is refused over HTTP, so a socket is not a
        # place to be more generous. Read at the handshake off a row loaded now
        # (`realtime.middleware`), so an account verified or unverified a moment
        # ago is judged as it stands.
        if not is_verified(user):
            await self.close(code=4403)
            return

        self.group_name = await self.resolve_group(user)
        if not self.group_name:
            await self.close(code=4403)
            return

        # A pass names the socket it was minted for. Membership alone is not
        # enough to honour it: somebody who belongs to two workspaces would be
        # a member of both, and a pass issued for one of them would open the
        # other. `ticket_scope` is empty for the token and cookie paths, which
        # carry no such promise to keep.
        scope = self.scope.get("ticket_scope")
        if scope is not None and scope != self.group_name:
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"event": "ready", "payload": {"group": self.group_name}})

    async def disconnect(self, code) -> None:
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def resolve_group(self, user) -> str:
        raise NotImplementedError

    async def receive_json(self, content, **kwargs) -> None:
        # The sockets are one-way by design: anything a client wants to *do*
        # goes through the REST API, which is where permissions and validation
        # already live. A ping keeps intermediaries from closing an idle socket.
        if content.get("type") == "ping":
            await self.send_json({"event": "pong", "payload": {}})

    async def broadcast(self, message) -> None:
        await self.send_json({"event": message["event"], "payload": message["payload"]})


@database_sync_to_async
def _is_member(user, workspace_id: str) -> bool:
    from apps.workspaces.models import Membership

    return Membership.objects.filter(user=user, workspace_id=workspace_id, invited=False).exists()


@database_sync_to_async
def _workspace_of_flow(flow_id: str) -> str | None:
    from apps.flows.models import Flow

    return Flow.objects.filter(pk=flow_id).values_list("workspace_id", flat=True).first()


@database_sync_to_async
def _workspace_of_bot(bot_id: str) -> str | None:
    from apps.bots.models import Bot

    return Bot.objects.filter(pk=bot_id).values_list("workspace_id", flat=True).first()


class WorkspaceConsumer(ScopedConsumer):
    """Notifications, bot status changes and the dashboard's live counters."""

    async def resolve_group(self, user) -> str:
        workspace_id = self.scope["url_route"]["kwargs"]["workspace_id"]
        return workspace_group(workspace_id) if await _is_member(user, workspace_id) else ""


class FlowConsumer(ScopedConsumer):
    """One flow's runs, step by step — what the editor's test chat renders."""

    async def resolve_group(self, user) -> str:
        flow_id = self.scope["url_route"]["kwargs"]["flow_id"]
        workspace_id = await _workspace_of_flow(flow_id)
        if not workspace_id or not await _is_member(user, workspace_id):
            return ""
        return flow_group(flow_id)


class BotConsumer(ScopedConsumer):
    """One bot's traffic: updates in, messages out."""

    async def resolve_group(self, user) -> str:
        bot_id = self.scope["url_route"]["kwargs"]["bot_id"]
        workspace_id = await _workspace_of_bot(bot_id)
        if not workspace_id or not await _is_member(user, workspace_id):
            return ""
        return bot_group(bot_id)
