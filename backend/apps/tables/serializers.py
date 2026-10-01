"""Table payloads — camelCase, matching `features/tables/types.ts`.

`columns` and `data` are the two fields that arrive as free-form JSON, and both
are normalised on the way in rather than stored as they came (see `services`).
The alternative — trusting the writer — is a table whose columns say one thing
to the studio and another to the expression that reads a cell out of it.
"""

from __future__ import annotations

from django.utils.text import slugify
from rest_framework import serializers

from apps.common.exceptions import ApiError
from apps.common.models import new_id

from .models import DEFAULT_TABLE_KIND, TABLE_KINDS, Table, TableRow
from .services import clean_columns, handle_error, kv_columns_for


def derive_handle(workspace, name: str) -> str:
    """A handle from the name, when the caller did not supply one.

    Latin, lowercase, `_` — the same rule `handle_error` enforces, which
    `slugify` alone does not satisfy: it produces dashes, and a dash cannot be
    written in `{{ narxlar.oylik }}`. Uzbek names slugify to nothing often
    enough (an apostrophe-heavy word, a Cyrillic one) that the fallback is not
    theoretical.
    """
    base = slugify(name).replace("-", "_")[:56].strip("_")
    if handle_error(base):
        base = "jadval"
    handle = base
    while Table.objects.filter(workspace=workspace, handle=handle).exists():
        handle = f"{base}_{new_id()[:4]}"
    return handle


class TableSerializer(serializers.ModelSerializer):
    projectId = serializers.CharField(source="project_id", required=False, allow_null=True, allow_blank=True)
    botId = serializers.CharField(source="bot_id", required=False, allow_null=True, allow_blank=True)
    #: Declared rather than derived from the model's `SlugField`, whose own
    #: regex allows `A-Z` and `-`. Two rules for one field means the caller is
    #: refused by whichever fires first, with a code the interface cannot
    #: branch on — `validate_handle` below is the rule this product has.
    handle = serializers.CharField(required=False, allow_blank=True)
    #: Counted by the viewset's annotation; the fallback is for the single
    #: object a create or a PATCH serialises, which never came from that query.
    rowCount = serializers.SerializerMethodField()
    webhookUrl = serializers.CharField(source="webhook_url", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Table
        fields = [
            "id",
            "name",
            "handle",
            "kind",
            "projectId",
            "botId",
            "columns",
            "rowCount",
            "webhookUrl",
            "createdAt",
            "updatedAt",
        ]
        # `kind` is write-once. A PATCH naming a different one is ignored
        # rather than refused, because the only caller that sends it is a
        # client echoing back the object it read.
        read_only_fields = ["id", "createdAt", "updatedAt"]

    def get_rowCount(self, table: Table) -> int:  # noqa: N802
        count = getattr(table, "row_count", None)
        return table.rows.count() if count is None else count

    def validate_columns(self, value):
        return clean_columns(value)

    def validate_kind(self, value):
        kind = (value or DEFAULT_TABLE_KIND).strip()
        if kind not in TABLE_KINDS:
            raise ApiError("invalid_kind", f"«{kind}» turi mavjud emas", field="kind")
        return kind

    def validate_projectId(self, value):  # noqa: N802
        """Same rule as the bot's, and the same reason: "" is how a select clears."""
        return value or None

    def validate_botId(self, value):  # noqa: N802
        # "" and null both mean "no bot" — the studio's select sends the empty
        # string when it is cleared, and a blank FK id is not a value the
        # database can hold.
        return value or None

    def validate_handle(self, value):
        handle = (value or "").strip().lower()
        # Blank on a create means "derive one from the name": the studio's form
        # only shows this field once somebody opens the advanced panel, so most
        # tables are named and never handled. Blank on a *patch* is a mistake —
        # it would leave the expressions that read the table pointing at "".
        if not handle and self.instance is None:
            return ""
        problem = handle_error(handle)
        if problem:
            raise ApiError("invalid_handle", problem, field="handle")

        # Unique inside the tenant, not globally: two companies both calling
        # their price list `narxlar` is the expected case, and the expression
        # that reads it is already scoped to one workspace.
        workspace = self.context.get("workspace")
        clash = Table.objects.filter(workspace=workspace, handle=handle)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise ApiError("handle_taken", f"«{handle}» handle bu ish maydonida band", field="handle")
        return handle

    def create(self, validated_data) -> Table:
        if not validated_data.get("handle"):
            validated_data["handle"] = derive_handle(validated_data["workspace"], validated_data.get("name", ""))
        # Whatever columns a `kv` store was created with, it gets the pair.
        validated_data["columns"] = kv_columns_for(
            validated_data.get("kind", DEFAULT_TABLE_KIND), validated_data.get("columns") or []
        )
        return super().create(validated_data)

    def update(self, instance, validated_data) -> Table:
        # The kind never moves. See the field's comment on the model: every
        # answer to "what happens to the four columns it no longer has" is a
        # silent loss of somebody's rows.
        validated_data.pop("kind", None)
        if "columns" in validated_data:
            validated_data["columns"] = kv_columns_for(instance.kind, validated_data["columns"])
        return super().update(instance, validated_data)


class TableRowSerializer(serializers.ModelSerializer):
    tableId = serializers.CharField(source="table_id", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = TableRow
        fields = ["id", "tableId", "data", "createdAt", "updatedAt"]
        read_only_fields = ["id", "createdAt", "updatedAt"]
