"""One error shape for the whole API, in one language.

DRF answers validation errors with a bare field map and everything else with
`{"detail": ...}`. The interface has a single error renderer, so both are
normalised here into `{"error": {"code", "message", "field"}}` — the shape the
frontend's `AuthError` type already describes.

## Why there is a translation table down there

The product is Uzbek and so are its error messages — except the ones nobody
here wrote. DRF ships **no `uz` catalogue at all**; the reason «This field is
required.» comes back as «Ushbu maydon to'ldirilishi shart.» is that Django's
own catalogue happens to contain that exact English sentence, and Django's
forms use it too. The sentences only DRF says — a wrong method, a throttle, a
media type nothing parses — have no such coincidence behind them and stay in
English.

So the language a caller sees changes halfway down a page, and the line it
changes on is "which library first wrote this string". That is not a decision
anybody made and it is not one worth keeping. `UZBEK_DEFAULTS` is the handful
of sentences that matter, and the rule that keeps it honest is that a message
is only replaced when it is still the library's **default**: the moment this
codebase passed a detail of its own — `resolve_workspace`'s «Ish maydoni
topilmadi», `ApiKeyAuthentication`'s «Kalit bekor qilingan» — those words are
what the caller gets.

The alternative was a real `locale/uz/LC_MESSAGES` catalogue for DRF's strings.
It is the right answer the day this needs a second language; today it would add
a compiled binary to the tree and a `compilemessages` step to every checkout,
to translate six sentences.
"""

from __future__ import annotations

import re
from typing import Any

from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class ApiError(exceptions.APIException):
    """An error the interface is expected to branch on.

    Carries a stable `code` (the same vocabulary as `AuthErrorCode` in the
    frontend) and, when the message belongs under an input, the `field` it
    belongs to.
    """

    status_code = 400
    default_code = "error"

    def __init__(self, code: str, message: str, field: str | None = None, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.field = field
        if status_code is not None:
            self.status_code = status_code


#: Library defaults, in the language everything else answers in. Applied only
#: when the message still *is* the default — see the module docstring.
UZBEK_DEFAULTS: dict[type, str] = {
    exceptions.NotAuthenticated: "Avtorizatsiya ma'lumotlari yuborilmadi",
    exceptions.AuthenticationFailed: "Autentifikatsiya o'tmadi",
    exceptions.PermissionDenied: "Bu amal uchun ruxsat yo'q",
    exceptions.NotFound: "Topilmadi",
    exceptions.ParseError: "So'rov tanasini o'qib bo'lmadi",
}

#: What `get_object_or_404` leaves behind once DRF has turned it into a
#: `NotFound`. It is a *formatted* default rather than a fixed one, so the
#: equality rule above cannot see it — and it is the single most common 404 the
#: panel produces, which makes it the one worth matching by shape.
DJANGO_GENERIC_404 = re.compile(r"^No \S+ matches the given query\.$")


def _first_message(detail: Any) -> tuple[str, str | None]:
    """Pulls a human-readable message (and the field it belongs to) out of DRF's detail."""
    if isinstance(detail, dict):
        for field, value in detail.items():
            message, _ = _first_message(value)
            return message, None if field in {"non_field_errors", "detail"} else str(field)
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    return str(detail), None


def _in_uzbek(exc: Exception, message: str, request) -> str:
    """The same refusal, in the language the rest of the answer is in.

    Three of these are formatted from the request rather than looked up: DRF
    builds «Method "DELETE" not allowed.» by interpolating, so there is no
    default string left to compare against and the honest way back is to say it
    again from the same facts.
    """
    if isinstance(exc, ApiError):
        # Every word of one of these was chosen here. Nothing to translate.
        return message
    if isinstance(exc, exceptions.MethodNotAllowed):
        method = getattr(request, "method", None) or "Bu"
        return f"«{method}» usuli bu manzilda qabul qilinmaydi"
    if isinstance(exc, exceptions.Throttled):
        wait = getattr(exc, "wait", None)
        if wait:
            return f"So'rovlar chegarasidan oshib ketdingiz — {wait} soniyadan keyin qayta urinib ko'ring"
        return "So'rovlar chegarasidan oshib ketdingiz"
    if isinstance(exc, exceptions.UnsupportedMediaType):
        content_type = getattr(request, "content_type", "") or ""
        named = f"«{content_type}» " if content_type else ""
        return f"{named}turidagi tanani bu API o'qimaydi — JSON yuboring"
    if isinstance(exc, exceptions.NotFound) and DJANGO_GENERIC_404.match(message):
        return "Topilmadi"
    replacement = UZBEK_DEFAULTS.get(type(exc))
    if replacement is not None and message == str(getattr(exc, "default_detail", "")):
        return replacement
    return message


def api_exception_handler(exc: Exception, context: dict) -> Response | None:
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    message, field = _first_message(response.data)
    code = getattr(exc, "code", None) or getattr(exc, "default_code", "error")
    # DRF calls it "throttled"; the interface's `AuthErrorCode` calls it this.
    if code == "throttled":
        code = "rate_limited"
    if isinstance(exc, exceptions.ValidationError) and not isinstance(exc, ApiError):
        code = "validation_error"
        # Left alone: a validation message is usually a field's own, and the
        # ones DRF supplies are already translated through Django's catalogue.
    else:
        message = _in_uzbek(exc, message, (context or {}).get("request"))

    payload: dict[str, Any] = {"code": code, "message": message}
    field = getattr(exc, "field", None) or field
    if field:
        payload["field"] = field
    response.data = {"error": payload}
    return response
