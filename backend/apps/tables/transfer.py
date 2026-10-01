"""Moving a table's rows in and out as a spreadsheet.

The pair belongs together and away from `services.py`: what a person opens in
Excel is not what the database holds, and the two directions have to disagree
with storage in exactly matching ways or a file cannot survive its own round
trip.

Three columns behave differently from the rest, and they are the whole reason
this is not a `csv.writer` over `row.data`:

  * `ref` stores a row id and shows a name. The export writes the name — an id
    in a spreadsheet is a column of hex nobody can check — so the import has to
    look the name back up. A name matching no row is refused rather than
    dropped, because the reader typed something they believed pointed
    somewhere.
  * `formula` is worked out on the way out and never stored. It is exported so
    the numbers add up on screen, and ignored on the way in, the same way
    `clean_row_data` ignores it.
  * `bool` reads back as "Ha"/"Yo'q" rather than TRUE/FALSE, because the header
    above it is Uzbek and `_boolean` already understands the words.

Import is all-or-nothing. A partial import leaves the reader to work out which
of five hundred rows landed, and the answer to a file with three bad rows is to
fix the three, not to hunt for them among the ones that got through.
"""

from __future__ import annotations

import csv
import io

from apps.common.exceptions import ApiError

from .models import KV_KEY, TableRow
from .services import clean_row_data, readable_rows
from .xlsx import MAX_EXPORT_ROWS, MAX_IMPORT_ROWS, read_xlsx, write_xlsx

#: How many refusals one answer carries. A file that is wrong in four hundred
#: places is wrong in one way, and the reader needs the first few and the count.
MAX_REPORTED = 12


def _stored_columns(table) -> list[dict]:
    """The table's columns, minus the ones nothing is ever written into."""
    return [
        column
        for column in table.columns
        if isinstance(column, dict) and column.get("key") and column.get("type") != "formula"
    ]


def _shown(value, kind: str) -> object:
    """One cell as a spreadsheet should carry it.

    Numbers stay numbers so Excel can sum the column — a price written as text
    is a column that will not total, which is the first thing anybody does with
    a price list.
    """
    if value is None:
        return ""
    if kind == "bool":
        return "Ha" if value else "Yo'q"
    if kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return str(value)


def export_rows(table) -> bytes:
    """The whole table as an .xlsx: labels on top, the readable values under.

    Labels rather than keys, because the file is for a person. The importer
    accepts either, so a file edited in Excel and handed straight back still
    lines up.
    """
    columns = [
        column
        for column in table.columns
        if isinstance(column, dict) and column.get("key")
    ]
    stored = [row.data or {} for row in table.rows.all()[:MAX_EXPORT_ROWS]]
    # The same reading the studio's grid shows — references named, formulas
    # worked out. An export of the raw store would hand the reader the hex ids
    # their screen has never once displayed.
    readable = readable_rows(table, stored)

    body = [
        [_shown(row.get(column["key"]), column.get("type") or "text") for column in columns]
        for row in readable
    ]
    return write_xlsx([str(column.get("label") or column["key"]) for column in columns], body, table.name)


def _grid(upload) -> list[list[str]]:
    """The uploaded file as rows of strings, whichever of the two it is.

    CSV is accepted beside .xlsx without being advertised: "Save as CSV" is
    what a till, a bank statement and half the world's exports produce, and
    refusing one at the door would be a rule with no reason behind it. The BOM
    Excel writes is stripped — left in, it becomes part of the first heading and
    that column silently matches nothing.
    """
    raw = upload.read()
    if not raw:
        raise ApiError("empty_file", "Fayl bo'sh.", field="file", status_code=400)

    name = (getattr(upload, "name", "") or "").lower()
    if name.endswith(".csv") or not raw.startswith(b"PK"):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            # What Excel on a Windows machine in this region writes when it is
            # not asked for UTF-8. Latin-1 never fails, so this cannot loop.
            text = raw.decode("cp1251", errors="replace")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            # One column, or a file with nothing to go on. A comma is the
            # guess that costs least when it is wrong.
            dialect = csv.excel
        return [list(row) for row in csv.reader(io.StringIO(text), dialect)]

    try:
        return read_xlsx(raw)
    except ValueError as error:
        raise ApiError("unreadable_file", str(error), field="file", status_code=400) from None


def _match_columns(table, headers: list[str]) -> dict[int, dict]:
    """Which spreadsheet column feeds which table column.

    Matched on the label first and the key second, both case- and
    space-insensitive: the export writes labels, a hand-made file usually
    carries them too, and somebody who wrote `narx` at the top meant the column
    called `narx`.

    A heading matching nothing is ignored rather than refused — the same rule
    `clean_row_data` follows for an unknown key, and the reason a file with a
    stray "Izoh" column still imports.
    """
    columns = _stored_columns(table)
    by_name: dict[str, dict] = {}
    for column in columns:
        by_name.setdefault(str(column.get("label") or "").strip().casefold(), column)
        by_name.setdefault(str(column["key"]).strip().casefold(), column)

    matched: dict[int, dict] = {}
    for index, heading in enumerate(headers):
        column = by_name.get(str(heading).strip().casefold())
        if column is not None and column["key"] not in {c["key"] for c in matched.values()}:
            matched[index] = column
    return matched


def _ref_lookups(table, columns: list[dict]) -> dict[str, dict[str, str]]:
    """For each `ref` column, its target's display value → row id.

    One query per referenced table rather than one per cell: a five-hundred-row
    import against a twelve-row staff table is one extra read, not five hundred.

    Built case-folded because the reader is typing a name they read on screen,
    and "Dr. Aziza" and "dr. aziza" are the same doctor to everyone but a
    dictionary.
    """
    from .models import Table

    lookups: dict[str, dict[str, str]] = {}
    for column in columns:
        handle = str(column.get("refTable") or "")
        if column.get("type") != "ref" or not handle or handle in lookups:
            continue
        target = Table.objects.filter(workspace_id=table.workspace_id, handle=handle).first()
        if target is None:
            lookups[handle] = {}
            continue
        shown = str(column.get("refColumn") or "")
        lookups[handle] = {
            str((data or {}).get(shown, "") or "").strip().casefold(): row_id
            for row_id, data in TableRow.objects.filter(table=target).values_list("id", "data")
        }
    return lookups


def _in_reader_words(error: ApiError, matched: dict[int, dict]) -> str:
    """A row refusal with the column named as the spreadsheet names it.

    Only the exact «key» token is swapped, and only when the error says which
    field it was about — so a message that never mentioned a column comes
    through untouched rather than mangled by a blind replace.
    """
    detail = str(error.detail)
    field = getattr(error, "field", None)
    for column in matched.values():
        if column["key"] == field:
            label = str(column.get("label") or column["key"])
            return detail.replace(f"«{column['key']}»", f"«{label}»")
    return detail


def import_rows(table, upload) -> dict:
    """Appends every row in the file, or none of them.

    Appends rather than replaces. Replacing is the destructive reading of an
    ambiguous verb, and a reader who wanted their old prices gone can delete
    them while still holding the file that would have overwritten them.
    """
    grid = _grid(upload)
    if not grid:
        raise ApiError("empty_file", "Faylda hech narsa yo'q.", field="file", status_code=400)

    headers, *body = grid
    matched = _match_columns(table, headers)
    if not matched:
        expected = ", ".join(f"«{c.get('label') or c['key']}»" for c in _stored_columns(table)[:6])
        raise ApiError(
            "no_columns_matched",
            f"Fayldagi sarlavhalar ustunlarga mos kelmadi. Birinchi qatorda shular kutilyapti: {expected}",
            field="file",
            status_code=400,
        )

    # Trailing blank lines are what a spreadsheet ends with, not rows somebody
    # meant to add. Counted out before the cap, so a file of 40 rows and 900
    # empty ones is not refused for being too long.
    body = [row for row in body if any(str(cell).strip() for cell in row)]
    if len(body) > MAX_IMPORT_ROWS:
        raise ApiError(
            "too_many_rows",
            f"Bir martada {MAX_IMPORT_ROWS} tagacha qator yuklash mumkin — faylda {len(body)} ta.",
            field="file",
            status_code=400,
        )
    if not body:
        raise ApiError("empty_file", "Faylda sarlavhadan boshqa qator yo'q.", field="file", status_code=400)

    lookups = _ref_lookups(table, list(matched.values()))
    prepared: list[TableRow] = []
    problems: list[str] = []
    # `clean_row_data` asks the database whether a `kv` key is taken, and the
    # rows above this one in the same file are not in the database yet — they
    # are still in `prepared`, waiting for one `bulk_create`. Without this set
    # a spreadsheet listing the same key twice imports both of them and the
    # store stops being a store.
    seen_keys: set[str] = set()

    for number, row in enumerate(body, start=2):
        data: dict = {}
        for index, column in matched.items():
            cell = str(row[index]).strip() if index < len(row) else ""
            key = column["key"]
            if column.get("type") == "ref":
                handle = str(column.get("refTable") or "")
                if not cell:
                    data[key] = None
                elif handle and cell.casefold() in lookups.get(handle, {}):
                    data[key] = lookups[handle][cell.casefold()]
                elif handle:
                    problems.append(f"{number}-qator: «{column.get('label') or key}» — «{cell}» topilmadi")
                    continue
                else:
                    data[key] = cell
            else:
                data[key] = cell

        try:
            cleaned = clean_row_data(table, data)
            if table.kind == "kv":
                key = str(cleaned.get(KV_KEY) or "")
                if key in seen_keys:
                    problems.append(f"{number}-qator: «{key}» kaliti faylda ikki marta uchraydi")
                    continue
                seen_keys.add(key)
            prepared.append(TableRow(table=table, data=cleaned))
        except ApiError as error:
            # `clean_row_data` names the column by its *key*, which is right for
            # the webhook — a key is what that caller sends. Here the reader is
            # looking at a spreadsheet whose heading says «Narxi», and being
            # told about «narx» sends them looking for a column they cannot see.
            problems.append(f"{number}-qator: {_in_reader_words(error, matched)}")

        if len(problems) > MAX_REPORTED:
            break

    if problems:
        shown = problems[:MAX_REPORTED]
        more = len(problems) - len(shown)
        raise ApiError(
            "invalid_rows",
            "Hech narsa yuklanmadi. "
            + "; ".join(shown)
            + (f" — va yana {more} ta xato" if more > 0 else ""),
            field="file",
            status_code=400,
        )

    TableRow.objects.bulk_create(prepared)
    return {"added": len(prepared), "columns": [column["key"] for column in matched.values()]}
