/**
 * One cell, going both ways.
 *
 * A table's data is JSON — a `number` column holds a number and a `bool` column
 * holds `true`, not the strings an `<input>` hands back — and the backend
 * refuses a non-number in a number column with a 400. So the conversion has to
 * happen somewhere, and it happens here, once, for both directions: what the
 * reader typed becomes the value that is stored, and the value that is stored
 * becomes the text in the table.
 *
 * Shared by the row sheet (a client component) and the server action behind it,
 * which is the point of it being a plain module — the same refusal in the same
 * words whether it was caught before the request or after.
 */

import { formatInstant, isISODate } from "@/lib/utils/date";
import { formatThousands } from "@/lib/utils/format";
import type { CellValue, ColumnType } from "./types";

/**
 * A date is an ISO `YYYY-MM-DD` string, never an instant.
 *
 * The contract names the type and not its JSON shape; this is the choice, and
 * it is the one the rest of the app already makes (`lib/utils/date`): a plain
 * calendar day is what `<input type="date">` reads and writes and what a price
 * list means by "amal qiladi", so nothing here has to reason about time zones.
 */
export const DATE_FORMAT = "YYYY-MM-DD";

/** Which `<input type>` a column is typed into. `bool` has no input — it is a switch. */
export function inputTypeFor(type: ColumnType): "text" | "number" | "date" {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

/**
 * The cell as the table prints it. Empty in, empty out — the caller draws the
 * dash, because "—" inside a CSV or a `title` attribute would be a lie.
 */
export function formatCell(value: CellValue | undefined, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "bool") return value ? "Ha" : "Yo'q";
  if (type === "date") return typeof value === "string" && isISODate(value) ? formatInstant(value) : String(value);
  if (type === "number" && typeof value === "number") {
    /*
     * Thousands are grouped from five digits up and not below. A price list is
     * the reason this column exists and "150 000" is how it is written on a
     * wall; a year, a room number or a quantity is four digits or fewer and
     * "2 026" would be a number the reader has to un-group to read.
     */
    return Number.isInteger(value) && Math.abs(value) >= 10_000 ? formatThousands(value) : String(value);
  }
  return String(value);
}

/** What an input shows for a value already stored. */
export function toInputValue(value: CellValue | undefined, type: ColumnType): string {
  if (value === null || value === undefined) return "";
  if (type === "bool") return value ? "true" : "false";
  return String(value);
}

/** A cell the reader left blank — distinct from `""`, which is an answer of no characters. */
export const EMPTY_CELL: CellValue = null;

export type ParsedCell = { ok: true; value: CellValue } | { ok: false; error: string };

/**
 * What the reader typed, as the value that gets stored.
 *
 * A blank field is `null` in every type: the row exists, this cell has no
 * answer yet. Storing `0` or `""` instead would make "narx kiritilmagan"
 * indistinguishable from "bepul", which is the one distinction a price table
 * cannot afford to lose.
 */
export function parseCell(raw: string, type: ColumnType, label: string): ParsedCell {
  const text = raw.trim();
  if (text === "") return { ok: true, value: EMPTY_CELL };

  if (type === "bool") return { ok: true, value: text === "true" || text === "1" || text === "Ha" };

  if (type === "number") {
    // Spaces because that is how a price is written here, and a comma because
    // that is the decimal separator on the keyboard the reader is holding.
    const cleaned = text.replace(/[\s  ]/g, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (cleaned === "" || Number.isNaN(parsed)) {
      return { ok: false, error: `«${label}» ustuniga son yozilsin — masalan 150000.` };
    }
    return { ok: true, value: parsed };
  }

  if (type === "date") {
    if (!isISODate(text)) {
      return { ok: false, error: `«${label}» ustuniga sana ${DATE_FORMAT} ko'rinishida yozilsin — masalan 2026-03-12.` };
    }
    return { ok: true, value: text };
  }

  return { ok: true, value: text };
}

/**
 * A whole row, parsed against the columns it belongs to.
 *
 * Stops at the first refusal rather than collecting them all: the sheet shows
 * one message under one field, and a reader who mistyped two numbers fixes the
 * first, presses Save and meets the second — which is one round trip more and
 * no confusion about which sentence belongs to which field.
 */
export function parseRow(
  columns: readonly { key: string; label: string; type: ColumnType }[],
  read: (key: string) => string,
): { ok: true; data: Record<string, CellValue> } | { ok: false; key: string; error: string } {
  const data: Record<string, CellValue> = {};
  for (const column of columns) {
    const parsed = parseCell(read(column.key), column.type, column.label || column.key);
    if (!parsed.ok) return { ok: false, key: column.key, error: parsed.error };
    data[column.key] = parsed.value;
  }
  return { ok: true, data };
}
