"""Every answer under `/api/` is JSON — including the ones no view wrote.

DRF puts each of its own refusals through `common.exceptions`, so a caller can
read `error.code` off any answer a view produced. The answers Django produces
*before or instead of* a view were never part of that: an unrouted path, a
request body over `DATA_UPLOAD_MAX_MEMORY_SIZE`, an unhandled 500 with debug
off. Each of those is an HTML page, and an HTML page reaches an API client as a
JSON parse error — the one failure mode where the real cause («that URL does
not exist») is written in a `<h1>` that nothing ever reads. The program retries,
logs `SyntaxError: Unexpected token '<'`, and the person debugging it at three
in the morning has no thread to pull.

This is one middleware and not a `handler404`, for two reasons that both matter:

- `handler404` is skipped entirely when `DEBUG` is on — Django serves its
  technical 404 instead. An API that answers one shape on a laptop and another
  on a server is an API you cannot test on a laptop.
- `handler404` only sees 404s. The oversized body is a `SuspiciousOperation`
  turned into a 400 by the core handler, and it comes back as the same HTML.

## Why `/api/` and not only `/api/v1/`

The open API is where this was noticed, but it is not where it is worst. The
panel reaches Django through `frontend/src/lib/api/server.ts`, which parses
every answer as JSON in a server component; a mistyped internal path therefore
throws inside a render, gets caught by the error boundary above it, and the
browser is served a perfectly ordinary 200 with a digest in it. That is the
exact failure the stand sweep in `scripts/verify.sh` was written to catch, and
this stops it at the source. Nothing under `/api/` is meant to be read by a
browser — the one non-JSON answer down there is the contacts CSV, which is a
200 and is never touched by this file.

Everything outside `/api/` is left exactly as it was. `/admin/` is a browser
surface and its 404 belongs in HTML.

## What the 404 body says, and what it deliberately does not

It names the method and the path that missed, and stops. **No list of the
routes that do exist**, however helpful that would be — because there is no
credential to check on a path nobody routed. There is no view there, so nothing
authenticated the caller, so a route list in this body is a route list handed
to whoever mistyped a URL. That is precisely the map `config.settings.dev`
turns `DEBUG` off on a published stand to stop giving away; putting it back
inside a JSON envelope would not make it less of a map. The endpoints are on
the `/docs` page, behind the panel's own sign-in, where the reader has already
proved they belong here.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse

#: The prefix this applies to. Everything under it is machine-readable by
#: contract; everything outside it may be whatever it likes.
API_PREFIX = "/api/"

#: What a status means when no view chose it. Deliberately a small table: a
#: status this does not name still gets the envelope, under a code derived from
#: the number, because a caller branching on `error.code` must never meet a
#: response body it cannot parse just because the failure was novel.
CODES = {
    400: "bad_request",
    403: "forbidden",
    404: "unknown_endpoint",
    413: "payload_too_large",
    500: "server_error",
}

MESSAGES = {
    400: "So'rovni o'qib bo'lmadi",
    403: "Bu amal uchun ruxsat yo'q",
    500: "Serverda kutilmagan xato",
}

#: Methods a 301 is safe on. For the rest a permanent redirect is where a body
#: goes missing — see `_keep_the_method`.
BODYLESS_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def envelope(code: str, message: str) -> bytes:
    """The one error shape, as bytes, for the paths that have no serializer."""
    return json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False).encode("utf-8")


def json_response(status: int, code: str, message: str) -> HttpResponse:
    return HttpResponse(envelope(code, message), status=status, content_type="application/json")


class ApiErrorEnvelopeMiddleware:
    """Turns any non-JSON refusal under `/api/` into the API's own error shape.

    Registered **first**, so it is the outermost middleware: the append-slash
    redirect below is written by `CommonMiddleware`, which short-circuits the
    request, and only the middleware above it ever sees that response.

    It **mutates** the response rather than replacing it. Everything inner —
    CORS headers most of all — has already been written onto the object by the
    time this runs, and a fresh `HttpResponse` here would silently drop all of
    it.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not request.path.startswith(API_PREFIX):
            return response
        if response.status_code == 301:
            return self._keep_the_method(request, response)
        return self._rewrite(request, response)

    def process_exception(self, request, exception):
        """The one refusal worth naming precisely rather than by its status.

        `RequestDataTooBig` reaches the core handler as a `SuspiciousOperation`
        and comes back as a bare `400 Bad Request` with an empty `<p>` — no
        size, no limit, nothing saying the body was the problem. A graph is the
        largest thing this API accepts, so the caller who meets it is the one
        who can least afford to guess, and `413` with the ceiling in the
        message is the whole answer.
        """
        if not request.path.startswith(API_PREFIX):
            return None
        if isinstance(exception, RequestDataTooBig):
            limit = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
            return json_response(
                413,
                "payload_too_large",
                f"So'rov tanasi juda katta — eng ko'pi {limit} bayt",
            )
        return None

    def _keep_the_method(self, request, response):
        """A permanent redirect that a POST can follow without losing its body.

        `APPEND_SLASH` answers `/api/v1/flows/import` with a 301 to the same
        path plus a slash. curl, `requests` and `fetch` all follow a 301 by
        re-sending as **GET with no body** — so a POST one character short of
        the route arrives at the right endpoint as an empty read and comes back
        `405`, with nothing on either side saying a graph was dropped on the
        way. 308 means "same method, same body", and every one of those clients
        honours it.

        Only for the methods that carry one: a GET keeps the 301 it has always
        had, because that answer was never wrong and it is cached everywhere.
        """
        if request.method in BODYLESS_METHODS:
            return response
        location = urlsplit(response.get("Location", "")).path
        if location != request.path + "/":
            return response
        response.status_code = 308
        return response

    def _rewrite(self, request, response):
        if response.status_code < 400:
            return response
        # A traceback is the only useful thing a 500 has to say, and with debug
        # on it is in the body. Debug is off on anything published
        # (`config.settings.dev`), so this costs the open API nothing and buys
        # the person holding the laptop the page they are looking for.
        if settings.DEBUG and response.status_code >= 500:
            return response
        if getattr(response, "streaming", False):
            return response
        if response.get("Content-Type", "").startswith("application/json"):
            return response

        status = response.status_code
        code = CODES.get(status) or f"http_{status}"
        if status == 404:
            message = f"Bunday endpoint yo'q: {request.method} {request.path}"
        else:
            message = MESSAGES.get(status, "So'rov bajarilmadi")
        response.content = envelope(code, message)
        response["Content-Type"] = "application/json"
        response["Content-Length"] = str(len(response.content))
        return response
