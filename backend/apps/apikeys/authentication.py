"""`Authorization: Bearer oq_live_…` — who is calling, and on whose behalf.

The one design decision in this file: **an API key does not authenticate as a
user.** `authenticate` returns an `ApiKeyIdentity`, not the account that created
the key, and `request.auth` is the `ApiKey` row itself.

Returning `key.created_by` would have been shorter and is the trap. That user
carries *their own* memberships — every workspace they belong to, not the one
the key names — so the moment such a request reached anything built on
`resolve_workspace` it would resolve to whichever workspace that person joined
first. A key minted in one tenant would read another. The whole promise of this
feature is that a key sees one workspace, and it can only be kept by never
putting a user with memberships behind it.

The identity is therefore deliberately inert: it satisfies `IsAuthenticated`
and nothing else. `apps.common.tenancy.memberships_of` refuses to treat it as
an account, so an API key that somehow reached an internal endpoint is a clean
refusal rather than a leak or a 500.

This class is **not** in `DEFAULT_AUTHENTICATION_CLASSES`. It is named on the
`/api/v1/` views and nowhere else, so a key is inert against every other
endpoint in the product — including the ones that reveal bot tokens. Scoping
that depends on a permission class being remembered is scoping that gets
forgotten once.
"""

from __future__ import annotations

from rest_framework import authentication, exceptions

from .models import KEY_PREFIX, ApiKey, hash_key


class ApiKeyIdentity:
    """What `request.user` is on an API-key request: enough to be authenticated, and no more.

    Not a `User` and not a subclass of one, so the type check in
    `tenancy.memberships_of` can tell them apart. It has no email, no role and
    no memberships, because the caller is a program and the tenant it acts in
    is `request.auth.workspace` — read from the key, never from a person.
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_superuser = False

    def __init__(self, key: ApiKey):
        self.api_key = key
        #: Some DRF machinery (throttles, loggers) reaches for a primary key.
        #: The key's id is the honest answer to "who is this".
        self.pk = key.id
        self.id = key.id

    def __str__(self) -> str:
        return f"api-key:{self.api_key.prefix}"


class ApiKeyAuthentication(authentication.BaseAuthentication):
    """Reads the key, refuses anything that is not exactly one live key.

    Every refusal here is a 401 and not a 403, which takes `authenticate_header`
    below: DRF downgrades an `AuthenticationFailed` to 403 when the
    authenticator declines to say what credential it wanted. "Your key is
    revoked" answered as 403 reads to the caller as a permissions problem in
    their workspace, and they go looking in the wrong place.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            # No Bearer at all: not our business. Whatever else is configured
            # on the view gets its turn, and `IsAuthenticated` has the last word.
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Authorization sarlavhasi noto'g'ri")

        try:
            raw = header[1].decode("ascii")
        except UnicodeDecodeError:
            raise exceptions.AuthenticationFailed("Kalit yaroqsiz") from None

        if not raw.startswith(KEY_PREFIX):
            # Named rather than folded into "yaroqsiz": somebody pasting a DRF
            # token here should be told the shape is wrong, not left thinking
            # their key was revoked.
            raise exceptions.AuthenticationFailed(f"Kalit '{KEY_PREFIX}' bilan boshlanishi kerak")

        key = ApiKey.objects.select_related("workspace").filter(hashed=hash_key(raw)).first()
        if key is None:
            raise exceptions.AuthenticationFailed("Kalit yaroqsiz")
        if not key.is_usable:
            # Distinct from "yaroqsiz" and safe to be: only the holder of the
            # key can see this message, and telling them the key was withdrawn
            # is the difference between fixing a config and filing a bug.
            raise exceptions.AuthenticationFailed("Kalit bekor qilingan")

        key.touch()
        return ApiKeyIdentity(key), key

    def authenticate_header(self, request) -> str:
        return f'{self.keyword} realm="oqim-api"'
