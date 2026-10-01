"""Suhbatlar endpoints — the chat list, one thread, and answering in it.

Two addresses and nothing more: a conversation is a contact, so the thread hangs
off the contact's id rather than off an id of its own.
"""

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, resolve_workspace
from apps.contacts.models import Contact
from apps.workspaces.models import WRITE_ROLES

from .models import Message
from .serializers import ConversationSerializer, MessageSerializer
from .services import conversation_rows, send_reply

#: How many lines of one thread come back at once — the tail, which is what a
#: chat is read from. Older ones are still in the table; nothing on the screen
#: asks for them yet.
THREAD_LIMIT = 200


def _contact(request, contact_id: str) -> tuple[Contact, object]:
    """The conversation, or a 404 that does not admit it exists elsewhere.

    404 and not 403: a contact in another workspace is not a permission the
    caller is missing, it is a row they have no business knowing about. The
    difference is the whole point of scoping the lookup instead of checking the
    row afterwards.
    """
    workspace, membership = resolve_workspace(request)
    contact = Contact.objects.filter(workspace=workspace, pk=contact_id).select_related("bot").first()
    if contact is None:
        raise ApiError("not_found", "Suhbat topilmadi", status_code=404)
    return contact, membership


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def conversations(request):
    workspace, _ = resolve_workspace(request)
    rows = conversation_rows(
        workspace,
        bot_id=request.query_params.get("botId") or "",
        project_id=request.query_params.get("projectId") or "",
        query=(request.query_params.get("q") or "").strip(),
    )
    return Response(ConversationSerializer(rows, many=True).data)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def messages(request, contact_id: str):
    contact, membership = _contact(request, contact_id)

    if request.method == "POST":
        # An analyst reads; answering a customer in the workspace's name is a
        # write like any other — same roles that may edit a flow.
        if membership.role not in WRITE_ROLES:
            raise ApiError("forbidden", "Suhbatga javob yozish uchun ruxsat yo'q", status_code=403)
        text = str(request.data.get("text") or "").strip()
        if not text:
            raise ApiError("empty_message", "Xabar bo'sh", field="text", status_code=400)
        if contact.is_blocked:
            raise ApiError(
                "contact_blocked",
                "Bu foydalanuvchi botni bloklagan — xabar yetib bormaydi.",
                status_code=409,
            )
        message = send_reply(contact, text, request.user)
        return Response(MessageSerializer(message).data, status=201)

    # The tail, oldest first: the newest `THREAD_LIMIT` rows, then reversed, so
    # a long conversation opens where it left off rather than at its beginning.
    # `operator` fed one query per answered line without this — an
    # operator-heavy thread at the limit cost two hundred queries.
    rows = list(
        Message.objects.filter(contact=contact)
        .select_related("operator")
        .order_by("-created_at", "-id")[:THREAD_LIMIT]
    )
    rows.reverse()
    return Response(MessageSerializer(rows, many=True).data)
