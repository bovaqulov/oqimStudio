"""Managing keys — the panel's three endpoints.

Reached with a session or a DRF token, exactly like every other panel screen.
**Never with an API key**: a credential that can mint credentials is a
credential with every scope, and the four scopes would stop meaning anything
the moment one of them could be used to write a fifth key with all of them.
That is enforced by `ApiKeyAuthentication` not being in the defaults — the key
is inert here — and it is what `test_a_key_cannot_mint_another_key` pins down.

## Who may create and revoke

`WRITE_ROLES` — owner, admin and editor. An analyst may read the list and
nothing else.

The rule this follows is the one already written into `workspaces.views`:
**nobody hands out more than they hold.** There it is spelled `RANK[role] >
membership.rank`; here it falls out of the scopes, because all four of them
name things a write role can already do from the panel today —
`ContactViewSet`, `BotViewSet` and `FlowViewSet` are all plain
`IsWorkspaceMember`, so an editor already reads every contact, lists every bot,
and reads and writes every flow. A key therefore grants its maker nothing they
did not already have; it only changes what is holding the credential.

`{OWNER, ADMIN}` was the other candidate, on the argument that a key is a
member that never signs out and should take what inviting a member takes. It is
the wrong line, and the reason is what people do when they meet it: the person
who builds the integration is an editor, the person who may mint its credential
is not, and an integration that needs an approval round trip gets built with
somebody's personal DRF token instead — which is the exact failure this whole
feature exists to remove. A rule that is routinely worked around is not a
control, it is a detour sign.

**What this rule depends on, so that it can be revisited honestly.** It holds
only while every scope stays inside what an editor can already reach. The
moment a scope is added that an editor cannot exercise themselves — a
`bots:write` that rotates a token, anything touching billing — that scope needs
its own gate, because at that point the key *would* hand out more than its
maker holds. `reveal-token` is already `{OWNER, ADMIN}` and has deliberately no
equivalent in the public API for this reason.

Revocation takes the same roles. It is the safe direction — turning a leaked
credential off should never wait for an admin to wake up — and refusing it to
the person who created the key would be the same detour in reverse.

**So there is no role check in this file.** `IsWorkspaceMember` already refuses
an unsafe method to anyone outside `WRITE_ROLES`, and POST and DELETE are the
only two methods here. A second check restating it would be a line that reads
like a rule and can never fire — and dead code in a permission path is worse
than none, because the next reader trusts it and the one after that edits it
believing something depends on it. What this file owes instead is the paragraph
above, saying why the shared rule is the right one here.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin

from .models import ApiKey, issue_key
from .serializers import ApiKeySerializer, CreateApiKeySerializer


class ApiKeyViewSet(WorkspaceScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsWorkspaceMember]
    serializer_class = ApiKeySerializer
    queryset = ApiKey.objects.select_related("created_by", "workspace").all()

    def create(self, request, *args, **kwargs):
        """Mints a key and returns it — the only response that ever carries the secret.

        `key` is added to the serialised row rather than being a field on the
        serializer, so the string exists in this function and nowhere else in
        the codebase. A reader of `serializers.py` cannot accidentally conclude
        that a key is something a list could contain.
        """
        serializer = CreateApiKeySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        key, raw = issue_key(
            workspace=self.workspace,
            name=serializer.validated_data["name"],
            scopes=serializer.validated_data["scopes"],
            created_by=request.user,
        )
        return Response(
            {**ApiKeySerializer(key).data, "key": raw},
            status=status.HTTP_201_CREATED,
        )

    def destroy(self, request, *args, **kwargs):
        """Withdraws a key. The row stays.

        Deleting it would take away the only record of what was calling and
        whether it had been used — which is the first question after a leak,
        and the one `last_used_at` on a revoked row answers.

        Idempotent: revoking an already-revoked key returns the same row with
        the same `revokedAt`, so a panel double-click is not an error somebody
        has to interpret.
        """
        # `get_object` filters through `WorkspaceScopedMixin`, so a key id from
        # another tenant is a 404 here exactly as it is everywhere else.
        key = self.get_object()
        if key.is_usable:
            key.revoked_at = timezone.now()
            key.save(update_fields=["revoked_at"])
        return Response(ApiKeySerializer(key).data)
