"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Panel } from "@/components/ui/Panel";
import { showToast } from "@/components/ui/toast-store";
import { countOf } from "@/lib/utils/format";
import { updateRowAction } from "../actions";
import type { CellValue, RefOptions, TableColumn, TableRow } from "../types";
import { formatCell, parseCell, toInputValue } from "../values";
import { CellEditor } from "./CellEditor";
import { ExcelTransfer } from "./ExcelTransfer";
import { RowSheet } from "./RowSheet";

/**
 * The rows, drawn twice: a grid on a desk, a list on a phone.
 *
 * The same reasoning as the contacts list. Six columns cannot be squeezed into
 * 390px without shrinking the text below reading size or making the page itself
 * scroll sideways, so below `md` a row becomes what the client this app lives
 * inside would draw — the first column at headline weight, everything else on
 * one secondary line under it. Both are rendered and one is hidden, because the
 * page around this is a server component reading from the API: there is no
 * viewport to branch on before the markup is sent.
 *
 * **The grid is typed into directly.** A cell opens where it stands, commits on
 * Enter or on the way out, and Tab walks to the next one — the keys everybody
 * already knows from a spreadsheet, which is the thing this data actually is.
 * The sheet did not go away: it is still how a whole row is added, and still
 * the only editor a phone gets, where a 390px screen has no room for a grid to
 * be typed into. What changed is that fixing one price no longer means opening
 * a form, finding the field, and closing it again.
 *
 * The value on screen is the one just typed, not the one the server has
 * confirmed — a save that takes 300ms must not make the grid flicker back to
 * the old number. If the save is refused the cell goes back to what it was and
 * says why, which is the only case where the two can disagree.
 */
export function RowsBoard({
  tableId,
  columns,
  rows,
  refs,
  sort = "",
  canEdit,
}: {
  tableId: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** The column the rows are ordered by, `-` for descending. */
  sort?: string;
  /** What a `ref` cell may point at, and the labels its ids stand for. */
  refs?: RefOptions;
  canEdit: boolean;
}) {
  /** `"new"` for the add sheet, a row id for the edit sheet, `null` for neither. */
  const [editing, setEditing] = useState<string | null>(null);
  // `useCallback` because `Modal` registers this as its Escape and backdrop
  // handler in an effect keyed on the identity — a fresh closure every render
  // tears the handler down and bounces focus out of the sheet.
  const closeSheet = useCallback(() => setEditing(null), []);
  const open = editing === "new" ? undefined : rows.find((row) => row.id === editing);
  const [first, ...rest] = columns;

  /** Which cell is open, `null` for none. */
  const [cell, setCell] = useState<{ rowId: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * What has been typed and accepted, per row, over what the server sent.
   *
   * Kept until the page is re-read: the rows arrive from a server component, so
   * without this the grid would show the old value for as long as the refresh
   * takes and then blink to the new one.
   */
  const [local, setLocal] = useState<Record<string, Record<string, CellValue>>>({});
  const [, startSave] = useTransition();
  const router = useRouter();
  const params = useSearchParams();

  const dataOf = (row: TableRow) => ({ ...row.data, ...local[row.id] });

  /** Ordering is a fact about the page, so it travels in the address. */
  function sortBy(key: string, descending: boolean) {
    const next = new URLSearchParams(params.toString());
    next.set("sort", descending ? `-${key}` : key);
    // Re-ordering starts at the top: page 6 of the old order is nowhere in
    // particular in the new one.
    next.delete("page");
    router.replace(`/tables/${tableId}?${next.toString()}`);
  }

  /**
   * What a cell reads as. A reference stores a row id and shows what that row
   * is called — the id itself is never something a person can do anything
   * with, and a table full of hex strings is a table nobody can proofread.
   */
  function show(column: TableColumn, value: CellValue | undefined): string {
    if (column.type !== "ref") return formatCell(value, column.type);
    const options = refs?.rows[column.refTable ?? ""] ?? [];
    return options.find((option) => option.id === String(value ?? ""))?.label ?? "";
  }

  function openCell(row: TableRow, column: TableColumn) {
    // A computed column has nothing to type into — its value belongs to the
    // columns it is worked out from, and letting somebody edit it here would
    // be offering an answer the next read throws away.
    if (!canEdit || column.type === "formula") return;
    setCell({ rowId: row.id, key: column.key });
    setDraft(toInputValue(dataOf(row)[column.key], column.type));
  }

  function commit(row: TableRow, column: TableColumn) {
    const current = dataOf(row);
    const parsed = parseCell(draft, column.type, column.label);
    setCell(null);
    if ("error" in parsed) {
      showToast(parsed.error, { tone: "danger" });
      return;
    }
    // Nothing typed that was not already there — no request, no flicker.
    if (parsed.value === (current[column.key] ?? null)) return;

    const next = { ...current, [column.key]: parsed.value };
    setLocal((state) => ({ ...state, [row.id]: { ...state[row.id], [column.key]: parsed.value } }));
    startSave(async () => {
      const result = await updateRowAction({ tableId, rowId: row.id, data: next });
      if (result.error) {
        // Back to what the server still holds, and said out loud: a grid that
        // keeps a value the database refused is a grid that lies.
        setLocal((state) => {
          const forRow = { ...state[row.id] };
          delete forRow[column.key];
          return { ...state, [row.id]: forRow };
        });
        showToast(result.error, { tone: "danger" });
      }
    });
  }

  /** Tab: commit this one and open the neighbour, wrapping across rows. */
  function step(row: TableRow, column: TableColumn, back: boolean) {
    commit(row, column);
    const columnIndex = columns.findIndex((item) => item.key === column.key);
    const rowIndex = rows.findIndex((item) => item.id === row.id);
    let nextColumn = columnIndex + (back ? -1 : 1);
    let nextRow = rowIndex;
    if (nextColumn >= columns.length) {
      nextColumn = 0;
      nextRow += 1;
    } else if (nextColumn < 0) {
      nextColumn = columns.length - 1;
      nextRow -= 1;
    }
    const target = rows[nextRow];
    const targetColumn = columns[nextColumn];
    // The last cell of the last row is the end of the grid, not a wrap to the
    // top: Tab there means "I am finished", and jumping to row one would put
    // the caret somewhere nobody was looking.
    if (target && targetColumn) requestAnimationFrame(() => openCell(target, targetColumn));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* `flex-wrap`, because a refused import puts its reason on a line of its
          own under these controls rather than in a toast that takes the line
          numbers away after four seconds. */}
      <div className="flex flex-wrap items-center gap-x-2 px-1">
        <span className="t-footnote t-tertiary min-w-0 flex-1">{countOf(rows.length, "qator")}</span>
        {columns.length > 0 && <ExcelTransfer tableId={tableId} canEdit={canEdit} />}
        {canEdit && columns.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="oq-press t-body flex min-h-[44px] flex-none cursor-pointer items-center gap-1.5 px-1 text-accent-400"
          >
            <Icon name="plus" size={16} /> Qator qo&apos;shish
          </button>
        )}
      </div>

      {columns.length === 0 ? (
        <Panel>
          <EmptyState
            icon="table"
            title="Avval ustunlarni belgilang"
            description="Ma'lumot nimadan iborat bo'lishini ustunlar aytadi — qator ularsiz saqlanmaydi."
          />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState icon="table" title="Hozircha qator yo'q" />
        </Panel>
      ) : (
        <>
          <div className="oq-group md:hidden">
            {rows.map((row) => {
              const shown = dataOf(row);
              const headline = first ? show(first, shown[first.key]) : "";
              const line = rest
                .map((column) => `${column.label}: ${show(column, shown[column.key]) || "—"}`)
                .join(" · ");
              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditing(row.id)}
                  className="oq-row cursor-pointer text-left disabled:cursor-default"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="t-headline min-w-0 truncate">{headline || "—"}</span>
                    {line && <span className="t-footnote t-secondary truncate">{line}</span>}
                  </span>
                  {canEdit && <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />}
                </button>
              );
            })}
          </div>

          <Panel className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full border-collapse text-left" style={{ minWidth: 240 + columns.length * 160 }}>
                <thead>
                  {/* Sentence case, not tracked-out uppercase — a column heading
                      is a label, and the key underneath it is what a flow
                      writes, which is the one place it has to be visible while
                      somebody is looking at the data itself. */}
                  <tr className="t-footnote t-secondary border-b border-separator">
                    {columns.map((column) => {
                      const active = sort === column.key || sort === `-${column.key}`;
                      const descending = sort === `-${column.key}`;
                      return (
                        <th key={column.key} className="px-3.5 py-2.5 font-normal">
                          {/* The heading is the control. A separate sort menu
                              would be a second place to look for the thing the
                              reader is already pointing at. */}
                          <button
                            type="button"
                            onClick={() => sortBy(column.key, active && !descending)}
                            className="flex cursor-pointer items-center gap-1 text-left"
                          >
                            {/* The heading, and not the key under it. The key
                                is derived from this heading and never typed —
                                see `ColumnFields` — so printing it here put a
                                second, greyer name under every column of a
                                price list, which is a table the owner reads to
                                check a number. */}
                            <span className="min-w-0 truncate text-text">{column.label}</span>
                            <Icon
                              name="caret-down"
                              size={11}
                              className={[
                                "flex-none transition-transform",
                                active ? "text-accent-400" : "text-neutral-700",
                                descending ? "" : "rotate-180",
                              ].join(" ")}
                            />
                          </button>
                        </th>
                      );
                    })}
                    <th className="w-12 px-3.5 py-2.5 font-normal" aria-label="Amallar" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-separator last:border-0">
                      {columns.map((column) => {
                        const editingThis = cell?.rowId === row.id && cell.key === column.key;
                        const text = show(column, dataOf(row)[column.key]);
                        return (
                          <td
                            key={column.key}
                            onClick={editingThis ? undefined : () => openCell(row, column)}
                            className={[
                              "t-footnote px-3.5 py-2.5",
                              column.type === "number" ? "tabular-nums" : "",
                              // The cell is the target, so the cell is what
                              // lights up. A whole row highlighting on hover
                              // would promise that clicking anywhere in it does
                              // the same thing, and it no longer does.
                              canEdit && !editingThis && column.type !== "formula" ? "cursor-text hover:bg-fill" : "",
                            ].join(" ")}
                          >
                            {editingThis ? (
                              <CellEditor
                                value={draft}
                                type={column.type}
                                options={column.options}
                                refRows={refs?.rows[column.refTable ?? ""]}
                                onChange={setDraft}
                                onCommit={() => commit(row, column)}
                                onCancel={() => setCell(null)}
                                onNext={(back) => step(row, column, back)}
                              />
                            ) : (
                              text || <span className="t-tertiary">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3.5 py-2.5 text-right">
                        {/* The row is the target; this is the same target for a
                            keyboard, which cannot click a `tr`. */}
                        {/* The whole row, for the things a cell cannot do:
                            see every column at once on a narrow table, or
                            delete the row. */}
                        {canEdit && (
                          <IconButton
                            icon="pen-nib"
                            label="Qatorni to'liq ochish"
                            size={28}
                            onClick={() => setEditing(row.id)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {editing && (
        <RowSheet tableId={tableId} columns={columns} row={open} refs={refs} onClose={closeSheet} />
      )}
    </div>
  );
}
