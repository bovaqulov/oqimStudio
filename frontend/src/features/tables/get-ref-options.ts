import "server-only";

import { tablesRepository } from "./data/tables-repository";
import type { RefOptions, Table } from "./types";

/**
 * What every `ref` column on this table can point at.
 *
 * Composed here rather than inside the repository for the same reason the
 * project's resource groups are: it is a view over *other* tables' data, and a
 * repository that reached across tables to build a dropdown would stop being
 * one table's door.
 *
 * Only the tables actually pointed at are read. A workspace with forty of them
 * pays for the one this column names — and a table with no `ref` column costs
 * nothing at all, which is most of them.
 */
export async function getRefOptions(workspaceId: string, table: Table): Promise<RefOptions> {
  const all = await tablesRepository.list(workspaceId);
  const targets = new Set(
    table.columns.filter((column) => column.type === "ref" && column.refTable).map((column) => column.refTable!),
  );

  const rows: RefOptions["rows"] = {};
  await Promise.all(
    [...targets].map(async (handle) => {
      const target = all.find((item) => item.handle === handle);
      if (!target) {
        rows[handle] = [];
        return;
      }
      const shown = table.columns.find((column) => column.refTable === handle)?.refColumn ?? "";
      // One page. A dropdown is not the shape for a table with thousands of
      // rows in it, and pretending otherwise by loading them all would be a
      // select nobody can scroll and a page nobody can open.
      const page = await tablesRepository.listRows(workspaceId, target.id, 1);
      rows[handle] = page.rows.map((row) => ({
        id: row.id,
        // The id as a last resort: a row whose display column is empty still
        // has to be pickable, or it is a row that cannot be referenced at all.
        label: String(row.data[shown] ?? "").trim() || row.id,
      }));
    }),
  );

  return {
    rows,
    tables: all.map((item) => ({ handle: item.handle, name: item.name, columns: item.columns })),
  };
}
