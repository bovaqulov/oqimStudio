"""A short-lived pass for opening a socket.

The panel holds the API token in an httpOnly cookie, which is what keeps it out
of reach of anything running in the page — and `new WebSocket(...)` cannot set a
header, so the one thing the browser is able to send is a query parameter. Those
two facts do not meet: putting the token in the URL would undo the cookie, and
the URL is the only channel a socket handshake has.

So the browser never gets the token. It asks the server, over an ordinary
authenticated request, for a pass that is good for one socket, for half a
minute, on one workspace — and sends that instead.

What a leaked pass buys, stated rather than hoped about: a read-only socket on
one workspace, for the seconds it has left. Not the API, not another tenant, and
not tomorrow. `TimestampSigner` gives that with no table to keep and nothing to
expire; a single-use guarantee would need one, and would buy very little on top
of thirty seconds.
"""

from __future__ import annotations

from django.core import signing

#: Keeps these signatures from validating anywhere else a signer is used.
SALT = "oqim.realtime.ticket"

#: How long a pass is worth anything. Long enough for a page to finish loading
#: and open its socket, short enough that one out of a log is already stale.
MAX_AGE_SECONDS = 30


def mint(user_id: str, scope: str) -> str:
    """A pass for `user_id` on `scope` — a group name such as `ws.workspace.x`.

    The scope is signed *into* the pass rather than checked against the URL
    afterwards, so a pass minted for one workspace cannot open a socket on
    another even in the moment it is still valid.
    """
    return signing.dumps({"u": str(user_id), "s": scope}, salt=SALT)


def read(ticket: str) -> tuple[str, str] | None:
    """`(user_id, scope)`, or None when the pass is forged, stale or malformed."""
    try:
        payload = signing.loads(ticket, salt=SALT, max_age=MAX_AGE_SECONDS)
    except (signing.BadSignature, signing.SignatureExpired):
        return None
    if not isinstance(payload, dict):
        return None
    user_id, scope = payload.get("u"), payload.get("s")
    if not isinstance(user_id, str) or not isinstance(scope, str) or not user_id or not scope:
        return None
    return user_id, scope
