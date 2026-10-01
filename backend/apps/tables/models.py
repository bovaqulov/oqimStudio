"""Jadvallar — the data a bot answers *from*, rather than the data it collects.

A price list, a timetable, a queue. Two tables and the reason each one exists:

  * `Table` — the shape. A name somebody reads, a `handle` an expression writes
    (`{{ narxlar }}`), and `columns` describing what a row is allowed to hold.
    The columns are a JSON list rather than rows of their own because they are
    read as a whole every single time — no screen and no expression ever asks
    for one column without the others — and because reordering them is then a
    single write instead of a shuffle of position integers.
  * `TableRow` — one record, as `{column key: value}`. Also JSON, and for the
    harder reason: the columns are defined by the workspace at runtime, so a
    real column per field would mean a migration every time somebody added one.

`webhook_secret` is what lets a system nobody here controls append a row. It
stands in the URL as the *only* thing between the public internet and a write,
which is why it is `new_secret` (256 bits) and not `new_id` (64) — the same
distinction `Bot.webhook_token` is written around.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.bots.models import Bot
from apps.common.models import new_id, new_secret
from apps.workspaces.models import Workspace

#: What a column may hold. The vocabulary is closed on purpose: a column type
#: is what decides whether a value is refused (`number`) and how the studio
#: renders the cell, so a type nothing knows about would be a column that
#: validates nothing and displays as whatever the last writer left there.
#: `select` is a column whose value has to be one of a list the author wrote.
#: It carries that list in the column itself (`options`), because the answer to
#: "what may go in here" belongs beside the question and not in a second table
#: nobody would think to look in.
#: `ref` points at a row in another table. What is stored is that row's id —
#: the relational answer — and what is *shown* is one of its columns, named by
#: `refColumn`. Storing the display text instead would be a copy that goes
#: stale the moment the other table is corrected, which is the whole problem a
#: reference exists to solve.
#: `formula` is not stored at all. It is worked out from the row's other
#: columns every time the row is read — which is the only way a computed value
#: can be right: a stored one is a copy that stops agreeing with its inputs the
#: first time one of them is corrected.
COLUMN_TYPES = ("text", "number", "date", "bool", "select", "ref", "formula")
DEFAULT_COLUMN_TYPE = "text"

#: What kind of store this is.
#:
#: `table` is the original: columns the author describes, rows underneath them.
#: `kv` is a dictionary — one value per key, looked up by the key. It is the
#: same two models underneath, deliberately, because a key-value store is a
#: two-column table with a uniqueness rule on the first column, and giving it a
#: model of its own would have meant a second grid, a second webhook, a second
#: importer and a second expression to read it with — four copies of working
#: code to express one constraint.
#:
#: What the kind actually changes is two things and no more: the columns are
#: fixed (`KV_COLUMNS`), and `kalit` may not repeat. That second rule is the
#: whole point. A key-value store that accepts the same key twice answers a
#: lookup with whichever row the database happens to return first, and it does
#: it silently — the reader sees one of their two answers and no sign that the
#: other exists.
TABLE_KINDS = ("table", "kv")
DEFAULT_TABLE_KIND = "table"

#: The key column, by name — the one a `kv` store may not repeat.
KV_KEY = "kalit"
#: The value column.
KV_VALUE = "qiymat"

#: A `kv` store's columns, always. Not a default the author may edit away from:
#: the pair *is* the kind, and a `kv` table whose first column had been renamed
#: would be a store nothing could look a key up in.
KV_COLUMNS = [
    {"key": KV_KEY, "label": "Kalit", "type": "text"},
    {"key": KV_VALUE, "label": "Qiymat", "type": "text"},
]


class Table(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    #: Tenant this table belongs to — every read is filtered by it.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="tables")
    #: Which bot reads it, when it is only meant for one.
    #:
    #: Nullable and `SET_NULL` rather than `CASCADE`: a workspace's price list
    #: outlives the bot that happened to quote it, and deleting a bot must not
    #: take a year of rows with it.
    #: Which project it belongs to.
    #:
    #: Data is a project's resource, beside its bots and its agents — a price
    #: list belongs to the business the project *is*, not to the workspace that
    #: happens to hold three of them. Nullable so a table can outlive a project
    #: the way it outlives a bot, and so nothing has to be invented for rows
    #: that predate the column.
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="tables"
    )
    bot = models.ForeignKey(Bot, on_delete=models.SET_NULL, null=True, blank=True, related_name="tables")

    #: What a person calls it — "Narxlar".
    name = models.CharField(max_length=120)
    #: What an expression calls it — `narxlar`. See `handle_error` for the rule.
    handle = models.SlugField(max_length=64)
    #: `table` or `kv` — see `TABLE_KINDS`. Fixed when the table is made and
    #: never changed afterwards: switching a price list into a dictionary would
    #: have to decide what becomes of the four columns it no longer has, and
    #: every answer to that is a silent loss of somebody's data.
    kind = models.CharField(max_length=16, default=DEFAULT_TABLE_KIND)
    #: `[{"key", "label", "type"}]` — normalised by the serializer, never raw.
    #: Always `KV_COLUMNS` when `kind` is `kv`.
    columns = models.JSONField(default=list)
    #: The unguessable half of `/api/tables/hook/<secret>/`.
    webhook_secret = models.CharField(max_length=64, default=new_secret, unique=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # By name, because this list is read by a person looking for one of
        # theirs. `id` is the tiebreaker and not decoration: two tables named
        # the same would otherwise sort differently between two pages of the
        # same paginated list, and a row would appear twice or not at all.
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["workspace", "handle"], name="uniq_table_handle_per_workspace"),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def is_kv(self) -> bool:
        return self.kind == "kv"

    @property
    def column_keys(self) -> list[str]:
        return [column["key"] for column in self.columns if isinstance(column, dict) and column.get("key")]

    @property
    def webhook_url(self) -> str:
        """Where an outside system POSTs a row.

        Built from `PUBLIC_BASE_URL` and never stored: the stand's hostname
        changes every time a tunnel restarts, and a column holding a copy would
        keep handing out an address that stopped existing hours ago.
        """
        return f"{settings.PUBLIC_BASE_URL}/api/tables/hook/{self.webhook_secret}/"

    def rotate_secret(self) -> str:
        """Retires the current URL and issues a new one."""
        self.webhook_secret = new_secret()
        self.save(update_fields=["webhook_secret", "updated_at"])
        return self.webhook_secret


class TableRow(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="rows")
    #: `{column key: value}`, already cleaned against `table.columns` — see
    #: `services.clean_row_data`. Nothing writes here without going through it.
    data = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["table", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.table_id}:{self.id}"
