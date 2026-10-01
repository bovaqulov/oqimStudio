"use client";

import { Select } from "@/components/ui/Select";
import type { TableReadConfig } from "@/features/flows";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { VariableInput } from "./VariableInput";

/**
 * Which row to look for, and what to call it once it is found.
 *
 * Three questions in the order somebody asks them: which data, which row, and
 * what do I call it afterwards. The third one has an answer already filled in
 * (`qator`), because a block that works the moment a table is picked is worth
 * more than one that waits to be told a name nobody has an opinion about.
 *
 * Leaving the column unset is a real answer and not an unfinished form — it
 * means "the newest row", which is what a flow wants immediately after writing
 * one. The hint says so rather than the field pretending to be required.
 */
export function TableReadField({
  value,
  onChange,
}: {
  value: TableReadConfig;
  onChange: (patch: { tableRead: TableReadConfig }) => void;
}) {
  const tables = useFlowEditorStore((state) => state.tables);
  const chosen = tables.find((table) => table.handle === value.handle);

  const set = (patch: Partial<TableReadConfig>) => onChange({ tableRead: { ...value, ...patch } });

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <FieldLabel>Qaysi ma&apos;lumotdan</FieldLabel>
        <Select
          value={value.handle}
          // The column belongs to the table, so it goes with it: a key left
          // over from the previous choice would be a filter on a column that
          // does not exist, and the block would take the "not found" branch
          // for ever without saying why.
          onChange={(event) => set({ handle: event.target.value, column: "" })}
        >
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

      {chosen && (
        <>
          <div className="flex flex-col gap-1">
            <FieldLabel>Qaysi ustun bo&apos;yicha</FieldLabel>
            <Select value={value.column} onChange={(event) => set({ column: event.target.value })}>
              <option value="">Oxirgi qator</option>
              {chosen.columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </Select>
            <FieldHint>
              Ustun tanlanmasa — eng oxirgi yozilgan qator o&apos;qiladi.
            </FieldHint>
          </div>

          {value.column && (
            <div className="flex flex-col gap-1">
              <FieldLabel>Nima bilan solishtiriladi</FieldLabel>
              <VariableInput
                value={value.value}
                onChange={(next) => set({ value: next })}
                placeholder="{{message.text}}"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <FieldLabel>Topilgan qator nomi</FieldLabel>
            <VariableInput value={value.into} onChange={(into) => set({ into })} placeholder="qator" />
            <FieldHint>
              Ustunlar «{value.into || "qator"}.ustun» ko&apos;rinishida o&apos;qiladi — masalan{" "}
              {`{{${value.into || "qator"}.${chosen.columns[0]?.key ?? "narx"}}}`}
            </FieldHint>
          </div>
        </>
      )}
    </div>
  );
}
