"use client";

import { Select } from "@/components/ui/Select";
import type { TableWriteConfig } from "@/features/flows";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { VariableInput } from "./VariableInput";

/**
 * Which table this block appends to, and what goes in each column.
 *
 * The columns are read off the chosen table rather than typed: an author who
 * has already said "Navbat" has already said which fields exist, and asking
 * them again is how a row ends up under a key nothing reads. A column the
 * author leaves blank is simply not written — an empty cell and "0" are
 * different answers, and only one of them is true.
 *
 * Values go through [[VariableInput]] like every other text field, so `@` opens
 * the variable picker and `{{ money(jami) }}` means here exactly what it means
 * in a message. That is the whole reason this block is worth having: the flow
 * already knows the customer's name and their answers, and this is where they
 * stop being a conversation and start being a list.
 */
export function TableWriteField({
  value,
  onChange,
}: {
  value: TableWriteConfig;
  onChange: (patch: { tableWrite: TableWriteConfig }) => void;
}) {
  const tables = useFlowEditorStore((state) => state.tables);
  const chosen = tables.find((table) => table.handle === value.handle);

  function pick(handle: string) {
    // The values are dropped with the table, not carried across: a column key
    // that happens to exist in both tables would otherwise arrive pre-filled
    // with a sentence written about something else.
    onChange({ tableWrite: { handle, values: {} } });
  }

  function setCell(key: string, cell: string) {
    const values = { ...value.values };
    if (cell.trim()) values[key] = cell;
    else delete values[key];
    onChange({ tableWrite: { ...value, values } });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <FieldLabel>Qaysi ma&apos;lumotga</FieldLabel>
        <Select value={value.handle} onChange={(event) => pick(event.target.value)}>
          <option value="">Tanlanmagan</option>
          {tables.map((table) => (
            <option key={table.id} value={table.handle}>
              {table.name}
            </option>
          ))}
        </Select>
        {tables.length === 0 && (
          <FieldHint>Bu ish maydonida hali ma&apos;lumot yo&apos;q — avval «Ma&apos;lumotlar» bo&apos;limida yarating.</FieldHint>
        )}
      </div>

      {chosen && chosen.columns.length > 0 && (
        <div className="flex flex-col gap-2">
          <FieldLabel>Nima yoziladi</FieldLabel>
          {chosen.columns.map((column) => (
            <div key={column.key} className="flex flex-col gap-1">
              <FieldHint>{column.label}</FieldHint>
              <VariableInput
                value={value.values[column.key] ?? ""}
                onChange={(cell) => setCell(column.key, cell)}
                placeholder={`{{${column.key}}}`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Only where the choice has been made and the table turned out empty —
          a table with no columns has nowhere to put anything, and saying so
          here beats a block that saves cleanly and writes blank rows. */}
      {chosen && chosen.columns.length === 0 && (
        <FieldHint>«{chosen.name}» ma&apos;lumotida ustun yo&apos;q — avval ustunlarni belgilang.</FieldHint>
      )}
    </div>
  );
}
