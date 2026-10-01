"use client";

import { Toggle } from "./Toggle";

/**
 * A labelled switch, as one row.
 *
 * The label says what the switch *is*; it never says what it is currently set
 * to — the knob does that, and a "Yoqilgan — bot javob qaytaradi" beside a
 * visibly-on switch is a sentence that can only ever agree with the thing next
 * to it.
 */
export function Switch({
  checked,
  label,
  onToggle,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
      <span className="t-body min-w-0 flex-1">{label}</span>
      <Toggle checked={checked} onToggle={onToggle} disabled={disabled} label={label} />
    </label>
  );
}
