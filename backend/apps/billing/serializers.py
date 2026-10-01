"""Billing payloads — camelCase, matching `features/billing/types.ts`."""

from __future__ import annotations

from rest_framework import serializers

from .models import Invoice, Plan, Subscription


class PlanSerializer(serializers.ModelSerializer):
    # A number, not the "290000.00" a `DecimalField` serialises to by default.
    # `features/billing/types.ts` declares `price: number`, and the free plan is
    # detected with `price === 0` — a test a string always fails, which is how a
    # plan that costs nothing came to be quoted at "0 UZS / oy".
    price = serializers.FloatField(read_only=True)

    class Meta:
        model = Plan
        fields = ["key", "name", "description", "price", "currency", "limits"]


class SubscriptionSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    planKey = serializers.CharField(source="plan_id", read_only=True)
    renewsAt = serializers.DateField(source="renews_at", read_only=True)
    autoRenew = serializers.BooleanField(source="auto_renew")
    paymentMethod = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = ["workspaceId", "planKey", "status", "renewsAt", "autoRenew", "paymentMethod"]

    def get_status(self, subscription: Subscription) -> dict:
        return {"label": subscription.status, "tone": subscription.status_tone}

    def get_paymentMethod(self, subscription: Subscription):  # noqa: N802
        # `null` rather than {} — the interface reads a missing card as "on a
        # trial or an invoice agreement", which an empty object would not say.
        return subscription.payment_method or None


class InvoiceSerializer(serializers.ModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id", read_only=True)
    #: Same reason as `PlanSerializer.price` — `Invoice.amount` is typed
    #: `amount: number` on the other side and formatted with `formatThousands`.
    amount = serializers.FloatField(read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ["id", "workspaceId", "number", "date", "amount", "currency", "status"]

    def get_status(self, invoice: Invoice) -> dict:
        return {"label": invoice.status, "tone": invoice.status_tone}
