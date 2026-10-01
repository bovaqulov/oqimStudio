/**
 * Ma'lumotlar — the rows a bot reads from and writes to.
 *
 * A flow that quotes a price, lists today's services or names the next free
 * slot is only as current as the numbers behind it, and those numbers are not
 * something anybody wants to edit inside a flow card. A table is where they
 * live instead: named columns, rows the owner can type by hand, and one
 * webhook another system can post into.
 *
 * The names here are the API contract (`ma'lumot-kontrakt.md`) — the serializer
 * emits exactly these keys in exactly this case, so a screen and an endpoint
 * can only disagree if one of them changed without the other.
 */

/**
 * What kind of store this is.
 *
 * `table` is columns the author describes with rows under them. `kv` is a
 * dictionary: one value per key. Underneath they are the same two models — a
 * key-value store is a two-column table with a uniqueness rule on the first
 * column — so everything already built for a table works on one unchanged: the
 * grid, the webhook, the spreadsheet, `{{ table("sozlamalar") }}`.
 *
 * Fixed when the store is made. The backend ignores a `kind` on a PATCH, and
 * the reason is in `tables/models.py`: converting a price list into a
 * dictionary has to decide what becomes of the columns it no longer has, and
 * every answer to that loses somebody's data without saying so.
 */
export type TableKind = "table" | "kv";

/** A `kv` store's two columns, which are the kind rather than a starting point. */
export const KV_KEY_COLUMN = "kalit";
export const KV_VALUE_COLUMN = "qiymat";

/** The four kinds of value a column can hold. */
export type ColumnType = "text" | "number" | "date" | "bool" | "select" | "ref" | "formula";

export interface TableColumn {
  /** How the flow addresses it: lowercase latin, digits, `_`. Unique in the table. */
  key: string;
  /** What a person reads at the top of the column. */
  label: string;
  type: ColumnType;
  /**
   * What a `select` column may hold. Empty — or absent — means the list has not
   * been written yet, and until it is the column takes anything: a rule nobody
   * has typed is not a rule anybody can break.
   */
  options?: string[];
  /**
   * A `ref` column's target, by handle. The cell stores a row id from that
   * table; `refColumn` names which of its columns is shown in place of the id.
   *
   * The id is stored and the label is shown, rather than the other way round,
   * because a copied label goes stale the moment the other table is corrected —
   * which is the whole reason to have a reference instead of a second text
   * column.
   */
  refTable?: string;
  refColumn?: string;
  /**
   * A `formula` column's expression, over the row's other columns —
   * `narx * soni`, or `money(narx * 1.2)` using the bot's script library.
   *
   * Worked out every time the row is read and never stored: a computed value
   * kept on disk is a copy that stops agreeing with its inputs the first time
   * one of them is corrected.
   */
  formula?: string;
}

/**
 * What a `ref` cell may point at, resolved for the screen.
 *
 * Built on the server, because the browser has neither the credential nor any
 * business fetching a second table to draw a dropdown.
 */
export interface RefOptions {
  /** Target handle → the rows it offers, already labelled. */
  rows: Record<string, { id: string; label: string }[]>;
  /** Every table in the workspace, for the column editor's target picker. */
  tables: { handle: string; name: string; columns: TableColumn[] }[];
}

/**
 * One cell, as JSON carries it.
 *
 * `null` is a cell nobody has filled in — distinct from `""`, which is an
 * answer of no characters, and the backend keeps the difference.
 */
export type CellValue = string | number | boolean | null;

export interface Table {
  id: string;
  name: string;
  /** The handle a flow's expression uses. Unique within the workspace. */
  handle: string;
  /** Table or dictionary — see [[TableKind]]. Never changes after creation. */
  kind: TableKind;
  /** The bot this table belongs to, when it belongs to one. */
  botId: string | null;
  /**
   * The project it is filed under, or null.
   *
   * Null is a real state and has to be shown: Data is reached through a project
   * now, so a table with none is a table the reader cannot navigate to at all —
   * it exists, a flow can read it by handle, and no screen lists it. Every one
   * of those was made before this field was threaded through the create form.
   */
  projectId: string | null;
  columns: TableColumn[];
  rowCount: number;
  /** Full address an outside system posts a row to — the secret is inside it. */
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableRow {
  id: string;
  tableId: string;
  /** Keyed by column key. A key the table does not have is dropped by the backend. */
  data: Record<string, CellValue>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTableInput {
  workspaceId: string;
  name: string;
  handle: string;
  /** Defaults to `table` when the caller does not say. */
  kind?: TableKind;
  botId: string | null;
  /** The project it belongs to. Null when it was created from the flat list. */
  projectId?: string | null;
  columns: TableColumn[];
}

/** Everything a table's own settings screen can change. Each key is optional — a PATCH. */
export interface UpdateTableInput {
  name?: string;
  handle?: string;
  botId?: string | null;
  /** Moving a table between projects — and the only way to adopt an orphaned one. */
  projectId?: string | null;
  columns?: TableColumn[];
}

/**
 * The type picker, as data.
 *
 * The hint is an example rather than a definition: "1500000" tells a shop owner
 * what goes in a `number` column faster than the word "son" does, and the
 * difference matters because the backend refuses a non-number there with a 400
 * rather than silently storing the text.
 */
export const COLUMN_TYPES: { value: ColumnType; label: string; example: string }[] = [
  { value: "text", label: "Matn", example: "Kesish va yuvish" },
  { value: "number", label: "Son", example: "150000" },
  { value: "date", label: "Sana", example: "2026-03-12" },
  { value: "bool", label: "Ha / yo'q", example: "Ha" },
  { value: "select", label: "Ro'yxatdan", example: "Yangi · Bajarildi" },
  { value: "ref", label: "Boshqa ma'lumotdan", example: "Shifokorlar → Ism" },
  { value: "formula", label: "Hisoblanadi", example: "narx * soni" },
];

const COLUMN_TYPE_SET: ReadonlySet<string> = new Set(COLUMN_TYPES.map((item) => item.value));

/** Whether a string names a column type this build knows — a row arriving from the API is data, not source. */
export function isColumnType(value: string): value is ColumnType {
  return COLUMN_TYPE_SET.has(value);
}
