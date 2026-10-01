"""Who is on the other end of a WebSocket.

A browser opening `new WebSocket(...)` cannot set an Authorization header, so
the credential travels on the handshake URL. There are two, and the difference
matters:

* `?ticket=` — a signed pass, good for half a minute on one workspace, minted
  by `POST /api/realtime/ticket/`. This is what the panel uses, because the
  panel's own token is httpOnly and never reaches the page.
* `?token=` — the API token itself. For a service or a script that already
  holds one and is not a browser; putting it in a URL is a trade a *page* must
  not make, since a URL is logged, shared and kept in history.

The session cookie is accepted too (same-origin pages), which is why this wraps
the standard auth stack rather than replacing it.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser

from .tickets import read as read_ticket


@database_sync_to_async
def _user_for_token(key: str):
    from rest_framework.authtoken.models import Token

    token = Token.objects.filter(key=key).select_related("user").first()
    return token.user if token and token.user.is_active else AnonymousUser()


@database_sync_to_async
def _user_for_ticket(ticket: str):
    from apps.accounts.models import User

    payload = read_ticket(ticket)
    if payload is None:
        return AnonymousUser()
    user = User.objects.filter(pk=payload[0]).first()
    return user if user and user.is_active else AnonymousUser()


def _scope_of(ticket: str) -> str:
    payload = read_ticket(ticket)
    return payload[1] if payload else ""


class TokenAuthMiddleware:
    """Fills `scope["user"]` from `?token=` when the session did not."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        user = scope.get("user")
        if user is None or not user.is_authenticated:
            params = parse_qs(scope.get("query_string", b"").decode())
            ticket = (params.get("ticket") or [""])[0]
            if ticket:
                scope["user"] = await _user_for_ticket(ticket)
                # The scope the pass was signed for. The consumer compares it
                # with the group the URL asks for, so a pass minted for one
                # workspace cannot open a socket on another — checking only
                # membership would let it, since the holder is a member of both.
                scope["ticket_scope"] = _scope_of(ticket)
            elif (key := (params.get("token") or [""])[0]):
                scope["user"] = await _user_for_token(key)
        return await self.inner(scope, receive, send)


def TokenAuthMiddlewareStack(inner):  # noqa: N802 - reads as a stack constructor, like Channels' own
    return TokenAuthMiddleware(AuthMiddlewareStack(inner))
