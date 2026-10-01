"""The two rules every `/api/v1/` request passes, in one place.

They are one permission class rather than a check inside each view for the same
reason `IsWorkspaceMember` is: a rule repeated per endpoint is a rule the next
endpoint forgets, and the endpoint that forgets it is always the quiet one
somebody added in a hurry.

1. **One tenant, and it is the key's.** A key names a workspace. `X-Workspace-Id`
   naming a different one is answered `404 Ish maydoni topilmadi` — the same
   words `tenancy.resolve_workspace` gives a member asking for a workspace they
   are not in, because it is the same answer: that workspace, for you, does not
   exist. Never 403, which would confirm it exists, and under no circumstances
   the other tenant's rows.

2. **The scope the view names, or 403 saying which one.** A refusal that does
   not name the missing scope leaves the caller guessing between four ticks in
   a panel they may not even have access to.

Two classes and not one, because rule 2 has exactly one endpoint it cannot
apply to: `GET /api/v1/me/` answers "which scopes does this key hold", and
putting that behind a scope would answer it only for the keys that did not need
to ask. `IsApiKey` is rule 1; `HasApiKeyScope` is `IsApiKey` plus rule 2, and
it is what every other view uses.
"""

from __future__ import annotations

from rest_framework import permissions
from rest_framework.exceptions import NotFound

from apps.common.exceptions import ApiError
from apps.common.tenancy import WORKSPACE_HEADER, WORKSPACE_PARAM

from .models import SCOPES, ApiKey


def refuse_other_tenant(request, key: ApiKey) -> None:
    """A workspace named in the request has to be the key's own one.

    Both spellings are checked — the header and `?workspaceId=` — because
    `resolve_workspace` accepts both, and a guard that covered one of them
    would be a guard with a query string round it.

    Note what this does *not* do: it never uses the requested value to choose
    anything. The workspace a `/api/v1/` view reads is always
    `request.auth.workspace`. This is a check that the caller and the key agree
    about which tenant they are in, so that a client with a stale header is
    told rather than silently served somebody else's — never a selector.
    """
    requested = request.META.get(WORKSPACE_HEADER) or request.query_params.get(WORKSPACE_PARAM)
    if requested and requested != key.workspace_id:
        raise NotFound("Ish maydoni topilmadi")


class IsApiKey(permissions.BasePermission):
    """Rule 1 on its own: a live key, and the tenant the caller named is its own.

    Split out for exactly one endpoint — `GET /api/v1/me/`, which exists to
    tell a key what scopes it has and therefore cannot be behind a scope. A key
    missing `flows:read` is precisely the key whose holder needs the answer.

    It is a base class and not a copy, so rule 1 has one implementation. What
    it costs is that "a view cannot be born open" now has an exception a person
    has to type: a new view naming this class instead of `HasApiKeyScope` is
    scopeless. That is why there is one and it is named after what it does —
    `HasApiKeyScope` stays the default in `PublicApiMixin`, and anything
    overriding it is visible in the view.
    """

    def has_permission(self, request, view) -> bool:
        key = getattr(request, "auth", None)
        if not isinstance(key, ApiKey):
            # Reached by a session cookie or a DRF token on a `/api/v1/` view.
            # Refused rather than allowed through: the public API is the
            # key-shaped door, and letting a panel credential in here would
            # make it impossible to reason about what a scope means.
            raise ApiError("api_key_required", "Bu API uchun API kalit kerak", status_code=401)

        refuse_other_tenant(request, key)
        return True


class HasApiKeyScope(IsApiKey):
    """Authenticated by a key, in its own tenant, holding the scope the view asks for."""

    def has_permission(self, request, view) -> bool:
        super().has_permission(request, view)
        key = request.auth

        required = getattr(view, "required_scope", "")
        if required not in SCOPES:
            # A view with no scope, or one naming a scope that does not exist,
            # is a bug — and the safe reading of a bug in a permission class is
            # "refuse", never "allow".
            raise ApiError("scope_not_declared", "Bu endpoint uchun doira e'lon qilinmagan", status_code=403)

        if not key.has_scope(required):
            raise ApiError(
                "insufficient_scope",
                f"Bu amal uchun '{required}' doirasi kerak — bu kalitda u yo'q",
                status_code=403,
            )
        return True
