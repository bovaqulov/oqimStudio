import { Input } from "@/components/ui/Input";
import { FieldLabel } from "./FieldLabel";

export function TitleField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  /**
   * The name this block would carry if nobody typed one. Offered rather than
   * written in: a generated name that quietly becomes a stored one is a name
   * nobody can tell they are allowed to change.
   */
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel>Blok nomi</FieldLabel>
      <Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
