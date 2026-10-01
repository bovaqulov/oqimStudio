"use client";

import type { LocalizedText } from "@/features/flows/localized-text";
import { LocalizedLabel, useLocalizedText } from "./TextLanguage";
import { VariableTextarea } from "./VariableTextarea";

/**
 * A block's own text. `sample` is what an empty one offers to write for itself
 * — it doubles as the placeholder, so the field shows a real sentence whether
 * or not the offer is taken.
 *
 * One field however many languages the bot speaks: the switch in the label row
 * decides which of them is in the box.
 */
export function BodyField({
  label,
  value,
  onChange,
  markdown = false,
  sample,
}: {
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  markdown?: boolean;
  /** A working example, offered behind "Namuna bilan to'ldirish" while the field is empty. */
  sample?: string;
}) {
  const text = useLocalizedText(value, onChange);

  return (
    // A <div> rather than a <label>: the switcher's buttons sit in the label
    // row, and a label forwards clicks meant for them to the textarea.
    <div className="flex flex-col gap-1">
      <LocalizedLabel label={label} value={value} />
      <VariableTextarea
        rows={3}
        value={text.value}
        onChange={text.onChange}
        markdown={markdown}
        // An empty translation shows what goes out in its place, so leaving one
        // blank reads as a decision rather than as a hole in the flow.
        placeholder={text.fallback || sample}
        // The worked example is written in the bot's own language; offering it
        // as somebody's Russian would be offering to translate for them, badly.
        sample={text.isMain ? sample : undefined}
      />
    </div>
  );
}
