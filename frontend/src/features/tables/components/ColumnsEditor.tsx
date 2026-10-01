"use client";

import { useState, useTransition } from "react";
import { showToast } from "@/components/ui/toast-store";
import { MainButton } from "@/lib/telegram/MainButton";
import { saveColumnsAction } from "../actions";
import { duplicateKey, handleError } from "../handle";
import type { RefOptions, TableColumn } from "../types";
import { ColumnFields, toColumns, toDrafts, type DraftColumn } from "./ColumnFields";

/**
 * What the table is made of, changed after the fact.
 *
 * Saved on its own button rather than as the reader types. A column key is the
 * name a flow expression and an incoming webhook both use, so a half-typed one
 * saved on keystroke would break a live integration for as long as it took to
 * finish the word — and the Save button is also where the sentence about that
 * belongs.
 *
 * The button only appears once something has changed, which is the same thing
 * as saying nothing here writes until asked.
 *
 * **The state of the list is written above it, and that is not decoration.**
 * A save here changes nothing on screen — the columns after it look exactly
 * like the columns before it — so the only evidence it worked was a two-second
 * toast, and a reader who blinked had no way left to ask. That is what hid the
 * dropped `options` for as long as it did: the save was reported as doing
 * nothing, which was true, and nothing on the screen could tell that apart from
 * a save that worked. «Saqlanmagan o'zgarish» while there is something to
 * write, «Hozir saqlangan» once there is not — the same pair the bot's code
 * screen carries, for the same reason.
 */
export function ColumnsEditor({
  tableId,
  columns,
  refs,
  ownHandle,
  canEdit,
}: {
  tableId: string;
  columns: TableColumn[];
  /** This table's own handle — a column may not point at the table it is on. */
  ownHandle?: string;
  /** What a `ref` column may point at — the other tables in this workspace. */
  refs?: RefOptions;
  canEdit: boolean;
}) {
  const [drafts, setDrafts] = useState<DraftColumn[]>(() => toDrafts(columns));
  const [error, setError] = useState<string | null>(null);
  /** Whether this session has written the list down. Reset the moment it is edited again. */
  const [stored, setStored] = useState(false);
  const [pending, startTransition] = useTransition();

  const saved = JSON.stringify(columns);
  const changed = JSON.stringify(toColumns(drafts)) !== saved;
  const removed = columns.filter((column) => !drafts.some((draft) => draft.savedKey === column.key));

  function save() {
    if (pending) return;
    setError(null);

    // The key is derived from the heading and never shown, so these two are a
    // net under `keyForLabel` rather than something a reader can act on — and
    // both therefore speak about the heading, which is the only thing on screen
    // they could change.
    for (const draft of drafts) {
      if (handleError(draft.key, "Ustun kaliti")) {
        setError(`«${draft.label || "Nomsiz"}» sarlavhasidan nom hosil qilib bo'lmadi — boshqacha yozing.`);
        return;
      }
    }
    const repeated = duplicateKey(drafts.map((draft) => draft.key));
    if (repeated) {
      setError("Ikkita ustun bir xil nomga tushdi — sarlavhalarni farqlang.");
      return;
    }
    if (drafts.length === 0) {
      setError("Kamida bitta ustun kerak — ma'lumot nimadan iboratligini ustunlar aytadi.");
      return;
    }

    startTransition(async () => {
      const result = await saveColumnsAction({ tableId, columns: toColumns(drafts) });
      if (result.error) {
        setError(result.error);
        return;
      }
      // The action revalidates this route, so the props come back as the new
      // truth and `savedKey` is re-read from them on the next mount.
      setDrafts(toDrafts(toColumns(drafts)));
      setStored(true);
      showToast("Ustunlar saqlandi");
    });
  }

  /** Every edit is a change nobody has written down yet, whatever the last save said. */
  function edit(next: DraftColumn[]) {
    setStored(false);
    setDrafts(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="t-footnote t-secondary m-0">Ustunlar</h2>
        {changed ? (
          <span className="t-footnote text-warning-fg">Saqlanmagan o&apos;zgarish</span>
        ) : stored ? (
          <span className="t-footnote t-tertiary">Hozir saqlangan</span>
        ) : null}
      </div>

      <ColumnFields
        columns={drafts}
        onChange={edit}
        refs={refs}
        ownHandle={ownHandle}
        disabled={!canEdit || pending}
        error={error}
      />

      {/* Said once, above the button, and only when it is actually about to
          happen: a removed column takes its heading and nothing else — the
          values stay in the rows, invisible, until the column comes back. */}
      {removed.length > 0 && (
        <p className="t-footnote t-tertiary m-0 leading-[18px]">
          O&apos;chirilgan ustun ({removed.map((column) => column.label || column.key).join(", ")}) qatorlardan
          yo&apos;qoladi, lekin qiymatlar saqlanib qoladi — ustun qaytarilsa yana ko&apos;rinadi.
        </p>
      )}

      {canEdit && (
        <MainButton
          inline
          visible={changed}
          text={pending ? "Saqlanmoqda…" : "Saqlash"}
          loading={pending}
          onClick={save}
        />
      )}
    </div>
  );
}
