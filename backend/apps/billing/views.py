"""Billing endpoints: the plan, the invoices, and what has been used."""

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, resolve_workspace
from apps.workspaces.models import Role

from .models import Invoice, Plan, Subscription
from .serializers import InvoiceSerializer, PlanSerializer, SubscriptionSerializer
from .services import usage_report


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def plans(request):
    return Response(PlanSerializer(Plan.objects.filter(is_public=True), many=True).data)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceMember])
def subscription(request):
    workspace, membership = resolve_workspace(request)

    if request.method == "POST":
        if membership.role != Role.OWNER:
            raise ApiError("forbidden", "Tarifni faqat ish maydoni egasi o'zgartira oladi", status_code=403)
        plan = Plan.objects.filter(pk=request.data.get("planKey")).first()
        if plan is None:
            raise ApiError("plan_not_found", "Tarif topilmadi", field="planKey", status_code=404)
        record, _ = Subscription.objects.update_or_create(workspace=workspace, defaults={"plan": plan})
        workspace.plan_key = plan.key
        workspace.save(update_fields=["plan_key"])
        return Response(SubscriptionSerializer(record).data)

    record = getattr(workspace, "subscription", None)
    return Response(SubscriptionSerializer(record).data if record else None)


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def invoices(request):
    workspace, _ = resolve_workspace(request)
    return Response(InvoiceSerializer(Invoice.objects.filter(workspace=workspace), many=True).data)


@api_view(["GET"])
@permission_classes([IsWorkspaceMember])
def usage(request):
    workspace, _ = resolve_workspace(request)
    return Response(usage_report(workspace))
