"use client";

import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";

/**
 * The key a flow addresses this table by.
 *
 * It was the page's subtitle — a database identifier printed in grey under the
 * name on every screen, for readers who are mostly shop owners and mostly never
 * write an expression. Here it is answering a question somebody actually came
 * with, next to the two spellings they need it in.
 *
 * Read-only, and deliberately so. `TableSettingsForm` says why at length: the
 * key is derived from the name when the table is made, and nothing in the
 * product would rewrite it inside an author's message text — so a rename would
 * leave `{{ table("narxlar") }}` naming something that no longer exists,
 * rendering nothing, silently.
 */
export function HandlePanel({ handle, firstColumn }: { handle: string; firstColumn: string }) {
  const read = `{{ table("${handle}") }}`;
  const cell = `{{ qator.${firstColumn} }}`;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      // Refused outright — plain HTTP, or a permission already denied. The
      // text is on screen and selectable, so saying so is the honest answer.
      showToast("Nusxalab bo'lmadi — matnni qo'lda belgilang", { tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="t-footnote t-secondary m-0 max-w-[52ch] leading-[18px]">
        Oqim ichidagi ifodalar ma&apos;lumotni shu kalit bilan chaqiradi. Kalit ma&apos;lumot yaratilganda
        nomdan olinadi va o&apos;zgarmaydi — o&apos;zgarsa, uni ishlatayotgan xabarlar jimgina bo&apos;shab
        qolardi.
      </p>

      <div className="flex items-stretch overflow-hidden rounded-[12px] bg-neutral-800">
        <span className="min-w-0 flex-1 self-center truncate px-3.5 font-mono text-[13px] text-text">
          {handle}
        </span>
        <button
          type="button"
          onClick={() => copy(handle, "Kalit nusxalandi")}
          aria-label="Kalitni nusxalash"
          className="flex min-h-[44px] w-11 flex-none cursor-pointer items-center justify-center text-neutral-500 hover:text-neutral-100"
        >
          <Icon name="copy" size={16} />
        </button>
      </div>

      {/* The two places the key is typed, spelled out. The second one is the
          mistake this panel exists to prevent: a reader who has the handle
          still has to guess how a single cell is reached, and guessing wrong
          produces an empty string rather than an error. */}
      <dl className="m-0 flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <dt className="t-footnote t-tertiary">Butun ma&apos;lumotni o&apos;qish</dt>
          <dd className="m-0">
            <button
              type="button"
              onClick={() => copy(read, "Ifoda nusxalandi")}
              className="oq-press w-full cursor-pointer rounded-[10px] bg-neutral-800 px-3.5 py-2.5 text-left font-mono text-[13px] text-text"
            >
              {read}
            </button>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="t-footnote t-tertiary">Qator ichidagi bitta katak</dt>
          <dd className="m-0">
            <button
              type="button"
              onClick={() => copy(cell, "Ifoda nusxalandi")}
              className="oq-press w-full cursor-pointer rounded-[10px] bg-neutral-800 px-3.5 py-2.5 text-left font-mono text-[13px] text-text"
            >
              {cell}
            </button>
          </dd>
        </div>
      </dl>
    </div>
  );
}
