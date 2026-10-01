"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { importRowsAction } from "../actions";

/**
 * The two directions a price list travels: out to Excel, and back in.
 *
 * This sits on the rows screen rather than with the webhook, because it is the
 * same job as "Qator qo'shish" done a hundred at a time — the person reaching
 * for it is the person maintaining the prices, not the one wiring an
 * integration. The webhook is for a system; this is for a spreadsheet somebody
 * already keeps.
 *
 * Export is a link and not a button. A `download` link is handled by the
 * browser itself, which means it survives the page navigating away mid-download
 * and needs no transition, no spinner and no state — and `/api/tables/<id>/export`
 * is a route of ours precisely so the credential can stay in its httpOnly
 * cookie.
 *
 * Import is deliberately not a drop zone. A file lands here once a month; a
 * drop target that spans the grid is a surface that eats a drag somebody meant
 * for a cell.
 *
 * «Excelga» and «Exceldan» rather than «Yuklab olish» and «Yuklash». The two
 * verbs are the honest translation and they are one letter apart in a strip
 * where they stand side by side — the direction is the whole distinction, and
 * the case ending carries it where a verb for "load" cannot.
 */
export function ExcelTransfer({ tableId, canEdit }: { tableId: string; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startImport] = useTransition();
  /**
   * The refusal, kept on screen rather than shown as a toast.
   *
   * A rejected import says which line was wrong and why — "3-qator: «Narx»
   * ustuniga son kiritilishi kerak" — and that is a sentence somebody reads
   * with their spreadsheet open beside them. A toast takes it away after four
   * seconds, which is the one thing it must not do.
   */
  const [problem, setProblem] = useState("");

  function choose(file: File | undefined) {
    if (!file) return;
    setProblem("");
    startImport(async () => {
      const data = new FormData();
      data.set("tableId", tableId);
      data.set("file", file);
      const result = await importRowsAction(data);
      if (result.error) {
        setProblem(result.error);
        return;
      }
      showToast(`${result.added} ta qator qo'shildi`);
    });
    // Cleared so the same file can be chosen twice. Without this, a reader who
    // fixes their spreadsheet and picks it again gets no `change` event at all
    // and nothing happens — the worst kind of "nothing", because the file name
    // in the dialog says it was selected.
    if (input.current) input.current.value = "";
  }

  return (
    <>
      <a
        href={`/api/tables/${tableId}/export`}
        className="oq-press t-body flex min-h-[44px] flex-none items-center gap-1.5 px-1 text-accent-400"
      >
        <Icon name="download-simple" size={16} /> Excelga
      </a>

      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            hidden
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => input.current?.click()}
            className="oq-press t-body flex min-h-[44px] flex-none cursor-pointer items-center gap-1.5 px-1 text-accent-400 disabled:opacity-50"
          >
            <Icon name="upload-simple" size={16} />
            {pending ? "Yuklanmoqda…" : "Exceldan"}
          </button>
        </>
      )}

      {problem && (
        <p
          role="alert"
          className="t-footnote order-last w-full basis-full px-1 text-danger-fg"
        >
          {problem}
        </p>
      )}
    </>
  );
}
