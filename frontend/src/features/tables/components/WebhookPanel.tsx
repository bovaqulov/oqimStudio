"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { rotateSecretAction } from "../actions";
import type { TableColumn } from "../types";

/**
 * The address another system posts a row to.
 *
 * The URL carries the secret, which is why there is no separate "token" field
 * to copy and no second thing to configure: whoever holds this address can add
 * rows to this table and nothing else in the workspace. That is also why
 * rotating it is destructive — it is the only way to revoke it, and everything
 * still posting to the old address stops at that moment.
 *
 * The example body is built from this table's own columns rather than from a
 * generic placeholder. The one mistake this integration invites is guessing the
 * field names, and the keys are right here.
 *
 * It is built from the columns that can be *written*, which is not all of them.
 * A computed column is worked out from the others every time the row is read
 * and is never stored, so `clean_row_data` drops whatever is posted into one —
 * the sample used to offer `"hisob": "…"` and was therefore inviting an
 * integration to send a field that would be discarded without a word. A sample
 * body has one job: to be a request that works, copied as it stands.
 */
/**
 * What one cell looks like in the sample, by the type of the column.
 *
 * A `select` shows one of its own choices rather than a placeholder, because
 * the backend refuses a value outside the list — a sample saying `"…"` there is
 * a body that answers 400 the first time somebody pastes it. A `ref` stays a
 * placeholder: what belongs in it is a row id out of another table, and no
 * example this panel could print would be a real one.
 */
function sampleFor(column: TableColumn): string | number | boolean {
  if (column.type === "number") return 150000;
  if (column.type === "bool") return true;
  if (column.type === "date") return "2026-03-12";
  if (column.type === "select") return column.options?.[0] ?? "…";
  return "…";
}

export function WebhookPanel({
  tableId,
  webhookUrl,
  columns,
  canEdit,
}: {
  tableId: string;
  webhookUrl: string;
  columns: TableColumn[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(false);

  const example = JSON.stringify(
    {
      data: Object.fromEntries(
        columns.filter((column) => column.type !== "formula").map((column) => [column.key, sampleFor(column)]),
      ),
    },
    null,
    2,
  );

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      // Clipboard access can be refused outright — over plain HTTP, or by a
      // permission already denied. The text is on screen and selectable either
      // way, so the honest answer is to say so.
      setShown(true);
      showToast("Nusxalab bo'lmadi — matnni qo'lda belgilang", { tone: "danger" });
    }
  }

  function rotate() {
    void (async () => {
      const ok = await confirmDestructive({
        title: "Yangi sir",
        message:
          "Havola butunlay almashadi. Eski manzilga yozayotgan hamma narsa shu zahoti to'xtaydi — " +
          "yangi havolani o'sha tizimlarga qo'lda qo'yish kerak bo'ladi.",
        confirmText: "Ha, yangilansin",
      });
      if (!ok) return;

      startTransition(async () => {
        const result = await rotateSecretAction({ tableId });
        if (result.error) {
          showToast(result.error, { tone: "danger" });
          return;
        }
        showToast("Yangi havola tayyor");
      });
    })();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="t-footnote t-secondary m-0 max-w-[52ch] leading-[18px]">
        Tashqi tizim shu manzilga <span className="font-mono">POST</span> yuborsa, ma&apos;lumotga yangi qator
        qo&apos;shiladi. Manzilning ichida sir bor — uni faqat ishonchli tizimga bering.
      </p>

      {webhookUrl ? (
        <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-800">
          <span className="min-w-0 flex-1 self-center truncate px-3.5 font-mono text-[13px] text-text">
            {webhookUrl}
          </span>
          <button
            type="button"
            onClick={() => copy(webhookUrl, "Havola nusxalandi")}
            aria-label="Havolani nusxalash"
            className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500 hover:text-neutral-100"
          >
            <Icon name="copy" size={16} />
          </button>
        </div>
      ) : (
        <p className="t-footnote t-tertiary m-0">Havola hali tayyor emas.</p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setShown(!shown)}
          className="t-body min-h-[44px] cursor-pointer px-1 text-accent-400"
        >
          {shown ? "Namunani yashirish" : "Yuboriladigan namuna"}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={rotate}
            disabled={pending}
            className="t-body min-h-[44px] cursor-pointer px-1 text-danger-fg disabled:opacity-40"
          >
            {pending ? "Yangilanmoqda…" : "Yangi sir"}
          </button>
        )}
      </div>

      {shown && (
        <div className="flex flex-col gap-2">
          <pre className="m-0 overflow-x-auto rounded-[12px] bg-neutral-800 p-3 font-mono text-[12.5px] leading-relaxed text-text max-md:text-[13px]">
            {example}
          </pre>
          <button
            type="button"
            onClick={() => copy(example, "Namuna nusxalandi")}
            className="oq-press t-body flex min-h-[44px] cursor-pointer items-center gap-1.5 self-start px-1 text-accent-400"
          >
            <Icon name="copy" size={16} /> Namunani nusxalash
          </button>
        </div>
      )}
    </div>
  );
}
