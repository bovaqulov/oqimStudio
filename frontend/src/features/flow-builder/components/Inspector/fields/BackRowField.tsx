"use client";

import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { Input } from "@/components/ui/Input";
import type { FlowNode } from "@/features/flows";
import { BACK_ROW_LABEL, backRowReachesTelegram } from "../../../node-registry";
import { FieldHint } from "./FieldHint";

/**
 * The block's own way back — not one of the author's keys, which is why it
 * carries no kind and no value and leaves the card by its left edge. Absent
 * means no row; an empty string means the default wording.
 *
 * Its own component because it is reachable from two places that have nothing
 * else in common. Normally it sits inside the keyboard editor's gear, with the
 * rest of what a keyboard can be told. But an album has no keyboard editor at
 * all — `sendMediaGroup` takes no `reply_markup`, so the whole list is replaced
 * by a note saying so — and a block that arrived at "album" already carrying a
 * back row then had the row, the port and the branch off it, and nowhere in the
 * panel to turn any of the three off. Switching the block back to text to reach
 * the checkbox and then back to album is not a workflow; it is the shape of a
 * missing control.
 */
export function BackRowField({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch: (value: Partial<FlowNode>) => void;
}) {
  const on = node.back !== undefined;
  // Only worth saying when the row exists and will not be sent. Said on the
  // control itself and not only on the card, because this is the one screen
  // where the author can act on it.
  const unsent = on && !backRowReachesTelegram(node);

  return (
    <div className="flex flex-col gap-1.5">
      <CheckboxRow
        checked={on}
        label="Orqaga qatori"
        hint="Xabar ostida, tugmalardan keyin"
        onToggle={() => onPatch({ back: on ? undefined : "" })}
      />
      {on && (
        <Input
          value={typeof node.back === "string" ? node.back : ""}
          onChange={(event) => onPatch({ back: event.target.value })}
          placeholder={BACK_ROW_LABEL}
          aria-label="Orqaga qatorining nomi"
        />
      )}
      {unsent && (
        <FieldHint>
          Media albom ostiga Telegram klaviatura qo&apos;ymaydi, shuning uchun bu qator mijozga
          ko&apos;rinmaydi va <span className="text-neutral-300">back</span> chiqishi hech qachon
          yurmaydi. Bog&apos;lanish kanvasda qoladi — o&apos;chirishni o&apos;zingiz hal qilasiz.
        </FieldHint>
      )}
    </div>
  );
}
