"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { keyForLabel } from "../handle";
import { COLUMN_TYPES, type ColumnType, type RefOptions, type TableColumn } from "../types";

/**
 * What a table is made of, as a list you can edit.
 *
 * Used twice — once while creating a table, once on its «Ustunlar» screen — and
 * controlled in both, so the two callers own the state and the save, and this
 * owns only the shape. That is what stops the create form and the editor
 * drifting into two different ideas of what a column is.
 *
 * One column is one row: a heading, the key a flow addresses it by, and what
 * kind of value goes under it. Three answers on one line, under three headings
 * written once at the top — which is the whole difference from the version this
 * replaces, where each column was a two-line block whose four unlabelled boxes
 * the reader had to work out from their placeholder text.
 *
 * **Widths live on the wrappers, never on the controls.** `Input` and `Select`
 * are `w-full` inside themselves, and `cn` here is `clsx` and not
 * `tailwind-merge` — so a `w-[124px]` handed to a `Select` does not replace its
 * `w-full`, it joins it, and which of the two wins is decided by the order
 * Tailwind happened to emit them in. That is exactly what shipped: a type
 * select overflowing its card while the heading input beside it collapsed to
 * nothing. A wrapper that owns the width cannot lose that argument.
 */

/**
 * A column plus an identity that survives its key being retyped.
 *
 * React keys off `uid` and not off `column.key`, which is the whole reason this
 * type exists: the key field is edited a character at a time, and a list keyed
 * by the value being typed remounts the input on every keystroke and throws the
 * caret out of it.
 *
 * The ids are positional (`c0`, `c1`, …) rather than random so the server render
 * and the browser's hydration of it agree.
 */
export interface DraftColumn extends TableColumn {
  uid: string;
  /** The key this column had when the screen opened — `null` for one just added. */
  savedKey: string | null;
}

export function toDrafts(columns: readonly TableColumn[]): DraftColumn[] {
  return columns.map((column, index) => ({ ...column, uid: `c${index}`, savedKey: column.key }));
}

/** The choices as the backend will store them: trimmed, blanks dropped, each one once. */
function tidyOptions(raw: readonly string[] | undefined): string[] {
  const options: string[] = [];
  for (const item of raw ?? []) {
    const text = item.trim().slice(0, 120);
    if (text && !options.includes(text)) options.push(text);
  }
  return options;
}

export function toColumns(drafts: readonly DraftColumn[]): TableColumn[] {
  return drafts.map(({ key, label, type, options, refTable, refColumn, formula }) => ({
    key,
    label,
    type,
    // Only where the type has any, and tidied on the way out: the editor holds
    // the raw lines so a half-typed one is not swallowed mid-keystroke, and
    // this is the moment that stops mattering.
    //
    // Tidied exactly the way `services.py::_options` tidies it — blanks gone,
    // repeats gone — because the editor decides whether anything is unsaved by
    // comparing this against what the API returned. Left un-deduplicated, one
    // choice typed twice came back from the server as one, the two lists never
    // matched again, and the screen said «Saqlanmagan o'zgarish» over a save
    // that had worked perfectly.
    ...(type === "select" ? { options: tidyOptions(options) } : {}),
    ...(type === "ref" ? { refTable: refTable ?? "", refColumn: refColumn ?? "" } : {}),
    ...(type === "formula" ? { formula: (formula ?? "").trim() } : {}),
  }));
}

/** A blank one, with an id nothing else in the list can hold. */
export function emptyColumn(existing: readonly DraftColumn[]): DraftColumn {
  const taken = new Set(existing.map((draft) => draft.uid));
  let index = existing.length;
  while (taken.has(`c${index}`)) index += 1;
  return { uid: `c${index}`, key: "", label: "", type: "text", savedKey: null };
}

export function ColumnFields({
  columns,
  onChange,
  refs,
  ownHandle,
  error,
  disabled = false,
}: {
  columns: DraftColumn[];
  onChange: (next: DraftColumn[]) => void;
  /** The other tables a `ref` column may point at. Absent on the create screen. */
  refs?: RefOptions;
  /** This table's own handle, so it is not offered as its own target. */
  ownHandle?: string;
  /** The one refusal, from whichever save this list belongs to. */
  error?: string | null;
  disabled?: boolean;
}) {
  function patch(uid: string, change: Partial<DraftColumn>) {
    onChange(columns.map((column) => (column.uid === uid ? { ...column, ...change } : column)));
  }

  function move(index: number, by: -1 | 1) {
    const next = [...columns];
    const target = index + by;
    const moved = next[index];
    const displaced = next[target];
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Said once, above the list, rather than repeated as a placeholder in
          every box. Desktop only: the stacked phone layout labels each field
          where it stands, because a header row and its columns fall apart the
          moment they are not side by side. */}
      {columns.length > 0 && (
        <div className="t-caption t-tertiary hidden items-center gap-2 px-1 uppercase md:grid md:grid-cols-[22px_1fr_132px_98px]">
          <span />
          <span>Sarlavha</span>
          <span>Turi</span>
          <span />
        </div>
      )}
      {columns.map((column, index) => {
        return (
          <div
            key={column.uid}
            className="flex flex-col gap-2 rounded-[12px] border border-separator p-2.5 md:gap-1.5 md:border-transparent md:px-1 md:py-1 md:hover:border-separator"
          >
            <div className="flex flex-col gap-2 md:grid md:grid-cols-[22px_1fr_132px_98px] md:items-center md:gap-2">
              {/* Which column this is, in the order the table will show them.
                  It replaces a drag handle that was never wired to anything —
                  the arrows below do the moving, and an ornament that looks
                  draggable and is not is worse than no ornament. */}
              <span className="t-footnote t-tertiary hidden tabular-nums md:block">{index + 1}</span>

              <label className="flex min-w-0 flex-col gap-1">
                <span className="t-caption t-tertiary uppercase md:hidden">Sarlavha</span>
                <Input
                  value={column.label}
                  disabled={disabled}
                  maxLength={60}
                  aria-label={`${index + 1}-ustun sarlavhasi`}
                  placeholder="Xizmat nomi"
                  onChange={(event) => {
                    const label = event.target.value;
                    /*
                     * The key follows the heading, and only while the column is
                     * new. `savedKey` is what it was called when this screen
                     * opened: once a column has been saved, every stored row is
                     * filed under that key, and letting a corrected typo in the
                     * heading rename it would empty the column for every row
                     * already written. So an existing column keeps its key for
                     * good, and the heading above it is free to change.
                     */
                    if (column.savedKey !== null) {
                      patch(column.uid, { label });
                      return;
                    }
                    const taken = columns.filter((item) => item.uid !== column.uid).map((item) => item.key);
                    patch(column.uid, { label, key: keyForLabel(label, taken, index) });
                  }}
                />
              </label>

              <label className="flex min-w-0 flex-col gap-1">
                <span className="t-caption t-tertiary uppercase md:hidden">Turi</span>
                <Select
                  value={column.type}
                  disabled={disabled}
                  aria-label={`${index + 1}-ustun turi`}
                  onChange={(event) => patch(column.uid, { type: event.target.value as ColumnType })}
                >
                  {COLUMN_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="flex items-center justify-end gap-0.5">
                <IconButton
                  icon="caret-up"
                  label="Yuqoriga"
                  size={30}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                />
                <IconButton
                  icon="caret-down"
                  label="Pastga"
                  size={30}
                  disabled={disabled || index === columns.length - 1}
                  onClick={() => move(index, 1)}
                />
                <IconButton
                  icon="trash"
                  label={`${column.label || column.key || "Ustun"} — o'chirish`}
                  tone="danger"
                  size={30}
                  disabled={disabled}
                  onClick={() => onChange(columns.filter((item) => item.uid !== column.uid))}
                />
              </div>
            </div>

            <KeyChip columnKey={column.key} fixed={column.savedKey !== null} />

            {/* The choices, under the row they belong to and only for the type
                that has any. One per line rather than a chip editor: it is the
                shape somebody already has in a message or a spreadsheet, so the
                fastest way in is paste. */}
            {column.type === "select" && (
              <label className="flex flex-col gap-1 md:pl-[30px]">
                <span className="t-caption t-tertiary uppercase">Variantlar — har biri alohida qatorda</span>
                <Textarea
                  rows={3}
                  disabled={disabled}
                  value={(column.options ?? []).join("\n")}
                  placeholder={"Yangi\nBajarildi\nBekor qilindi"}
                  aria-label={`${index + 1}-ustun variantlari`}
                  onChange={(event) =>
                    patch(column.uid, {
                      // Split and kept as typed — blanks and repeats are tidied
                      // by the save, not while somebody is still in the middle
                      // of a line.
                      options: event.target.value.split("\n"),
                    })
                  }
                />
                {(column.options ?? []).filter((option) => option.trim()).length === 0 && (
                  <span className="t-footnote t-tertiary">
                    Ro&apos;yxat bo&apos;sh — bu ustun hozircha istalgan qiymatni qabul qiladi.
                  </span>
                )}
              </label>
            )}

            {/* Where it points, and what it shows. Two questions and not one,
                because the id it stores is never the thing anybody reads: a
                cell holding a row id has to be told which of that row's columns
                stands in for it. */}
            {column.type === "ref" && (
              <div className="flex flex-col gap-2 md:pl-[30px] md:flex-row">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="t-caption t-tertiary uppercase">Qaysi ma&apos;lumotdan</span>
                  <Select
                    value={column.refTable ?? ""}
                    disabled={disabled}
                    onChange={(event) => patch(column.uid, { refTable: event.target.value, refColumn: "" })}
                  >
                    <option value="">Tanlanmagan</option>
                    {(refs?.tables ?? [])
                      // Not itself: a column pointing at its own table is a row
                      // that references a row that references a row, and the
                      // dropdown for it would have to load the page it is on.
                      .filter((item) => item.handle !== ownHandle)
                      .map((item) => (
                        <option key={item.handle} value={item.handle}>
                          {item.name}
                        </option>
                      ))}
                  </Select>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="t-caption t-tertiary uppercase">Qaysi ustun ko&apos;rsatiladi</span>
                  <Select
                    value={column.refColumn ?? ""}
                    disabled={disabled || !column.refTable}
                    onChange={(event) => patch(column.uid, { refColumn: event.target.value })}
                  >
                    <option value="">Tanlanmagan</option>
                    {(refs?.tables ?? [])
                      .find((item) => item.handle === column.refTable)
                      ?.columns.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                  </Select>
                </label>
              </div>
            )}

            {column.type === "formula" && (
              <label className="flex flex-col gap-1 md:pl-[30px]">
                <span className="t-caption t-tertiary uppercase">Formula</span>
                <Input
                  value={column.formula ?? ""}
                  disabled={disabled}
                  spellCheck={false}
                  maxLength={500}
                  placeholder="narx * soni"
                  aria-label={`${index + 1}-ustun formulasi`}
                  className="font-mono text-[13px] max-md:text-[15px]"
                  onChange={(event) => patch(column.uid, { formula: event.target.value })}
                />
                <span className="t-footnote t-tertiary">
                  Boshqa ustunlarni sarlavhasidan olingan nom bilan yozing — «Narxi» ustuni{" "}
                  <code className="font-mono">narxi</code> bo&apos;ladi. Bot kutubxonasidagi funksiyalar ham
                  ishlaydi, masalan <code className="font-mono">money(narxi * 1.2)</code>.
                </span>
              </label>
            )}

          </div>
        );
      })}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...columns, emptyColumn(columns)])}
        className="oq-press t-body flex min-h-[44px] cursor-pointer items-center gap-1.5 self-start px-1 text-accent-400 disabled:cursor-default disabled:opacity-40"
      >
        <Icon name="plus" size={16} /> Ustun qo&apos;shish
      </button>

      {error && (
        <p role="alert" className="t-footnote m-0 text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The name this column actually answers to, and a way to take it with you.
 *
 * The heading above it is free to change; this is not. It is derived from the
 * heading the first time the column is saved and then stays put, because every
 * stored row is filed under it and every flow expression and incoming webhook
 * already names it — a key that followed a corrected typo would empty the
 * column in every row already written and break the integrations at the same
 * time. That is the right decision, and it was also invisible: the reader
 * renamed «Nomi» to «FIO», read a help text saying the flow's name comes from
 * the heading, and found «Integratsiyalar» still printing `{{ qator.nomi }}`
 * with nothing to explain the difference. So the key stands beside the heading
 * that does not rename it, copyable, in the same shape «Integratsiyalar» uses.
 *
 * `fixed` is the difference between a column that has been saved and one being
 * typed now: only the second still follows the heading, and saying which is
 * which is the whole point of printing it here.
 */
function KeyChip({ columnKey, fixed }: { columnKey: string; fixed: boolean }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(columnKey);
      showToast("Kalit nusxalandi");
    } catch {
      // Refused outright — plain HTTP, or a permission already denied. It is on
      // screen and selectable, so saying so is the honest answer.
      showToast("Nusxalab bo'lmadi — matnni qo'lda belgilang", { tone: "danger" });
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 md:pl-[30px]">
      <span className="t-caption t-tertiary uppercase">Kalit</span>
      <button
        type="button"
        onClick={copy}
        disabled={!columnKey}
        aria-label={`«${columnKey || "—"}» kalitini nusxalash`}
        title={
          fixed
            ? "Oqim va webhook shu nomni ishlatadi — sarlavha o'zgarsa ham o'zgarmaydi"
            : "Sarlavhadan olinadi va birinchi saqlashdan keyin o'zgarmaydi"
        }
        className="oq-press flex min-h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] bg-neutral-800 px-2 font-mono text-[12px] text-neutral-300 disabled:cursor-default disabled:opacity-40 max-md:min-h-11 max-md:text-[13px]"
      >
        <span className="min-w-0 truncate">{columnKey || "—"}</span>
        <Icon name="copy" size={12} className="flex-none text-neutral-500" />
      </button>
    </div>
  );
}
