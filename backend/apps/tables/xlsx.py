"""Reading and writing .xlsx, with nothing but the standard library.

An .xlsx file is a zip of XML parts, and both halves of "Excel bilan ishlash"
fit in about two hundred lines of `zipfile` and `ElementTree` — which is why
there is no dependency here. `requirements.txt` is deliberately short, and a
spreadsheet library is a large thing to add to a Django service for two
endpoints that move a price list in and out.

What is deliberately *not* implemented: styles on the way out (a bare grid is
what a price list is), formulas, multiple sheets on the way in. The first sheet
is the data, the first row names the columns, and that is the shape of every
file anybody exports from this product or hands to it.

Dates are the one place a reader is unavoidably owed real work. Excel stores a
date as a *number* — days since 1899-12-30 — and says it is a date only in the
cell's style. A reader that ignores styles turns "12-mart" into "46093", so the
number formats are resolved and dated cells come back as ISO strings.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import zipfile
from xml.etree import ElementTree as ET

#: The one namespace both halves of this file speak.
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

#: Excel's day zero. 1899-12-30 rather than 1900-01-01 because Excel believes
#: 1900 was a leap year, and this offset is the conventional way to be wrong in
#: exactly the same direction it is.
EPOCH = dt.datetime(1899, 12, 30)

#: Built-in number formats that mean "this is a date". The list is fixed by the
#: file format itself — 14-22 are dates and times, 45-47 are durations.
BUILTIN_DATE_FORMATS = set(range(14, 23)) | {45, 46, 47}

#: How many rows one import may carry. Past this it is not a spreadsheet
#: somebody maintains, it is a migration, and it belongs in the webhook.
MAX_IMPORT_ROWS = 5000
#: How many rows one export writes. Generous enough that no real price list is
#: truncated, bounded so the response cannot be unbounded.
MAX_EXPORT_ROWS = 10000


def _escape(text: str) -> str:
    """XML text, with the five characters that would otherwise end an element.

    Control characters go too: a cell carrying a stray \\x00 — which a CSV
    round-trip through some tills produces — makes a file Excel refuses to open
    at all, and the reader is owed the row rather than the byte.
    """
    out = (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )
    return "".join(char for char in out if char >= " " or char in "\t\n\r")


def column_letter(index: int) -> str:
    """0 → A, 25 → Z, 26 → AA. The spreadsheet's own column names."""
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def _cell(ref: str, value) -> str:
    """One `<c>`, typed by what Python handed over.

    Strings are written inline rather than through a shared-strings table.
    A shared table is smaller for a file that repeats itself and it is a second
    part to keep consistent; a price list is written once and read by Excel,
    which accepts both.
    """
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{_escape(value)}</t></is></c>'


def _sheet_name(name: str) -> str:
    """A tab name Excel will actually open the file with.

    Excel refuses `: \\ / ? * [ ]` in a sheet name, caps it at 31 characters and
    will not take a blank one — and it reports all three as "the file is
    corrupt" rather than as the naming problem it is.
    """
    cleaned = re.sub(r"[:\\/?*\[\]]", " ", str(name or "")).strip()
    return cleaned[:31] or "Ma'lumot"


def write_xlsx(headers: list[str], rows: list[list], sheet_name: str = "Ma'lumot") -> bytes:
    """A workbook of one sheet: the header row, then the data.

    Returned as bytes rather than streamed. The row cap above is what makes
    that safe, and a response that is already whole is a response whose length
    the browser knows — which is the difference between a download with a
    progress bar and one that looks stalled.
    """
    body = [
        "<row r=\"1\">"
        + "".join(_cell(f"{column_letter(i)}1", head) for i, head in enumerate(headers))
        + "</row>"
    ]
    for number, row in enumerate(rows, start=2):
        body.append(
            f'<row r="{number}">'
            + "".join(_cell(f"{column_letter(i)}{number}", value) for i, value in enumerate(row))
            + "</row>"
        )

    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{MAIN}"><sheetData>' + "".join(body) + "</sheetData></worksheet>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>'
        f'<sheet name="{_escape(_sheet_name(sheet_name))}" sheetId="1" r:id="rId1"/>'
        "</sheets></workbook>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{PKG_REL}">'
        f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    book_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{PKG_REL}">'
        f'<Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", book_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return buffer.getvalue()


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def _date_styles(archive: zipfile.ZipFile) -> set[int]:
    """Which style indices mean the number in the cell is a date.

    A cell points at a `cellXfs` entry, that entry names a number format, and
    only the format says whether 46093 is a quantity or the twelfth of March.
    Custom formats are read too, by looking for the letters a date format is
    spelled with outside of its literal text.
    """
    try:
        root = ET.fromstring(archive.read("xl/styles.xml"))
    except (KeyError, ET.ParseError):
        return set()

    dated_formats = set(BUILTIN_DATE_FORMATS)
    for fmt in root.iter(f"{{{MAIN}}}numFmt"):
        code = fmt.get("formatCode") or ""
        # Literal text inside quotes and colour or condition names inside
        # brackets are not the format — `"yil"` in a code would otherwise make
        # every currency column read as a date.
        bare = re.sub(r'"[^"]*"|\[[^\]]*\]', "", code)
        if re.search(r"[yd]|m{3,}", bare):
            try:
                dated_formats.add(int(fmt.get("numFmtId") or -1))
            except ValueError:
                continue

    styles: set[int] = set()
    cell_xfs = root.find(f"{{{MAIN}}}cellXfs")
    for index, xf in enumerate(cell_xfs or []):
        try:
            if int(xf.get("numFmtId") or 0) in dated_formats:
                styles.add(index)
        except ValueError:
            continue
    return styles


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    """The workbook's string table, flattened.

    A `<si>` can be split into several `<r>` runs when part of the cell was
    formatted differently — bold on one word — so the pieces are joined rather
    than the first one taken, which would silently truncate the value.
    """
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except (KeyError, ET.ParseError):
        return []
    return ["".join(node.text or "" for node in item.iter(f"{{{MAIN}}}t")) for item in root]


def _first_sheet_path(archive: zipfile.ZipFile) -> str:
    """The part holding the first sheet, resolved through the relationships.

    Not `xl/worksheets/sheet1.xml`: the file name and the tab order are
    unrelated, and a workbook whose first tab is `sheet3.xml` is ordinary. When
    the trail cannot be followed, any worksheet is better than an error.
    """
    fallback = next((n for n in sorted(archive.namelist()) if n.startswith("xl/worksheets/sheet")), "")
    try:
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    except (KeyError, ET.ParseError):
        return fallback

    sheet = book.find(f"{{{MAIN}}}sheets/{{{MAIN}}}sheet")
    if sheet is None:
        return fallback
    target_id = sheet.get(f"{{{REL}}}id")
    for relationship in rels:
        if relationship.get("Id") == target_id:
            target = relationship.get("Target") or ""
            return f"xl/{target.lstrip('/')}" if not target.startswith("xl/") else target
    return fallback


def _column_index(ref: str) -> int:
    """`B7` → 1. The letters are the column; the digits are somebody else's."""
    letters = "".join(char for char in ref if char.isalpha())
    index = 0
    for char in letters.upper():
        index = index * 26 + (ord(char) - 64)
    return max(0, index - 1)


def _serial_to_text(number: float) -> str:
    """An Excel date serial as the ISO string the rest of the product stores.

    A whole number is a date and keeps the date shape; anything with a
    fractional part carried a time, and dropping it would quietly move an
    appointment to midnight.
    """
    moment = EPOCH + dt.timedelta(days=float(number))
    if abs(float(number) - int(float(number))) < 1e-9:
        return moment.strftime("%Y-%m-%d")
    return moment.strftime("%Y-%m-%d %H:%M")


def read_xlsx(data: bytes) -> list[list[str]]:
    """The first sheet as a grid of strings, ragged rows padded out.

    Everything comes back as text on purpose. The column types belong to the
    table, not to the spreadsheet, and `clean_row_data` is already the one place
    that decides what a `number` column accepts — a reader that guessed here
    would be a second opinion with no way to agree with the first.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Fayl .xlsx emas — Excel'da «Save as → .xlsx» qilib qayta yuklang.") from None

    with archive:
        strings = _shared_strings(archive)
        dated = _date_styles(archive)
        path = _first_sheet_path(archive)
        if not path:
            raise ValueError("Faylda varaq topilmadi.")
        try:
            sheet = ET.fromstring(archive.read(path))
        except (KeyError, ET.ParseError):
            raise ValueError("Faylni o'qib bo'lmadi — u buzilgan bo'lishi mumkin.") from None

    grid: list[list[str]] = []
    for row in sheet.iter(f"{{{MAIN}}}row"):
        cells: list[str] = []
        for cell in row.findall(f"{{{MAIN}}}c"):
            # Placed by its own reference rather than by its position among the
            # siblings: Excel omits empty cells entirely, so a row whose second
            # column is blank writes A and C, and counting would shift every
            # value after the gap one column to the left.
            index = _column_index(cell.get("r") or "")
            while len(cells) <= index:
                cells.append("")
            cells[index] = _cell_text(cell, strings, dated)
        grid.append(cells)

    width = max((len(row) for row in grid), default=0)
    return [row + [""] * (width - len(row)) for row in grid]


def _cell_text(cell, strings: list[str], dated: set[int]) -> str:
    kind = cell.get("t") or "n"
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{{{MAIN}}}t")).strip()

    value = cell.find(f"{{{MAIN}}}v")
    raw = (value.text or "") if value is not None else ""
    if not raw:
        return ""
    if kind == "s":
        try:
            return strings[int(raw)].strip()
        except (ValueError, IndexError):
            return ""
    if kind == "b":
        return "true" if raw not in ("0", "", "false") else "false"
    if kind in ("str", "e"):
        return raw.strip()

    try:
        style = int(cell.get("s") or -1)
    except ValueError:
        style = -1
    if style in dated:
        try:
            return _serial_to_text(float(raw))
        except (ValueError, OverflowError):
            return raw.strip()
    # A whole number keeps its integer spelling: `150000.0` in a price column is
    # a number the studio would then render with a decimal point nobody typed.
    try:
        number = float(raw)
        return str(int(number)) if number.is_integer() else str(number)
    except ValueError:
        return raw.strip()
