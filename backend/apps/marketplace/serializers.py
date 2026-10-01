"""Market payloads — camelCase, matching `features/marketplace/data.ts`."""

from __future__ import annotations

from rest_framework import serializers

from .models import MarketTemplate, TemplateReview


class TemplateReviewSerializer(serializers.ModelSerializer):
    author = serializers.CharField(source="author_name", read_only=True)
    when = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = TemplateReview
        fields = ["id", "author", "rating", "text", "when"]


class TemplateSerializer(serializers.ModelSerializer):
    moduleKey = serializers.CharField(source="module_key", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    rating = serializers.FloatField(read_only=True)
    # A `DecimalField` is serialised as a *string* by default ("0.00"), and the
    # TypeScript side declares these as `number`. Nothing crashes on the
    # mismatch, which is why it lived so long — but `price === 0` is false for
    # `"0.00"`, so every "is this free" test in the panel quietly answered no
    # and a free template was priced at "0 so'm".
    price = serializers.FloatField(read_only=True)
    reviews = TemplateReviewSerializer(many=True, read_only=True)
    isDemo = serializers.BooleanField(source="is_demo", read_only=True)
    installed = serializers.SerializerMethodField()

    class Meta:
        model = MarketTemplate
        fields = [
            "id", "name", "icon", "description", "category", "author", "moduleKey",
            "installs", "price", "currency", "rating", "requires", "preview", "reviews", "updatedAt",
            "isDemo", "installed",
        ]

    def get_installed(self, template: MarketTemplate) -> bool:  # noqa: N802 - contract is camelCase
        """Whether the asking workspace has this template installed.

        The view counts every installed id once and puts the set in the
        context, rather than each row asking the database on its own — a
        catalogue of twenty rows would otherwise be twenty queries for one
        boolean. A serializer used outside a request (the admin, a shell) sees
        no set and answers False, which is the safe direction: it only ever
        withholds the review form.
        """
        return template.pk in self.context.get("installed_ids", set())


class TemplateDetailSerializer(TemplateSerializer):
    """The graph is only sent on the detail view — a list of full graphs is a
    payload nobody on the browsing screen reads."""

    class Meta(TemplateSerializer.Meta):
        fields = TemplateSerializer.Meta.fields + ["nodes", "edges"]
