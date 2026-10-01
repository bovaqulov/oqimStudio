import type { ReactNode } from "react";
import { Input } from "@/components/ui/Input";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * A number of minutes. Two blocks ask for one and they mean opposite things —
 * Kutish holds the flow still for that long, the eslatma lets it walk on and
 * counts down in the background — so the wording travels with the block rather
 * than being frozen here.
 */
export function DelayField({
  minutes,
  label = "Kutish (daqiqa)",
  onChange,
}: {
  minutes: number;
  label?: string;
  onChange: (minutes: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <Input type="number" min={0} value={minutes} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
