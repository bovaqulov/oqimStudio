"""Handing out socket passes.

One endpoint, and it does nothing but restate — in a form a URL can carry —
something the caller has already proved by reaching it.
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.common.tenancy import IsWorkspaceReader, resolve_workspace

from .broadcast import workspace_group
from .tickets import MAX_AGE_SECONDS, mint


@api_view(["POST"])
@permission_classes([IsWorkspaceReader])
def workspace_ticket(request):
    """A pass for this caller's workspace socket.

    `IsWorkspaceReader` is the tenant rule the rest of the API applies, minus
    the role half — every member may listen. It was `IsAuthenticated` and a
    bare `resolve_workspace`, which was the same rule *at the time it was
    written*: when verification was added to `IsWorkspaceMember` this endpoint
    did not move with it, and became the one door an account that cannot read a
    single tenant screen could still reach the workspace's messages, contacts
    and notifications through. That is the argument against restating a
    permission instead of importing it, and this is what it cost.
    """
    workspace, _membership = resolve_workspace(request)
    group = workspace_group(workspace.id)
    return Response(
        {
            "ticket": mint(str(request.user.pk), group),
            "expiresIn": MAX_AGE_SECONDS,
            "group": group,
            # The address as well as the pass, because only this side knows it.
            # The panel reaches the API through an internal hostname that means
            # nothing in a browser — the public one lives in `PUBLIC_BASE_URL`,
            # here, and sending it back is cheaper than teaching the frontend a
            # second copy of it that can drift.
            "url": _socket_url(workspace.id),
        }
    )


def _socket_url(workspace_id: str) -> str:
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    return f"{base}/ws/workspace/{workspace_id}/"
