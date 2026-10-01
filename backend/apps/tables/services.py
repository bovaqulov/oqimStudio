"""The rules a table's shape and a table's rows are held to.

Here rather than in the serializers because a row arrives by two very different
doors — the panel's `POST /api/tables/<id>/rows/` and the open
`POST /api/tables/hook/<secret>/` — and a rule enforced in only one of them is
the rule that stops being true. The hook is the door nobody in this repository
controls the caller of, so it is the one the rules exist for.
"""

from __future__ import annotations

import re

from apps.common.exceptions import ApiError

from .models import COLUMN_TYPES, DEFAULT_COLUMN_TYPE, KV_COLUMNS, KV_KEY

#: A handle and a column key follow one rule, because they are read in one
#: place: an expression like `{{ narxlar.oylik }}`. Anything the expression
#: parser cannot spell as an identifier is a name that reads back as nothing.
IDENTIFIER = re.compile(r"^[a-z0-9_]{2,64}$")

#: A ceiling on a JSON blob the caller writes. Fifty is far past any table a
#: person maintains by hand and still a bound — without one, `columns` is an
#: unbounded document that every list response then carries.
MAX_COLUMNS = 50

#: How many choices one `select` column may offer.
#:
#: Past this it is not a choice any more, it is a second table — and the answer
#: then is a column that points at one, not a dropdown nobody can scroll.
MAX_OPTIONS = 100

#: Spellings of a boolean an external system actually sends. A `bool` column
#: fed by a webhook receives `"true"`, `"1"` and `1` from three integrations
#: that all believe they sent the same thing.
TRUE_WORDS = {"true", "1", "ha", "yes", "on"}
FALSE_WORDS = {"false", "0", "yo'q", "yoq", "no", "off"}


def handle_error(value: str) -> str | None:
    """Why this handle is not usable, in the words the field shows — or None."""
    if not value:
        return "Handle kiritilishi shart"
    if not IDENTIFIER.match(value):
        return "Handle faqat kichik lotin harflari, raqamlar va «_» dan iborat, 2–64 belgi"
    return None


def clean_columns(raw) -> list[dict]:
    """`columns` as the database is allowed to hold it.

    Normalising rather than storing what arrived: every reader of this list —
    the studio's table view, the expression that pulls a cell, the row cleaner
    below — would otherwise need its own opinion about a column with no `type`,
    and three opinions is how a column ends up displayed as text and validated
    as a number.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ApiError("invalid_columns", "Ustunlar ro'yxat bo'lishi kerak", field="columns")
    if len(raw) > MAX_COLUMNS:
        raise ApiError("too_many_columns", f"Ustunlar soni {MAX_COLUMNS} tadan oshmasin", field="columns")

    cleaned: list[dict] = []
    seen: set[str] = set()
    for column in raw:
        if not isinstance(column, dict):
            raise ApiError("invalid_columns", "Har bir ustun obyekt bo'lishi kerak", field="columns")

        key = str(column.get("key") or "").strip()
        problem = handle_error(key)
        if problem:
            raise ApiError("invalid_column_key", f"«{key or '—'}»: {problem}", field="columns")
        if key in seen:
            raise ApiError("duplicate_column_key", f"«{key}» ustuni takrorlangan", field="columns")
        seen.add(key)

        kind = str(column.get("type") or DEFAULT_COLUMN_TYPE).strip()
        if kind not in COLUMN_TYPES:
            raise ApiError("invalid_column_type", f"«{kind}» ustun turi mavjud emas", field="columns")

        # The label is what a person reads and the key is what an expression
        # writes; a column that arrives with only the key is a column somebody
        # named once, so the key stands in rather than leaving a blank heading.
        label = str(column.get("label") or "").strip() or key
        entry = {"key": key, "label": label[:120], "type": kind}

        if kind == "select":
            entry["options"] = _options(key, column.get("options"))

        if kind == "formula":
            # Allowed to be blank while it is being written, like a `select`
            # with no options yet. A column with no formula computes nothing.
            entry["formula"] = str(column.get("formula") or "").strip()[:500]

        if kind == "ref":
            target = str(column.get("refTable") or "").strip().lower()
            # Allowed to be empty, for the same reason a `select` may have no
            # options yet: the type is chosen first and pointed somewhere
            # second, and refusing the save in between traps the author.
            if target and handle_error(target):
                raise ApiError("invalid_ref", f"«{key}»: bog'lanadigan ma'lumot nomi noto'g'ri", field="columns")
            shown = str(column.get("refColumn") or "").strip().lower()
            if shown and handle_error(shown):
                raise ApiError("invalid_ref", f"«{key}»: ko'rsatiladigan ustun nomi noto'g'ri", field="columns")
            entry["refTable"] = target
            entry["refColumn"] = shown

        cleaned.append(entry)
    return cleaned


def _options(key: str, raw) -> list[str]:
    """The choices a `select` column offers, tidied and de-duplicated.

    Blank entries are dropped rather than refused: the studio's editor is a
    textarea with one option per line, and a trailing newline is somebody
    pressing Enter, not a mistake worth a 400.

    An empty list is allowed and left alone. A column can be switched to
    `select` before its choices are typed, and refusing the save in between
    would mean the author could not get to the field they were switching to.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ApiError("invalid_options", f"«{key}»: variantlar ro'yxat bo'lishi kerak", field="columns")

    seen: list[str] = []
    for item in raw:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.append(text[:120])
    if len(seen) > MAX_OPTIONS:
        raise ApiError("too_many_options", f"«{key}»: {MAX_OPTIONS} tadan ko'p variant bo'lmasin", field="columns")
    return seen


def _number(key: str, value):
    """A `number` cell, or the 400 the contract asks for.

    A numeric *string* is accepted and converted: an external system posting
    `{"narx": "45000"}` means the number, and refusing it would make the open
    endpoint fail for the most ordinary integration there is. `True` is not a
    number here even though Python says it is an `int` — a boolean landing in a
    price column is a mistake at the caller's end, and storing it as 1 would
    hide that mistake behind a plausible value.
    """
    if isinstance(value, bool):
        raise ApiError("invalid_number", f"«{key}» ustuniga son kiritilishi kerak", field=key)
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip().replace(" ", "")
    try:
        number = float(text)
    except ValueError:
        raise ApiError("invalid_number", f"«{key}» ustuniga son kiritilishi kerak", field=key) from None
    # Back to `int` when nothing was lost, so a count reads as `12` and not as
    # `12.0` in every message the runtime renders it into.
    return int(number) if number.is_integer() else number


def _boolean(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in FALSE_WORDS:
        return False
    if text in TRUE_WORDS:
        return True
    # Anything else is *some* answer rather than none, and Python's own
    # truthiness is the one rule a reader can predict. Deliberately not a 400:
    # only `number` refuses, because only `number` is arithmetic later.
    return bool(value)


def _choice(key: str, value, options: list[str]):
    """A `select` cell: one of the column's own choices, and nothing else.

    Refused rather than stored, which is the opposite of the rule for an unknown
    *column* above — and for the opposite reason. A key nothing reads is
    harmless; a value outside the list is a category the studio's filters, the
    flow's conditions and the author's own head all believe cannot exist.

    A column switched to `select` before its choices were typed accepts
    anything, because a list nobody has written yet is not a rule anybody has
    broken.
    """
    text = str(value).strip()
    if not options or text in options:
        return text
    offered = ", ".join(f"«{option}»" for option in options[:6])
    more = "…" if len(options) > 6 else ""
    raise ApiError(
        "invalid_choice",
        f"«{key}» ustuni faqat shulardan biri bo'ladi: {offered}{more}",
        field=key,
    )


def _reference(table, key: str, value, target_handle: str) -> str:
    """A `ref` cell: the id of a row in the table this column points at.

    Checked against that table rather than taken on trust, because an id that
    names nothing is a reference the reader will see as an empty cell and never
    be told about — the exact silent failure `select` is refused for.

    Same-tenant only, and by construction: the target is looked up inside this
    table's own workspace, so an id copied from another account resolves to
    nothing and is refused like any other.
    """
    from .models import Table, TableRow

    row_id = str(value).strip()
    if not target_handle:
        # Pointed nowhere yet — nothing to check against, so nothing is claimed.
        return row_id

    target = Table.objects.filter(workspace_id=table.workspace_id, handle=target_handle).first()
    if target is None:
        raise ApiError(
            "invalid_ref", f"«{key}»: «{target_handle}» ma'lumoti topilmadi", field=key
        )
    if not TableRow.objects.filter(table=target, pk=row_id).exists():
        raise ApiError(
            "invalid_ref", f"«{key}»: «{target.name}» ichida bunday qator yo'q", field=key
        )
    return row_id


def formula_columns(table) -> list[dict]:
    """The columns this table works out rather than stores."""
    return [
        column
        for column in table.columns
        if isinstance(column, dict) and column.get("type") == "formula" and column.get("formula")
    ]


def compute_formulas(table, rows: list[dict]) -> list[dict]:
    """Fills in the columns that are worked out rather than written.

    One sandbox call for the whole page, not one per row: starting the process
    costs about ninety milliseconds and a table of fifty rows would otherwise
    pay it fifty times. A table with no formula column never starts it at all,
    which is nearly all of them.

    The bot's own script library is placed above the expressions, so a formula
    can say `money(narx * 1.2)` and mean the same `money` every message in
    every flow means. A table with no bot has no library, and the arithmetic
    still works — JavaScript brings its own.

    A formula that throws leaves its cell empty. It is a column somebody is
    still writing, not a reason a price list cannot be opened.
    """
    columns = formula_columns(table)
    if not columns or not rows:
        return rows

    from apps.engine.script import ScriptLimits, compose, run_script

    keys = [
        column["key"]
        for column in table.columns
        if isinstance(column, dict) and column.get("key") and column.get("type") != "formula"
    ]
    body = "\n".join(
        [
            "return inputs.rows.map((__r) => {",
            *[f"  const {key} = __r[{key!r}];" for key in keys],
            "  return {",
            *[
                "    "
                + repr(column["key"])
                + ": (() => { try { return (" + column["formula"] + "); } catch (e) { return null; } })(),"
                for column in columns
            ],
            "  };",
            "});",
        ]
    )
    library = getattr(getattr(table, "bot", None), "script_library", "") or ""
    result = run_script(
        compose(library, body).source,
        {"rows": rows},
        limits=ScriptLimits(timeout_ms=2000),
        workspace_id=table.workspace_id,
    )
    if not result.ok or not isinstance(result.value, list):
        # The whole page's formulas failed — a syntax error in one of them, or
        # no Node on this machine. Every computed cell is empty and the rows
        # that were actually stored are untouched.
        return rows

    out = []
    for row, computed in zip(rows, result.value, strict=False):
        merged = dict(row)
        if isinstance(computed, dict):
            merged.update(computed)
        out.append(merged)
    return out


def readable_rows(table, rows: list[dict]) -> list[dict]:
    """The rows as a person reads them: references named, formulas worked out.

    One door, because there are two passes and their order matters — a formula
    saying `shifokor` means the doctor's *name*, not the id the cell stores, so
    the references are resolved first and the arithmetic runs on the result.

    Every reader in the product comes through here: the studio's grid, the
    «Ma'lumot o'qish» block, and `table()` inside a message. Three copies of
    this order is how one of them ends up printing a hex string.
    """
    return compute_formulas(table, expand_refs(table, rows))


def expand_refs(table, rows: list[dict]) -> list[dict]:
    """The rows as a *reader* wants them: references shown as what they name.

    A `ref` cell holds a row id, which is right for storage and useless in a
    sentence — `{{qator.shifokor}}` reaching a customer as `a91c939a56491b22`
    is the failure this exists to prevent. So every reader in the runtime goes
    through here and gets the display column instead.

    One query per referenced table, not per row: a price list pointing at a
    twelve-row staff table is one extra read however many prices there are.

    A reference that resolves to nothing becomes an empty string rather than the
    id — the row it named is gone, and showing the reader a hex string is worse
    than showing them a gap.
    """
    from .models import Table, TableRow

    ref_columns = [
        column
        for column in table.columns
        if isinstance(column, dict) and column.get("type") == "ref" and column.get("refTable")
    ]
    if not ref_columns or not rows:
        return rows

    labels: dict[str, dict[str, str]] = {}
    for column in ref_columns:
        handle = str(column["refTable"])
        if handle in labels:
            continue
        target = Table.objects.filter(workspace_id=table.workspace_id, handle=handle).first()
        if target is None:
            labels[handle] = {}
            continue
        shown = str(column.get("refColumn") or "")
        labels[handle] = {
            row_id: str((data or {}).get(shown, "") or "")
            for row_id, data in TableRow.objects.filter(table=target).values_list("id", "data")
        }

    expanded = []
    for row in rows:
        copy = dict(row)
        for column in ref_columns:
            key = column["key"]
            if key in copy:
                copy[key] = labels.get(str(column["refTable"]), {}).get(str(copy[key] or ""), "")
        expanded.append(copy)
    return expanded


def kv_columns_for(kind: str, columns):
    """The columns a store of this kind is allowed to have.

    A `kv` store's pair is not a default it starts from — it is what the kind
    *is*, so whatever the caller sent is replaced rather than merged with. The
    columns editor refuses to open on one of these for the same reason.
    """
    return [dict(column) for column in KV_COLUMNS] if kind == "kv" else columns


def kv_key_taken(table, key: str, exclude_row_id: str | None = None) -> bool:
    """Whether this `kv` store already answers to that key.

    Matched exactly, on the stored string. Case-folding it would be a second
    rule to remember in the expression that reads the store back, and «Narx»
    and «narx» being one key is not something anybody could tell by looking at
    the two rows.
    """
    from .models import TableRow

    # Spelled through the constant: `data__kalit` written out would go on
    # matching nothing, silently, the day the key column is renamed.
    rows = TableRow.objects.filter(table=table, **{f"data__{KV_KEY}": key})
    if exclude_row_id:
        rows = rows.exclude(pk=exclude_row_id)
    return rows.exists()


def clean_row_data(table, raw, exclude_row_id: str | None = None) -> dict:
    """One row's `data`, keyed and typed against the table it is going into.

    A key the table does not have is dropped and not refused — the contract
    says so, and it is what keeps an integration working the day somebody
    removes a column in the studio: the payload the external system has been
    sending for a year goes on being accepted, minus the field nothing reads.

    A *missing* `data` is refused rather than read as an empty row, because the
    two differ by a typo: an integration that renamed its envelope would
    otherwise go on answering 201 while filing nothing but blank records.

    `exclude_row_id` is the row being *corrected*, and only a `kv` store reads
    it: saving a row without changing its key must not collide with itself.
    Every door a row arrives through comes here — the panel, the open webhook,
    the spreadsheet importer — which is why the uniqueness rule is enforced in
    this function and not in the three of them.
    """
    if not isinstance(raw, dict):
        raise ApiError("invalid_row", "«data» obyekt bo'lishi kerak", field="data")

    columns = [column for column in table.columns if isinstance(column, dict) and column.get("key")]
    types = {column["key"]: column.get("type") or DEFAULT_COLUMN_TYPE for column in columns}
    choices = {
        column["key"]: [str(option) for option in column.get("options") or []]
        for column in columns
        if (column.get("type") or DEFAULT_COLUMN_TYPE) == "select"
    }
    refs = {
        column["key"]: str(column.get("refTable") or "")
        for column in columns
        if (column.get("type") or DEFAULT_COLUMN_TYPE) == "ref"
    }
    cleaned: dict = {}
    for key, value in raw.items():
        kind = types.get(str(key))
        if kind is None:
            continue
        if kind == "formula":
            # Dropped, not refused. A `formula` column is worked out on the way
            # out, so a value posted into one is a caller echoing back what it
            # read — an integration that GETs a row, changes one field and PUTs
            # the whole thing, which is the commonest shape there is. Storing it
            # would leave a stale copy in the database that nothing ever reads
            # and every export carries.
            continue
        # An empty cell is empty whatever its type — `_number` would refuse the
        # blank an integration sends for "no value", which is not an error.
        if value is None or (isinstance(value, str) and not value.strip()):
            cleaned[key] = None
        elif kind == "number":
            cleaned[key] = _number(key, value)
        elif kind == "bool":
            cleaned[key] = _boolean(value)
        elif kind == "select":
            cleaned[key] = _choice(key, value, choices.get(key, []))
        elif kind == "ref":
            cleaned[key] = _reference(table, key, value, refs.get(key, ""))
        else:
            # `text` and `date` are stored as they arrived. A date is a string
            # the studio formats and the runtime prints; parsing it here would
            # mean picking one of the several formats an integration might send
            # and rejecting the rest.
            cleaned[key] = value

    if getattr(table, "kind", "table") == "kv":
        key = str(cleaned.get(KV_KEY) or "").strip()
        if not key:
            raise ApiError("kv_key_required", "Kalit bo'sh bo'lmasin", field=KV_KEY)
        cleaned[KV_KEY] = key
        if kv_key_taken(table, key, exclude_row_id):
            raise ApiError("kv_key_taken", f"«{key}» kaliti allaqachon bor", field=KV_KEY)
    return cleaned
