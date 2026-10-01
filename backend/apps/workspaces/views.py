"""Workspace, member and invite endpoints.

The list a caller gets back is their memberships, never the table: there is no
request shape that returns a workspace this user does not belong to.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.billing.services import PlanLimitExceeded, check_plan_allows, plan_allows
from apps.common.exceptions import ApiError

from .invites import invite_link_payload
from .models import RANK, WRITE_ROLES, Invite, Membership, Role, Workspace
from .serializers import (
    CreateWorkspaceSerializer,
    InviteLinkSerializer,
    InviteMemberSerializer,
    InviteSerializer,
    JoinWorkspaceSerializer,
    MemberSerializer,
    WorkspaceSerializer,
)


class WorkspaceViewSet(viewsets.ModelViewSet):
    serializer_class = WorkspaceSerializer
    permission_classes = [IsAuthenticated]
    queryset = Workspace.objects.all()

    def get_queryset(self):
        return Workspace.objects.filter(memberships__user=self.request.user, memberships__invited=False).distinct()

    def _membership(self, workspace: Workspace) -> Membership:
        membership = workspace.memberships.filter(user=self.request.user, invited=False).first()
        if membership is None:
            raise PermissionDenied("Bu ish maydoniga a'zo emassiz")
        return membership

    def create(self, request, *args, **kwargs):
        serializer = CreateWorkspaceSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        workspace = serializer.save()
        return Response(WorkspaceSerializer(workspace).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        if self._membership(serializer.instance).role not in WRITE_ROLES:
            raise PermissionDenied("Ish maydonini tahrirlashga ruxsat yo'q")
        serializer.save()

    def perform_destroy(self, instance):
        if self._membership(instance).role != Role.OWNER:
            raise PermissionDenied("Ish maydonini faqat egasi o'chira oladi")
        instance.delete()

    @action(detail=True, methods=["get", "post"])
    def members(self, request, pk=None):
        workspace = self.get_object()
        membership = self._membership(workspace)

        if request.method == "GET":
            rows = workspace.memberships.select_related("user").all()
            return Response(MemberSerializer(rows, many=True).data)

        if membership.role not in {Role.OWNER, Role.ADMIN}:
            raise PermissionDenied("A'zo qo'shishga ruxsat yo'q")

        serializer = InviteMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].lower()
        role = serializer.validated_data["role"]
        # Nobody hands out a role above the one they hold.
        if RANK[role] > membership.rank:
            raise ApiError("forbidden_role", "O'zingizdan yuqori rol bera olmaysiz", field="role", status_code=403)
        if workspace.memberships.filter(email=email).exists():
            raise ApiError("member_exists", "Bu email allaqachon ro'yxatda", field="email")
        # Before the write, and counted the way the gauge counts it: the row
        # this is about to create holds a seat from the moment it is promised,
        # not from the moment somebody answers their mail. The refusal belongs
        # here for the same reason — an admin can raise the plan or free a
        # seat, and the invitee at the other end of the link can do neither.
        check_plan_allows(workspace, "members", field="email")

        with transaction.atomic():
            pending = Membership.objects.create(
                workspace=workspace, email=email, name=email.split("@")[0], role=role, invited=True
            )
            invite = Invite.objects.create(workspace=workspace, role=role, email=email, created_by=request.user)
        return Response(
            {"member": MemberSerializer(pending).data, "invite": InviteSerializer(invite).data},
            status=status.HTTP_201_CREATED,
        )


    @action(detail=True, methods=["post"], url_path="invite-link")
    def invite_link(self, request, pk=None):
        """Mints a shareable invite and names the two links that carry it.

        The email invite above needs an address to send to, which is the wrong
        shape for a team that talks in Telegram: the person inviting knows the
        chat, not the mailbox. This one addresses nobody — it produces a code
        and hands it back, and getting it to the right person is the inviter's
        job, which is the only part of this they were ever better at than us.

        Single use, like every other `Invite`: `join_workspace` stamps
        `accepted_at` on redemption. A link that stays open is a link that is
        still open next month in a group chat somebody left, so a second person
        gets a new one rather than a longer-lived one.
        """
        workspace = self.get_object()
        membership = self._membership(workspace)
        if membership.role not in {Role.OWNER, Role.ADMIN}:
            raise PermissionDenied("Taklif havolasini yaratishga ruxsat yo'q")

        serializer = InviteLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data["role"]
        # Nobody hands out a role above the one they hold — the same rule the
        # email invite follows, and for the same reason.
        if RANK[role] > membership.rank:
            raise ApiError("forbidden_role", "O'zingizdan yuqori rol bera olmaysiz", field="role", status_code=403)

        # This link holds no seat — there is no row to hold one with — so the
        # cap is checked twice: here, so a workspace does not hand out links it
        # cannot honour, and again in `join_workspace`, which is where the seat
        # is actually taken. No field: nothing the form sent is what is wrong.
        check_plan_allows(workspace, "members")

        invite = Invite.objects.create(workspace=workspace, role=role, created_by=request.user)
        return Response(invite_link_payload(invite, workspace), status=status.HTTP_201_CREATED)


class MembershipViewSet(viewsets.GenericViewSet):
    """Role changes and removals, on one member at a time."""

    serializer_class = MemberSerializer
    permission_classes = [IsAuthenticated]
    queryset = Membership.objects.all()

    def get_queryset(self):
        mine = Membership.objects.filter(user=self.request.user, invited=False).values_list("workspace_id", flat=True)
        return Membership.objects.filter(workspace_id__in=list(mine)).select_related("workspace")

    def _actor(self, target: Membership) -> Membership:
        actor = target.workspace.memberships.filter(user=self.request.user, invited=False).first()
        if actor is None or actor.role not in {Role.OWNER, Role.ADMIN}:
            raise PermissionDenied("A'zolarni boshqarishga ruxsat yo'q")

        # Rank, not role name — and *equal* rank is refused, not just higher.
        # The comment here used to promise that "two admins may not demote each
        # other into a stalemate" while the check said `>`, so one admin could
        # demote and even remove another; whoever moved first won.
        #
        # Yourself is the exception, and it has to be: stepping down after
        # handing ownership over is a legitimate thing to do, and it is the one
        # case where equal rank is not somebody reaching across at a peer.
        # `_last_owner_guard` is what keeps that from emptying the workspace.
        if target.pk != actor.pk and target.rank >= actor.rank:
            raise PermissionDenied("O'zingizdan yuqori yoki teng a'zoni o'zgartira olmaysiz")
        return actor

    @staticmethod
    def _refuse_if_last_owner(target: Membership) -> None:
        """A workspace with no owner is a workspace nobody can finish managing.

        Only an owner may delete it or hand out ownership, so the last one
        leaving locks the door from the outside: the plan cannot be changed,
        the workspace cannot be removed, and nobody can be promoted past admin.
        Recoverable only in the database, which is not a place a customer goes.
        """
        if target.role != Role.OWNER:
            return
        others = target.workspace.memberships.filter(role=Role.OWNER, invited=False).exclude(pk=target.pk)
        if not others.exists():
            raise ApiError(
                "last_owner",
                "Ish maydonining yagona egasisiz. Avval boshqa birovni ega qiling.",
                status_code=409,
            )

    def partial_update(self, request, pk=None):
        target = self.get_object()
        actor = self._actor(target)
        role = request.data.get("role")
        if role not in dict(Role.choices):
            raise ApiError("invalid_role", "Noma'lum rol", field="role")
        if RANK[role] > actor.rank:
            raise PermissionDenied("O'zingizdan yuqori rol bera olmaysiz")
        # Demoting the last owner is the same loss as deleting them.
        if role != Role.OWNER:
            self._refuse_if_last_owner(target)
        target.role = role
        target.save(update_fields=["role"])
        return Response(MemberSerializer(target).data)

    def destroy(self, request, pk=None):
        target = self.get_object()
        self._actor(target)
        if target.role == Role.OWNER:
            raise ApiError("owner_locked", "Ish maydoni egasini o'chirib bo'lmaydi", status_code=403)
        target.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invite_preview(request, code: str):
    """What an invite offers, without spending it.

    Redeeming used to happen on the interface's GET of `/join/<code>`, which is
    the classic mistake: a browser prefetching the link, a double render in
    development, or the reader pressing refresh all consumed the code before
    anybody agreed to anything — and the screen that finally drew said "bunday
    taklif kodi topilmadi" about a code it had just used itself. Reading is a
    GET, joining is the POST below, and only the second one changes anything.
    """
    invite = Invite.objects.filter(code=code).select_related("workspace").first()
    if invite is None:
        raise ApiError("invalid_token", "Bunday taklif kodi topilmadi", field="code", status_code=404)
    return Response(
        {
            "code": invite.code,
            "role": invite.role,
            "workspaceName": invite.workspace.name,
            "usable": invite.is_usable,
            # Already a member is not a failure — the screen says "you are
            # already in" rather than offering a button that does nothing.
            "alreadyMember": invite.workspace.memberships.filter(
                user=request.user, invited=False
            ).exists(),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def join_workspace(request):
    """Redeems an invite code into a membership."""
    serializer = JoinWorkspaceSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    invite = Invite.objects.filter(code=serializer.validated_data["code"].strip()).select_related("workspace").first()
    if invite is None or not invite.is_usable:
        raise ApiError("invalid_token", "Taklif kodi yaroqsiz yoki muddati tugagan", field="code")

    # An invite that named an address may only be redeemed by it.
    #
    # Without this the code was a bearer token: it was mailed to one person, and
    # anybody who came by it — a forwarded mail, a shared screen, a guessed
    # 64-bit code — took the role meant for them, while the invited seat stayed
    # held forever under an email now attached to a stranger's account. A link
    # invite names nobody on purpose (`invite_link` mints it with `email=""`),
    # and that is exactly the difference between the two: one is addressed, one
    # is handed out, and only the addressed one has somebody to check against.
    if invite.email and invite.email.lower() != request.user.email.lower():
        raise ApiError(
            "invite_not_yours",
            "Bu taklif boshqa manzilga yuborilgan. Ish maydoni adminidan havola so'rang.",
            field="code",
            status_code=403,
        )

    workspace = invite.workspace
    membership = workspace.memberships.filter(email=request.user.email).first()
    if membership is None:
        # A new row, so a new seat: this is a link invite, which named nobody
        # and held nothing. An addressed invite already has its row and adds
        # nothing here — keeping a promise the workspace made is never the
        # thing that gets refused.
        #
        # The wording is written for whoever is reading it rather than taken
        # from `limit_message`: they are not a member yet, they cannot raise
        # the plan, and "Ortiqchasini olib tashlang yoki tarifni oshiring" is
        # an instruction addressed to somebody else. The code is left unspent —
        # nothing below this line has run — so it still works once a seat does.
        if not plan_allows(workspace, "members"):
            raise PlanLimitExceeded(
                "Bu ish maydonida bo'sh o'rin qolmagan — tarifdagi jamoa a'zolari soni to'lgan. "
                "Ish maydoni adminidan o'rin bo'shatishni yoki tarifni oshirishni so'rang.",
                field="code",
            )
        membership = Membership(workspace=workspace, email=request.user.email, role=invite.role)
    membership.user = request.user
    membership.name = request.user.name
    membership.invited = False
    membership.joined_at = timezone.now()
    membership.save()

    invite.accepted_at = timezone.now()
    invite.save(update_fields=["accepted_at"])
    return Response(WorkspaceSerializer(workspace).data, status=status.HTTP_201_CREATED)
