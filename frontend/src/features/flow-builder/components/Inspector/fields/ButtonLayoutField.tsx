"use client";

import { SegmentedTabs, type SegmentedOption } from "@/components/ui/SegmentedTabs";
import type { FlowButton } from "@/features/flows";
import { toButtonRows } from "../../../lib/buttons";
import { FieldLabel } from "./FieldLabel";

/** The widths the picker offers. Telegram takes up to 8, but past three the labels stop being readable on a phone. */
const WIDTHS = ["1", "2", "3"] as const;

/**
 * How many buttons share a keyboard row — the whole-keyboard reading of the
 * per-button `sameRow` flags. Picking a width rewrites the flags so every row
 * carries that many (the last row keeps the remainder), which is what the
 * author drawing "2 ta ustun" actually means.
 *
 * The flags can also say something no single width does — two side by side,
 * then one alone, by drag or by an older save. That state is shown as its own
 * inert segment rather than silently highlighting the nearest width: a control
 * that reports a value it would not reproduce teaches the reader it is broken.
 */
export function ButtonLayoutField({
  buttons,
  onChange,
}: {
  buttons: FlowButton[];
  onChange: (buttons: FlowButton[]) => void;
}) {
  const rows = toButtonRows(buttons);
  const widest = Math.max(1, ...rows.map((row) => row.length));
  // One width describes the keyboard when every row is full at it — except the
  // last, which holds whatever remained.
  const uniform = rows.every((row, index) => index === rows.length - 1 || row.length === widest);
  const value = uniform && widest <= WIDTHS.length ? String(widest) : "mixed";

  function apply(width: number) {
    onChange(
      buttons.map((button, index) => {
        const next = { ...button };
        if (index % width === 0) delete next.sameRow;
        else next.sameRow = true;
        return next;
      }),
    );
  }

  const options: SegmentedOption<string>[] = WIDTHS.map((width) => ({
    value: width,
    label: width,
    title: `Bir qatorda ${width} ta tugma`,
  }));
  if (value === "mixed") {
    options.push({
      value: "mixed",
      label: "Aralash",
      disabled: true,
      title: "Qatorlar har xil kenglikda — tanlov ularni bir xil qilib qayta teradi.",
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Bir qatorda</FieldLabel>
      <SegmentedTabs
        options={options}
        value={value}
        onChange={(next) => {
          if (next !== "mixed") apply(Number(next));
        }}
      />
    </div>
  );
}
