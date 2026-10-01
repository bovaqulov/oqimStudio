"use client";

import { Input } from "@/components/ui/Input";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { TagAction } from "@/features/flows";
import { TAG_ACTION_OPTIONS } from "../../../lib/tag";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { SampleFill } from "./SampleFill";
import { SaveAnswerField } from "./SaveAnswerField";
import { VariableInput } from "./VariableInput";

/** What a freshly-filled "save the answer" block does: keep what the customer just typed. */
const LAST_ANSWER = "{{message.text}}";

/**
 * Adding a tag, removing one, or keeping an answer.
 *
 * The third is the one people reach for and the one that used to read worst:
 * two bare text boxes, the first of which wanted a snake_case identifier
 * nobody had been told about. It is now the same question the flow is asking —
 * what is this answer called — with the identifier derived (see
 * [[SaveAnswerField]]), and a value field that opens the variable picker on
 * `@` instead of expecting `{{message.text}}` from memory.
 */
export function TagActionField({
  action,
  name,
  value,
  onChange,
}: {
  action: TagAction;
  name: string;
  value: string;
  onChange: (patch: { tagAction?: TagAction; tagName?: string; tagValue?: string }) => void;
}) {
  const saving = action === "set_variable";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <FieldLabel>Amal</FieldLabel>
        <SegmentedTabs options={TAG_ACTION_OPTIONS} value={action} onChange={(tagAction) => onChange({ tagAction })} />
      </div>

      {saving ? (
        <>
          <SaveAnswerField value={name} onChange={(tagName) => onChange({ tagName })} />
          <div className="flex flex-col gap-1">
            <FieldLabel>Nima saqlanadi?</FieldLabel>
            <VariableInput
              value={value}
              placeholder={LAST_ANSWER}
              sample={LAST_ANSWER}
              onChange={(tagValue) => onChange({ tagValue })}
            />
            <FieldHint>
              Odatda mijozning oxirgi javobi. Boshqa qiymat kerak bo&apos;lsa{" "}
              <span className="text-neutral-300">@</span> bosing va ro&apos;yxatdan tanlang.
            </FieldHint>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <FieldLabel>Teg nomi</FieldLabel>
          <Input
            value={name}
            onChange={(event) => onChange({ tagName: event.target.value })}
            placeholder="qiziqqan-mijoz"
          />
          {!name.trim() && <SampleFill onFill={() => onChange({ tagName: "qiziqqan-mijoz" })} />}
        </div>
      )}
    </div>
  );
}
