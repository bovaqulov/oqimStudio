"use client";

import { useTransition } from "react";
import { showToast } from "@/components/ui/toast-store";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import { countOf } from "@/lib/utils/format";
import { deleteTableAction } from "../actions";

/**
 * Deleting a table, asked about by name and by how much goes with it.
 *
 * The row count is in the question because it is the part nobody expects: the
 * rows cascade, and "Narxlar o'chiriladi" reads as losing a heading while
 * "142 ta qator ham o'chadi" reads as losing the afternoon somebody spent
 * typing them.
 *
 * No form. The confirmation is asynchronous — inside Telegram it is the
 * client's own popup — and a form inside a row that re-renders when the list
 * revalidates may not exist by the time the answer comes back. The action is
 * called with the id this component was given, which needs nothing in the
 * document to still be there.
 */
export function DeleteTableButton({
  tableId,
  name,
  rowCount,
}: {
  tableId: string;
  name: string;
  rowCount: number;
}) {
  const [pending, startTransition] = useTransition();

  function remove() {
    void (async () => {
      const ok = await confirmDestructive({
        title: name,
        message:
          `«${name}» ma'lumoti va undagi ${countOf(rowCount, "qator")} butunlay o'chiriladi. ` +
          "Buni orqaga qaytarib bo'lmaydi, va bu ma'lumotdan o'qiydigan oqimlar javobsiz qoladi.",
        confirmText: "Ha, o'chirilsin",
      });
      if (!ok) return;

      hapticResult("warning");
      startTransition(async () => {
        // A success redirects to the list from the server, so nothing after
        // this line runs in that case; only a refusal comes back as a value.
        const result = await deleteTableAction({ tableId });
        if (result?.error) showToast(result.error, { tone: "danger" });
      });
    })();
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={remove}
      className="oq-row cursor-pointer disabled:cursor-default disabled:opacity-40"
    >
      <span className="t-body min-w-0 flex-1 truncate text-left text-danger-fg">
        {pending ? "O'chirilmoqda…" : "Ma'lumotni o'chirish"}
      </span>
    </button>
  );
}
