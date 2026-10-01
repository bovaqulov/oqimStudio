import "server-only";
import { apiFind, apiList, apiRequest } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import type {
  CellValue,
  CreateTableInput,
  Table,
  TableColumn,
  TableKind,
  TableRow,
  UpdateTableInput,
} from "../types";
import { isColumnType } from "../types";

/**
 * Ma'lumotlar, from `/api/tables/`.
 *
 * Ten calls, and every one of them tenant-scoped through the shared seam — the
 * workspace id is never optional, because a table is a workspace's price list
 * and the only thing standing between two of them is the header this adds.
 *
 * Rows hang off their table in the URL (`/api/tables/<id>/rows/<rowId>/`) the
 * way they do in the contract, so a row id from another table cannot be edited
 * by guessing: the backend resolves the table first.
 */

/**
 * One column as the serializer emits it.
 *
 * The last four keys are the halves of a type, not extras: `options` is what a
 * `select` is, `formula` is what a `formula` is, and `refTable`/`refColumn` are
 * where a `ref` points. Each arrives only on the type that has it — see
 * `tables/services.py::clean_columns`.
 */
interface ColumnDto {
  key: string;
  label: string;
  type: string;
  options?: string[];
  refTable?: string;
  refColumn?: string;
  formula?: string;
}

interface TableDto {
  id: string;
  name: string;
  handle: string;
  kind?: string;
  botId: string | null;
  projectId: string | null;
  columns: ColumnDto[];
  rowCount: number;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface TableRowDto {
  id: string;
  tableId: string;
  data: Record<string, CellValue>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A column whose type this build does not know keeps its data and becomes
 * `text`.
 *
 * The alternative — dropping it — would hide a column the reader can see in
 * every row of their own table, which is the worse of the two failures: a fifth
 * type added to the backend before this client ships should read as a plain
 * string, not as a table that lost a column.
 *
 * The type's own field comes with it, and that is not decoration. This used to
 * return `{key, label, type}` and stop there, so a `select` arrived at the
 * screen with no choices, a `formula` with no expression and a `ref` pointing
 * nowhere — however carefully the backend had stored them. The columns editor
 * then showed an empty options box, the row form fell back to a plain text
 * input because there was no list to draw a dropdown from, and the reader was
 * told their own saved work had not been saved. A column read without its type's
 * field is a column that lost the thing the type is for.
 *
 * Carried only for the type that has it, in the order the serializer emits, so
 * the editor's "has anything changed" comparison against the saved value is
 * comparing like with like.
 */
function toColumn(dto: ColumnDto): TableColumn {
  const type = isColumnType(dto.type) ? dto.type : "text";
  const base = { key: dto.key, label: dto.label || dto.key, type };
  if (type === "select") return { ...base, options: dto.options ?? [] };
  if (type === "ref") return { ...base, refTable: dto.refTable ?? "", refColumn: dto.refColumn ?? "" };
  if (type === "formula") return { ...base, formula: dto.formula ?? "" };
  return base;
}

/*
 * Timestamps become sentences here, where the data arrives — the house rule in
 * `lib/utils/date`. Two phrasings, for two questions: `createdAt` is a fact
 * about the past and reads as a date, while `updatedAt` is read to answer "is
 * this list still being kept up", which "3 kun oldin" answers and
 * "12 mart 2026" makes the reader work out.
 */
function toTable(dto: TableDto): Table {
  return {
    id: dto.id,
    name: dto.name,
    handle: dto.handle,
    // A kind this build does not know reads as an ordinary table, for the same
    // reason an unknown column type does: the rows are there either way, and a
    // screen that refused to draw them would hide data the reader owns.
    kind: (dto.kind === "kv" ? "kv" : "table") as TableKind,
    botId: dto.botId ?? null,
    projectId: dto.projectId ?? null,
    columns: (dto.columns ?? []).map(toColumn),
    rowCount: dto.rowCount ?? 0,
    webhookUrl: dto.webhookUrl ?? "",
    createdAt: formatInstant(dto.createdAt),
    updatedAt: formatRelative(dto.updatedAt),
  };
}

function toRow(dto: TableRowDto): TableRow {
  return {
    id: dto.id,
    tableId: dto.tableId,
    // Values stay exactly as JSON carried them. A number formatted here would
    // be a number the row sheet could no longer put back in a `number` input.
    data: dto.data ?? {},
    createdAt: formatInstant(dto.createdAt),
    updatedAt: formatRelative(dto.updatedAt),
  };
}

/** One page of rows, plus the count the page header prints. */
export interface RowPage {
  rows: TableRow[];
  /** Every row in the table, not just this page. */
  total: number;
  /** Whether asking for `page + 1` would return anything. */
  hasMore: boolean;
}

export interface TablesRepository {
  list(workspaceId: string, filter?: { projectId?: string }): Promise<Table[]>;
  getById(workspaceId: string, id: string): Promise<Table | undefined>;
  create(input: CreateTableInput): Promise<Table>;
  update(workspaceId: string, id: string, patch: UpdateTableInput): Promise<Table>;
  delete(workspaceId: string, id: string): Promise<void>;
  /**
   * A new webhook secret, which is a new URL. Whatever was posting to the old
   * one stops that instant — the point of the button, and the reason it asks.
   */
  rotateSecret(workspaceId: string, id: string): Promise<Table | undefined>;

  listRows(
    workspaceId: string,
    tableId: string,
    page?: number,
    /** What the reader is looking for, and the order they asked for it in. */
    find?: { q?: string; sort?: string },
  ): Promise<RowPage>;
  createRow(workspaceId: string, tableId: string, data: Record<string, CellValue>): Promise<TableRow>;
  updateRow(
    workspaceId: string,
    tableId: string,
    rowId: string,
    data: Record<string, CellValue>,
  ): Promise<TableRow>;
  deleteRow(workspaceId: string, tableId: string, rowId: string): Promise<void>;

  /**
   * Appends the rows in a spreadsheet, all of them or none.
   *
   * The file is forwarded rather than parsed here. Reading .xlsx in the Next
   * process would put a second opinion about what a `number` column accepts
   * next to `clean_row_data`, which is already the only one — and the two would
   * disagree the first time either changed.
   */
  importRows(workspaceId: string, tableId: string, file: File): Promise<ImportReport>;
}

/** What an import answers with when it worked. */
export interface ImportReport {
  /** Rows filed. Never partial — a refused file adds nothing at all. */
  added: number;
  /** Which of the table's columns the file's headings matched. */
  columns: string[];
}

/** DRF's page envelope. Rows are the one list here big enough to be paginated. */
interface Paged<T> {
  count: number;
  next: string | null;
  results: T[];
}

const id = (value: string) => encodeURIComponent(value);

class ApiTablesRepository implements TablesRepository {
  async list(workspaceId: string, filter: { projectId?: string } = {}): Promise<Table[]> {
    const rows = await apiList<TableDto>("/api/tables/", {
      workspaceId,
      params: filter.projectId ? { projectId: filter.projectId } : undefined,
    });
    return rows.map(toTable);
  }

  async getById(workspaceId: string, tableId: string): Promise<Table | undefined> {
    const dto = await apiFind<TableDto>(`/api/tables/${id(tableId)}/`, { workspaceId });
    return dto && toTable(dto);
  }

  async create(input: CreateTableInput): Promise<Table> {
    const dto = await apiRequest<TableDto>("/api/tables/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: {
        name: input.name,
        handle: input.handle,
        kind: input.kind ?? "table",
        botId: input.botId,
        projectId: input.projectId ?? null,
        columns: input.columns,
      },
    });
    return toTable(dto);
  }

  async update(workspaceId: string, tableId: string, patch: UpdateTableInput): Promise<Table> {
    const dto = await apiRequest<TableDto>(`/api/tables/${id(tableId)}/`, {
      method: "PATCH",
      workspaceId,
      body: patch,
    });
    return toTable(dto);
  }

  async delete(workspaceId: string, tableId: string): Promise<void> {
    await apiRequest(`/api/tables/${id(tableId)}/`, { method: "DELETE", workspaceId });
  }

  async rotateSecret(workspaceId: string, tableId: string): Promise<Table | undefined> {
    // The contract names the endpoint and not its answer. A body that is the
    // table is used; anything else — including the 204 a rotate could equally
    // well be written as — leaves the caller to re-read, which it does anyway
    // because the screen revalidates.
    const dto = await apiRequest<TableDto | null>(`/api/tables/${id(tableId)}/rotate-secret/`, {
      method: "POST",
      workspaceId,
    });
    return dto && typeof dto === "object" && "webhookUrl" in dto ? toTable(dto) : undefined;
  }

  async listRows(
    workspaceId: string,
    tableId: string,
    page = 1,
    find: { q?: string; sort?: string } = {},
  ): Promise<RowPage> {
    // Searched and sorted by the database, not by the page: a filter applied to
    // the rows already downloaded stops working at row 101, which is the row
    // somebody starts needing it at.
    const payload = await apiRequest<TableRowDto[] | Paged<TableRowDto> | null>(
      `/api/tables/${id(tableId)}/rows/`,
      {
        workspaceId,
        params: {
          ...(page > 1 ? { page } : {}),
          ...(find.q ? { q: find.q } : {}),
          ...(find.sort ? { sort: find.sort } : {}),
        },
      },
    );
    if (Array.isArray(payload)) {
      const rows = payload.map(toRow);
      return { rows, total: rows.length, hasMore: false };
    }
    const rows = (payload?.results ?? []).map(toRow);
    return { rows, total: payload?.count ?? rows.length, hasMore: Boolean(payload?.next) };
  }

  async createRow(workspaceId: string, tableId: string, data: Record<string, CellValue>): Promise<TableRow> {
    const dto = await apiRequest<TableRowDto>(`/api/tables/${id(tableId)}/rows/`, {
      method: "POST",
      workspaceId,
      body: { data },
    });
    return toRow(dto);
  }

  async updateRow(
    workspaceId: string,
    tableId: string,
    rowId: string,
    data: Record<string, CellValue>,
  ): Promise<TableRow> {
    const dto = await apiRequest<TableRowDto>(`/api/tables/${id(tableId)}/rows/${id(rowId)}/`, {
      method: "PATCH",
      workspaceId,
      body: { data },
    });
    return toRow(dto);
  }

  async deleteRow(workspaceId: string, tableId: string, rowId: string): Promise<void> {
    await apiRequest(`/api/tables/${id(tableId)}/rows/${id(rowId)}/`, { method: "DELETE", workspaceId });
  }

  async importRows(workspaceId: string, tableId: string, file: File): Promise<ImportReport> {
    // `form` and not `body`: the seam sends FormData as-is and states no
    // Content-Type of its own, because the multipart boundary is generated by
    // `fetch` and a header written by hand omits it.
    const form = new FormData();
    form.set("file", file);
    const dto = await apiRequest<ImportReport>(`/api/tables/${id(tableId)}/import/`, {
      method: "POST",
      workspaceId,
      form,
    });
    return { added: dto?.added ?? 0, columns: dto?.columns ?? [] };
  }
}

export const tablesRepository: TablesRepository = new ApiTablesRepository();
