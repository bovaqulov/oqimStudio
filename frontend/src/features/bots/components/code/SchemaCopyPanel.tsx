"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import { buildSchemaPrompt } from "@/features/flows/schema-prompt";
import type { FlowSchema } from "@/features/flows/transfer-types";
import { countOf } from "@/lib/utils/format";

/**
 * The block vocabulary, as one thing to copy.
 *
 * This is the step people skip, and skipping it is why a graph written in
 * another model fails validation on the first try: asked for "a bot flow as
 * JSON" with no vocabulary, a model invents port names and field names that
 * read perfectly and match nothing. Handing it the real ones first is the
 * difference between an import that works and an afternoon of corrections.
 *
 * One button and not a page to assemble. The moment this is three things to
 * copy in the right order it becomes a thing people do not do.
 */
export function SchemaCopyPanel({ schema }: { schema: FlowSchema }) {
  const [shown, setShown] = useState(false);
  const prompt = useMemo(() => buildSchemaPrompt(schema), [schema]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("Lug'at nusxalandi — boshqa AI ga qo'ying");
    } catch {
      // Refused outright — over plain HTTP, or by a permission already denied.
      // Opening the text is the only way forward left, so it opens itself
      // rather than leaving the reader with a button that just does not work.
      setShown(true);
      showToast("Nusxalab bo'lmadi — matnni qo'lda belgilang", { tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button type="button" onClick={copy}>
          <Icon name="copy" size={16} /> Lug&apos;atni nusxalash
        </Button>
        <button
          type="button"
          onClick={() => setShown(!shown)}
          className="t-body min-h-[44px] cursor-pointer px-1 text-accent-400"
        >
          {shown ? "Yashirish" : "Matnni ko'rish"}
        </button>
        <span className="t-footnote t-tertiary">
          v{schema.version} · {countOf(schema.nodeTypes.length, "blok turi")}
        </span>
      </div>

      {/* Shown rather than only copied, for the reason the invite link is shown:
          text somebody can read before they paste it is text they can check. */}
      {shown && (
        <Textarea
          value={prompt}
          readOnly
          rows={12}
          spellCheck={false}
          aria-label="Bloklar lug'ati matni"
          className="font-mono text-[12.5px] leading-relaxed max-md:text-[15px]"
        />
      )}
    </div>
  );
}
