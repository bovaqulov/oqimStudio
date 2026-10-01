import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { ButtonMode } from "@/features/flows";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * Inline vs reply keyboard. Most of the time the block has already decided this
 * for itself — a URL or copy button cannot ride a reply keyboard — so `lock`
 * picks the type and the impossible segment goes inert with the reason under it.
 * The picker only becomes a real choice when both keyboards would work.
 */
export function ButtonModeField({
  value,
  lock,
  onChange,
}: {
  value: ButtonMode;
  lock?: { mode: ButtonMode; reason: string } | null;
  onChange: (value: ButtonMode) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Tugmalar turi{lock && " · avtomatik"}</FieldLabel>
      <SegmentedTabs
        options={[
          { value: "inline", label: "Inline", disabled: !!lock && lock.mode !== "inline", title: lock?.reason },
          { value: "reply", label: "Reply", disabled: !!lock && lock.mode !== "reply", title: lock?.reason },
        ]}
        value={lock?.mode ?? value}
        onChange={(next) => {
          if (!lock) onChange(next);
        }}
      />
      {lock && <FieldHint>{lock.reason}</FieldHint>}
    </div>
  );
}
