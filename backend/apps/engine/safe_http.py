"""Fetching a URL a tenant typed, without letting it reach inside the host.

The HTTP block hands the runtime a URL and shows the answer back to the
customer. On a single-tenant install that is a convenience; on a shared one it
is a request the *server* makes, from inside the network, to wherever a flow
author points it — which is the classic shape of a server-side request forgery.
Left open it reads the cloud metadata endpoint (`169.254.169.254`), any service
bound to loopback, and anything else on the private network, and returns the
body to whoever is chatting with the bot.

So the URL is checked before a socket is opened and again after every redirect:

  * only `http`/`https` — no `file:`, `gopher:`, `ftp:`;
  * the host is resolved, and *every* address it resolves to must be public —
    a name that points at `127.0.0.1` or `10.x` is refused rather than dialled;
  * redirects are followed by hand, each hop re-checked, and capped, so a public
    URL cannot bounce the request onto an internal one;
  * the body is read with a ceiling, so the block cannot be pointed at something
    endless.

What remains, and is written down rather than hidden: a name that passes the
check and then re-resolves to a private address between the check and the
connect (DNS rebinding) is not closed here — that needs connecting to the
pinned address, which `requests` does not expose cleanly. The ranges below make
the common attack (metadata, loopback, RFC1918) fail closed.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import requests

#: Schemes a flow may fetch. Everything else is a way to reach something that is
#: not a web server.
ALLOWED_SCHEMES = {"http", "https"}

#: How many redirects to follow before giving up — enough for a normal API, few
#: enough that a redirect loop cannot be used to keep the connection busy.
MAX_REDIRECTS = 3

#: The most of a response body to read back into the run. A block that puts the
#: answer in `{{http}}` does not need megabytes, and something endless must not
#: be able to exhaust the worker.
MAX_BODY_BYTES = 64 * 1024

DEFAULT_TIMEOUT = 10


class UnsafeUrlError(Exception):
    """The URL points somewhere the server must not fetch on a tenant's behalf."""


def _is_public_address(host: str) -> bool:
    """Whether every address `host` resolves to is on the public internet.

    All of them, not the first: a name that resolves to one public and one
    loopback address is a name that can still reach loopback.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # A name that does not resolve cannot be fetched anyway; treat it as
        # unsafe so the caller reports one clear refusal rather than a DNS error.
        return False

    for info in infos:
        raw = info[4][0]
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            return False
        # `is_global` is false for private, loopback, link-local (the metadata
        # range 169.254/16 included), multicast and reserved blocks.
        if not ip.is_global:
            return False
    return True


def _check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise UnsafeUrlError(f"Ruxsat etilmagan manzil turi: {parsed.scheme or 'yo\'q'}")
    host = parsed.hostname
    if not host:
        raise UnsafeUrlError("Manzilda host yo'q")
    if not _is_public_address(host):
        raise UnsafeUrlError("Ichki yoki mahalliy manzillarga so'rov yuborib bo'lmaydi")


def safe_get(url: str, *, timeout: int = DEFAULT_TIMEOUT) -> requests.Response:
    """A GET that refuses anything not on the public internet, redirects included.

    Redirects are resolved here rather than by `requests`, because `requests`
    would happily follow a `302 Location: http://169.254.169.254/` — the check
    has to run on the address each hop actually lands on.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        _check_url(current)
        response = requests.get(
            current,
            timeout=timeout,
            allow_redirects=False,
            stream=True,
        )
        if response.is_redirect and response.next is not None:
            current = response.next.url
            response.close()
            continue
        return response
    raise UnsafeUrlError("Juda ko'p yo'naltirish")


def read_capped(response: requests.Response, limit: int = MAX_BODY_BYTES) -> bytes:
    """Reads at most `limit` bytes, so an endless body cannot exhaust the worker."""
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(8192):
        chunks.append(chunk)
        total += len(chunk)
        if total >= limit:
            break
    response.close()
    return b"".join(chunks)[:limit]
