/**
 * Which collected variables the contacts table shows as columns.
 *
 * The choice lives in the URL (`?columns=mijoz_ismi,mijoz_telefoni`) rather
 * than in storage on the reader's machine: a table set up to show the answers
 * a clinic actually reads is a link they can send to a colleague, and the same
 * parameter is what the CSV export is built from.
 */

/** As many as fit before the table stops being readable. The backend caps at the same number. */
export const MAX_VARIABLE_COLUMNS = 8;

export function parseColumns(raw: string): string[] {
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)].slice(0, MAX_VARIABLE_COLUMNS);
}

/** Adds the column, or drops it when it is already there. */
export function toggleColumn(columns: readonly string[], name: string): string[] {
  return columns.includes(name)
    ? columns.filter((column) => column !== name)
    : [...columns, name].slice(0, MAX_VARIABLE_COLUMNS);
}

export function serializeColumns(columns: readonly string[]): string {
  return columns.join(",");
}
