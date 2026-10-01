"""Which tenant a request is acting on, and what it may do there.

Every tenant-scoped read in the API starts here. The workspace is resolved from
the request *and then validated against the caller's memberships*, so a
hand-edited header can never reach another company's data — it simply falls
back to a workspace the caller does belong to.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied  # noqa: F401 - re-raised from resolve_workspace

from apps.workspaces.models import WRITE_ROLES, Membership, Workspace

#: Header the interface sends. A query parameter is accepted too, because a
#: WebSocket handshake and a copy-pasted curl cannot set headers as easily.
WORKSPACE_HEADER = "HTTP_X_WORKSPACE_ID"
WORKSPACE_PARAM = "workspaceId"


def memberships_of(user) -> list[Membership]:
    if not user or not user.is_authenticated:
        return []
    # An API key authenticates as `apikeys.authentication.ApiKeyIdentity`,
    # which is authenticated and is *not* an account — it has no memberships
    # and must never be given any. It cannot reach here through a route (the
    # key is only accepted on `/api/v1/`, which never calls this), so this is
    # the second lock rather than the first: if a future endpoint were ever
    # given both authenticators, the failure has to be a clean refusal instead
    # of a `Membership.objects.filter(user=<not a user>)` that raises — or, on
    # a database that coerces, one that matches.
    if not isinstance(user, get_user_model()):
        return []
    # Explicitly ordered: the first membership is what a request without a
    # workspace header acts on, and "whichever row came back first" is not a
    # tenant choice anyone should be making.
    return list(
        Membership.objects.filter(user=user, invited=False)
        .select_related("workspace")
        .order_by("joined_at", "workspace_id")
    )


def resolve_workspace(request) -> tuple[Workspace, Membership]:
    """The workspace this request acts on, plus the caller's membership in it.

    Raises rather than returning None: an endpoint that needs a tenant cannot
    do anything sensible without one, and a 404 here is the honest answer to
    "that workspace, for you, does not exist".
    """
    requested = request.META.get(WORKSPACE_HEADER) or request.query_params.get(WORKSPACE_PARAM)
    memberships = memberships_of(request.user)
    if not memberships:
        raise PermissionDenied("Bu foydalanuvchi hech qaysi ish maydoniga a'zo emas")

    if requested:
        found = next((m for m in memberships if m.workspace_id == requested), None)
        if found is None:
            raise NotFound("Ish maydoni topilmadi")
        return found.workspace, found

    first = memberships[0]
    return first.workspace, first


#: What an account that has not confirmed its address is told, wherever it is
#: stopped. One string because it is one rule, and a rule with two wordings is
#: read as two rules by whoever has to support it.
VERIFY_FIRST = "Avval email manzilingizni tasdiqlang"


def is_verified(user) -> bool:
    """Has this account cleared the gate every tenant surface applies?

    `User.email_verified` documents itself as "the API refuses tenant data
    until then", and for a while nothing enforced it: an account could sign up,
    skip the mail and create projects. The only thing standing in the way was
    the interface's own route guard, reading a base64 cookie that JavaScript
    can rewrite — a rule the browser volunteers to follow is not a rule.

    An account created through Telegram is verified from the start
    (`accounts.telegram_views`): Telegram established the identity, which is a
    stronger claim than a clicked link, so nothing here excludes it.

    A predicate and not a line inside the permission class, because the
    WebSocket handshake has to apply the same gate and has no permission class
    to apply it with (`realtime.consumers`). Two spellings of "and also
    verified" is one spelling that stops being updated, and the one that stops
    is always the one guarding the quieter door.
    """
    return bool(user and user.is_authenticated and user.email_verified)


class IsWorkspaceMember(permissions.BasePermission):
    """Read for any member, write for anyone above analyst.

    An analyst reads and that is the whole rule — which is why it is one
    permission class rather than a check repeated in every view.
    """

    message = "Bu amal uchun ruxsat yo'q"

    #: Whether the role half of the rule applies here. See `IsWorkspaceReader`,
    #: which is this class with it switched off.
    writes_need_a_write_role = True

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        # An API key authenticates as `apikeys.authentication.ApiKeyIdentity`
        # — authenticated, and deliberately not an account. It is never routed
        # here (the key is only accepted on `/api/v1/`), so this is a guard
        # against a future wiring mistake rather than a live case. It is stated
        # before `is_verified`, which would otherwise reach for an
        # `email_verified` the identity does not have and turn a refusal into a
        # 500 — and a 500 in a permission class is a rule nobody can reason
        # about.
        if not isinstance(request.user, get_user_model()):
            raise PermissionDenied("Bu endpoint uchun hisob kerak — API kalit bu yerda ishlamaydi")
        if not is_verified(request.user):
            raise PermissionDenied(VERIFY_FIRST)
        # Deliberately not swallowed: "that workspace does not exist for you"
        # (404) and "you may read but not write" (403) are different answers,
        # and collapsing them into one leaves the interface guessing.
        _, membership = resolve_workspace(request)
        if not self.writes_need_a_write_role or request.method in permissions.SAFE_METHODS:
            return True
        return membership.role in WRITE_ROLES


class IsWorkspaceReader(IsWorkspaceMember):
    """Signed in, verified, a member here — and no opinion about the method.

    For the surface whose POST is not a write anybody could be given a role
    over: `realtime.views.workspace_ticket` restates access its caller has
    already proved, and it is a POST because a pass must not be cached, not
    because it changes anything. Under the parent class an analyst — who may
    read every screen the socket feeds — would be refused the socket that
    keeps those screens current.

    A subclass and not a second class, so authentication, verification and
    tenant resolution stay one implementation. The drift this is written
    against is silent: a rule tightened in one copy leaves the other reading
    exactly as it always did.
    """

    writes_need_a_write_role = False


class WorkspaceScopedMixin:
    """Filters a viewset's queryset by the resolved workspace and stamps it on create.

    Subclasses write `Model.objects.all()` and get tenant isolation for free —
    the filtering is not something a new endpoint can forget.
    """

    workspace_field = "workspace"

    def _resolve(self) -> None:
        """Resolves the workspace and the caller's membership once per request."""
        if not hasattr(self, "_workspace"):
            self._workspace, self._membership = resolve_workspace(self.request)

    @property
    def workspace(self) -> Workspace:
        self._resolve()
        return self._workspace

    @property
    def membership(self) -> Membership:
        self._resolve()
        return self._membership

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.filter(**{self.workspace_field: self.workspace})

    def perform_create(self, serializer):
        serializer.save(**{self.workspace_field: self.workspace})
