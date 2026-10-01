"""Table endpoints — the shape, the rows, and the one door that is not the panel's.

Everything here is tenant-scoped through `WorkspaceScopedMixin` except the last
function in the file, and that exception is the whole design of this app: an
external system has no account, no workspace header and no token, so the only
thing it can present is a secret standing in the URL. That endpoint therefore
resolves the tenant *from the secret* — the table it finds is the table it
writes to, and there is no id, header or parameter a caller could send that
would move the write somewhere else.

Rows hang off the table rather than living at `/api/table-rows/`: a row is
meaningless without the columns that name its keys, and a top-level collection
would be one more place that has to remember to filter by workspace.
"""

from __future__ import annotations

import re
from urllib.parse import quote

from django.db.models import Count, TextField
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.bots.models import Bot
from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin

from .models import Table, TableRow
from .serializers import TableRowSerializer, TableSerializer
from .services import clean_row_data, readable_rows
from .transfer import export_rows, import_rows

#: The biggest spreadsheet this accepts. Well past any price list and small
#: enough that a stray upload cannot occupy the process while it is parsed.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def row_payload(body):
    """The `data` object out of a request body, whatever the body turned out to be.

    A body that is not an object at all is handed on unchanged rather than
    reached into: `clean_row_data` refuses it with the 400 the caller needs,
    and `body.get("data")` on a JSON array would have been a 500 instead.
    """
    return body.get("data") if isinstance(body, dict) else body


class TableHookThrottle(SimpleRateThrottle):
    """A ceiling on the one endpoint that answers without a credential.

    Keyed on the caller's address rather than on the secret in the path, and
    that is the point rather than an accident: the thing being bounded is
    *guessing*, and a guesser chooses which secret it sends but not which
    address it sends from. Keyed on the secret, a thousand wrong secrets would
    be a thousand fresh buckets and the ceiling would not exist.

    The rate is written here instead of in `DEFAULT_THROTTLE_RATES` because it
    is a property of this endpoint and nothing else reads it — `SimpleRateThrottle`
    only consults the settings when the class has no `rate` of its own.

    Sixty a minute is generous for an integration appending rows as a person
    fills a form somewhere, and low enough that enumerating a 256-bit secret
    stays the impossibility it already is.
    """

    scope = "table-hook"
    rate = "60/min"

    def get_cache_key(self, request, view) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def _searched(table, params):
    """The rows a reader asked for: found, and in the order they asked for.

    Both are done in the database rather than in the page, because the page is
    one of many: filtering a hundred rows the client already has is a filter
    that stops working at row 101, which is exactly when somebody starts
    needing it.

    `q` is matched against the whole record rather than a chosen column. A price
    list is searched for "MRT" without anybody first deciding which column that
    might be in, and the cost of scanning the JSON is the cost of the scan that
    was going to happen anyway.
    """
    rows = table.rows.all()

    query = (params.get("q") or "").strip()
    if query:
        # `data` is JSON in the column and text to the LIKE: SQLite has no JSON
        # search worth the name, and Postgres would need a different expression
        # — so this is deliberately the simple one, and it is honest about
        # matching a key name as well as a value.
        rows = rows.annotate(as_text=Cast("data", TextField())).filter(as_text__icontains=query)

    sort = (params.get("sort") or "").strip()
    if sort:
        descending = sort.startswith("-")
        key = sort.lstrip("-")
        keys = {
            column.get("key")
            for column in table.columns
            if isinstance(column, dict) and column.get("key")
        }
        # Only a column this table actually has. A key from a URL is a caller's
        # string, and ordering by `data__; drop` is a 500 the reader caused by
        # editing the address bar.
        if key in keys:
            cell = KeyTextTransform(key, "data")
            # Nulls last either way: an empty cell is "not answered", and a
            # column sorted to put the unanswered rows first is a sort that
            # buries what the reader asked to see.
            rows = rows.order_by(cell.desc(nulls_last=True) if descending else cell.asc(nulls_last=True))
    return rows


class TableViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    serializer_class = TableSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = Table.objects.select_related("bot").all()

    def get_queryset(self):
        # Counted in the list query rather than per row: a workspace with forty
        # tables is forty extra `COUNT(*)` round trips otherwise, for a number
        # that is only ever printed on a card.
        queryset = super().get_queryset().annotate(row_count=Count("rows"))
        params = self.request.query_params
        # Applied *after* the mixin's workspace filter, so a `botId` from
        # another tenant matches nothing instead of naming its way in.
        if params.get("botId"):
            queryset = queryset.filter(bot_id=params["botId"])
        if params.get("projectId"):
            # The table's own project, not the project of whichever bot happens
            # to be attached: data belongs to the project, and a table with no
            # bot on it is still that project's price list.
            queryset = queryset.filter(project_id=params["projectId"])
        return queryset

    def get_serializer_context(self) -> dict:
        # The handle's uniqueness rule is per workspace, and the serializer is
        # the place that enforces it — but the workspace is resolved by the
        # mixin, which the serializer cannot reach on its own.
        return {**super().get_serializer_context(), "workspace": self.workspace}

    def _bot(self, bot_id: str) -> Bot:
        """The named bot, or the 404 that does not say whose it is.

        The same answer for a bot that never existed and for one belonging to
        another workspace: an error that distinguished them would answer
        questions about other people's tenants.
        """
        bot = Bot.objects.filter(workspace=self.workspace, pk=bot_id).first()
        if bot is None:
            raise ApiError("bot_not_found", "Bot topilmadi", field="botId", status_code=404)
        return bot

    def perform_create(self, serializer):
        if serializer.validated_data.get("bot_id"):
            self._bot(serializer.validated_data["bot_id"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        # A table may be moved between bots — inside its own tenant only.
        # Without this, a PATCH naming a stranger's bot would leave `workspace`
        # saying one thing and `bot` another, which is the one way those two
        # columns can disagree.
        if serializer.validated_data.get("bot_id"):
            self._bot(serializer.validated_data["bot_id"])
        serializer.save()

    def _row(self, table: Table, row_id: str) -> TableRow:
        row = TableRow.objects.filter(table=table, pk=row_id).first()
        if row is None:
            raise ApiError("row_not_found", "Qator topilmadi", status_code=404)
        return row

    @action(detail=True, methods=["get", "post"])
    def rows(self, request, pk=None):
        """The table's records — read a page of them, or append one.

        Paginated because this is the endpoint that grows without limit: the
        columns are a handful and the rows are however many a queue collected
        this month.
        """
        table = self.get_object()
        if request.method == "GET":
            page = self.paginate_queryset(_searched(table, request.query_params))
            payload = TableRowSerializer(page, many=True).data
            # The page as a person reads it: references named and formulas
            # worked out, for the whole page in one pass rather than per row.
            # The stored `data` is untouched — this is a *reading* of it.
            shown = readable_rows(table, [row.data or {} for row in page])
            for item, data in zip(payload, shown, strict=False):
                item["data"] = data
            return self.get_paginated_response(payload)

        data = clean_row_data(table, row_payload(request.data))
        row = TableRow.objects.create(table=table, data=data)
        return Response(TableRowSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch", "delete"], url_path=r"rows/(?P<row_id>[^/.]+)")
    def row(self, request, pk=None, row_id=None):
        """One record: corrected, or removed.

        A PATCH replaces `data` whole rather than merging into it — a cell
        cleared in the studio is a key the payload no longer carries, and a
        merge has no way to tell that apart from a key the caller left out.
        """
        table = self.get_object()
        row = self._row(table, row_id or "")
        if request.method == "DELETE":
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # The row's own id is passed so a `kv` store does not refuse a save
        # that left the key alone — it would otherwise clash with itself.
        row.data = clean_row_data(table, row_payload(request.data), exclude_row_id=row.pk)
        row.save(update_fields=["data", "updated_at"])
        return Response(TableRowSerializer(row).data)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """The whole table as an .xlsx, for whoever keeps the prices in Excel.

        A file response and not JSON, so the browser saves it rather than
        rendering it. The name carries the table and the day: a downloads
        folder with four files called `export.xlsx` is a folder nobody can use.

        `Content-Disposition` spells the name twice — the ASCII fallback for
        clients that read only `filename`, and RFC 5987's `filename*` for the
        ones that can take «Xizmatlar narxlari» without turning it into
        question marks.
        """
        table = self.get_object()
        content = export_rows(table)
        stamp = timezone.localtime(table.updated_at).strftime("%Y-%m-%d")
        stem = re.sub(r"[^\w\- ]", "", table.name).strip() or table.handle
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        ascii_name = f"{table.handle}-{stamp}.xlsx"
        utf8_name = quote(f"{stem} {stamp}.xlsx")
        response["Content-Disposition"] = (
            f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_name}'
        )
        response["Content-Length"] = str(len(content))
        return response

    @action(
        detail=True,
        methods=["post"],
        url_path="import",
        parser_classes=[MultiPartParser, FormParser],
    )
    def import_file(self, request, pk=None):
        """Appends the rows in an uploaded spreadsheet.

        All of them or none: `import_rows` raises with the offending line
        numbers rather than filing what it could, because a half-imported price
        list is worse than a refused one — the reader cannot tell by looking
        which half is new.
        """
        table = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            raise ApiError("no_file", "Fayl yuborilmadi", field="file")
        if upload.size and upload.size > MAX_UPLOAD_BYTES:
            raise ApiError(
                "file_too_large",
                f"Fayl {MAX_UPLOAD_BYTES // (1024 * 1024)} MB dan katta bo'lmasin",
                field="file",
            )
        return Response(import_rows(table, upload), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="rotate-secret")
    def rotate_secret(self, request, pk=None):
        """Issues a new webhook URL and retires the old one immediately.

        What somebody reaches for after pasting the URL into a chat: from this
        call on, the address that leaked writes nothing.
        """
        table = self.get_object()
        table.rotate_secret()
        return Response(self.get_serializer(table).data)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([TableHookThrottle])
def hook(request, secret: str):
    """Appends one row, for a caller with no account.

    `{"data": {...}}` and nothing else — the envelope is there so a later
    version can carry an instruction beside the row without breaking every
    integration written against this one.

    A wrong secret is a 404 and not a 403, and the message names no table: this
    endpoint is reachable by anyone who can reach the site, so every answer it
    gives is public. "That table exists but your secret is wrong" would be a
    fact worth harvesting; "Jadval topilmadi" is not.

    `authentication_classes([])` is deliberate. Left at the default, DRF's
    `SessionAuthentication` would apply CSRF to a POST that arrives from a
    server with no cookie jar, and the endpoint would refuse exactly the caller
    it was written for.
    """
    table = Table.objects.filter(webhook_secret=secret).first()
    if table is None:
        raise ApiError("table_not_found", "Jadval topilmadi", status_code=404)

    data = clean_row_data(table, row_payload(request.data))
    row = TableRow.objects.create(table=table, data=data)
    return Response(TableRowSerializer(row).data, status=status.HTTP_201_CREATED)
