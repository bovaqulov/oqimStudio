"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { showToast } from "@/components/ui/toast-store";
import { EditSheet } from "@/features/bots/components/settings/EditSheet";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { createRowAction, deleteRowAction, updateRowAction } from "../actions";
import type { CellValue, RefOptions, TableColumn, TableRow } from "../types";
import { Select } from "@/components/ui/Select";
import { formatCell, inputTypeFor, parseRow, toInputValue } from "../values";

/**
 * One row, added or corrected.
 *
 * A sheet and not an inline grid cell. The grid a spreadsheet draws needs a
 * pointer, a keyboard and a screen wide enough to hold every column at once,
 * and this app is read on a 390px phone as often as not; a sheet gives every
 * column a full-width field with its own label and its own refusal underneath,
 * which is the same shape as every other edit in the product.
 *
 * The save is not optimistic. A `number` column refuses text and a `date`
 * column refuses a half-typed date, and showing the row as saved before the
 * server has taken it would put a value in the table that is not in the table.
 *
 * **Every field is drawn from its column's type, and one of them is not a field
 * at all.** A `formula` column is worked out from the row's other columns every
 * time the row is read and is never stored, so an input over it offers an
 * answer the backend drops on the way in — which it did, silently: a number
 * typed into «Hisob» vanished on save with no error and no warning, and the
 * list showed a dash. It is shown here as what it is, a value the table
 * calculates, and nothing is sent for it.
 */
export function RowSheet({
  tableId,
  columns,
  row,
  refs,
  onClose,
}: {
  tableId: string;
  columns: TableColumn[];
  /** The row being corrected — absent when this is a new one. */
  row?: TableRow;
  /** What a `ref` field may point at, resolved on the server. */
  refs?: RefOptions;
  onClose: () => void;
}) {
  // The columns this sheet actually writes. A computed one is read from the
  // row and never sent: `clean_row_data` drops it at the other end, so
  // including it would be putting a key in the payload that exists only to be
  // thrown away — and, once it was in the payload, an input over it looked like
  // somewhere to type.
  const written = columns.filter((column) => column.type !== "formula");

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const column of written) initial[column.key] = toInputValue(row?.data[column.key], column.type);
    return initial;
  });
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  function set(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  // `false` keeps the sheet open: a refusal has to be readable beside the field
  // it is about, and what the reader typed has to survive it.
  async function save(): Promise<boolean> {
    if (saving) return false;

    const parsed = parseRow(written, (key) => values[key] ?? "");
    if (!parsed.ok) {
      setError({ key: parsed.key, message: parsed.error });
      return false;
    }

    setSaving(true);
    try {
      const data: Record<string, CellValue> = parsed.data;
      const result = row
        ? await updateRowAction({ tableId, rowId: row.id, data })
        : await createRowAction({ tableId, data });
      if (result.error) {
        // Under the column the backend named, when it named one it can point
        // at. «manzil» kaliti allaqachon bor is about «Kalit» and arrives
        // saying so; printed loose at the foot of the form it read as a
        // complaint about «Qiymat», the field it happened to land under.
        const column = result.column && written.some((item) => item.key === result.column) ? result.column : "";
        setError({ key: column, message: result.error });
        return false;
      }
      showToast(row ? "Qator saqlandi" : "Qator qo'shildi");
      return true;
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!row) return;
    void (async () => {
      const first = columns[0];
      const label = first ? formatCell(row.data[first.key], first.type) : "";
      const ok = await confirmDestructive({
        title: label || "Qator",
        message: label
          ? `«${label}» qatori o'chiriladi. Buni orqaga qaytarib bo'lmaydi.`
          : "Bu qator o'chiriladi. Buni orqaga qaytarib bo'lmaydi.",
        confirmText: "Ha, o'chirilsin",
      });
      if (!ok) return;

      setRemoving(true);
      const result = await deleteRowAction({ tableId, rowId: row.id });
      setRemoving(false);
      if (result.error) {
        showToast(result.error, { tone: "danger" });
        return;
      }
      showToast("Qator o'chirildi");
      onClose();
    })();
  }

  return (
    <EditSheet
      title={row ? "Qatorni tahrirlash" : "Yangi qator"}
      onClose={onClose}
      onDone={save}
      doneText={saving ? "Saqlanmoqda…" : "Saqlash"}
      detent="full"
    >
      {/*
       * Two to a row once there is width for two.
       *
       * A price list is short fields — a name, a number, a date — and stacking
       * them one per line turned a four-column table into a sheet somebody had
       * to scroll to reach the save button of, with two thirds of the width
       * empty beside every box. `sm:` and not always, because the same sheet
       * opens on a phone, where two 150px fields side by side is worse than
       * one that fits a thumb.
       *
       * Every type, with no exception for `text`. There was one — the argument
       * being that a description wants room — and it defeated the whole change
       * in the commonest table there is: a name and a price, where the name is
       * `text`, so the name took a full row and the price sat alone under it.
       * A single-line input scrolls whatever width it has; the exception bought
       * nothing and cost the layout it was inside.
       */}
      <div className="grid gap-4 sm:grid-cols-2">
      {columns.map((column) => (
        <Field
          key={column.key}
          label={column.label || column.key}
          error={error?.key === column.key ? error.message : null}
        >
          {column.type === "formula" ? (
            /* Shown, not offered. Hiding it would be the other defensible
               answer, but a row the reader is looking at has this value in it —
               on the list, in the flow that quotes it — and a form that omitted
               it would read as the value having gone. A well with no caret says
               the same thing an input cannot: this one is worked out. */
            <p className="m-0 flex min-h-11 items-center rounded-[12px] bg-neutral-900 px-3.5 text-[17px] text-neutral-400">
              {row ? formatCell(row.data[column.key], column.type) || "—" : "Saqlangandan keyin hisoblanadi"}
            </p>
          ) : column.type === "ref" ? (
            <Select value={values[column.key] ?? ""} onChange={(event) => set(column.key, event.target.value)}>
              <option value="">—</option>
              {(refs?.rows[column.refTable ?? ""] ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : column.type === "select" && (column.options ?? []).length > 0 ? (
            <Select value={values[column.key] ?? ""} onChange={(event) => set(column.key, event.target.value)}>
              {/* Blank first, and always offered: a column added after these
                  rows were written has no value in them. */}
              <option value="">—</option>
              {(column.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : column.type === "bool" ? (
            <Switch
              checked={values[column.key] === "true"}
              label={values[column.key] === "true" ? "Ha" : "Yo'q"}
              onToggle={() => set(column.key, values[column.key] === "true" ? "false" : "true")}
            />
          ) : (
            <Input
              type={inputTypeFor(column.type)}
              value={values[column.key] ?? ""}
              // The first field somebody can actually type in, which is not
              // always the first column: a table whose first column is computed
              // would otherwise open with the caret nowhere.
              autoFocus={written[0]?.key === column.key}
              // A number field on a phone brings up the number pad, and a date
              // field the date wheel — that is the whole reason the type is
              // carried this far rather than being validated at the end.
              inputMode={column.type === "number" ? "decimal" : undefined}
              onChange={(event) => set(column.key, event.target.value)}
            />
          )}
        </Field>
      ))}
      </div>

      {error && error.key === "" && (
        <p role="alert" className="t-footnote m-0 text-danger-fg">
          {error.message}
        </p>
      )}

      {/* Only when there is something to delete, and never as the sheet's
          primary button — the bottom strip is where a thumb rests. */}
      {row && (
        <Button type="button" variant="danger-ghost" disabled={removing} onClick={remove} className="self-start">
          {removing ? "O'chirilmoqda…" : "Qatorni o'chirish"}
        </Button>
      )}
    </EditSheet>
  );
}
