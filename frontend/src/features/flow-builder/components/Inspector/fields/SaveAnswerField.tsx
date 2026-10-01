"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { ANSWER_SLOTS, toVariableLabel, toVariableName } from "../../../lib/variables";
import { FieldGroup } from "./FieldGroup";
import { FieldHint } from "./FieldHint";
import { RevealPanel } from "./RevealPanel";

/**
 * Where an answer is kept, asked as a question about the answer rather than
 * about the store.
 *
 * "O'zgaruvchiga saqlash: variable_name" asked the author to invent an
 * identifier — lowercase, no spaces, underscores between words — before they
 * could get on with the flow, and every one they invented was one of the same
 * four things. So the four are chips, and the name behind a chip is derived.
 * "Boshqa" keeps the escape hatch open without reopening the identifier: it
 * takes a label in the author's own words and slugifies it for them, with the
 * result shown underneath so nothing about the stored name is a surprise.
 */
export function SaveAnswerField({
  value,
  onChange,
  legend = "Javobni nima deb saqlaymiz?",
}: {
  /** The stored variable name, e.g. `mijoz_ismi`. */
  value: string;
  onChange: (name: string) => void;
  legend?: string;
}) {
  const matched = ANSWER_SLOTS.find((slot) => slot.key === value);
  const custom = !!value && !matched;
  /**
   * The label behind a custom name, seeded from the name once. Seeded rather
   * than derived on every render because the two are not the same string —
   * re-deriving would fight the author for the caret as they type.
   */
  const [label, setLabel] = useState(() => (custom ? toVariableLabel(value) : ""));
  const [otherOpen, setOtherOpen] = useState(custom);

  function pick(key: string) {
    setOtherOpen(false);
    onChange(key);
  }

  function openOther() {
    setOtherOpen(true);
    onChange(toVariableName(label));
  }

  const derived = toVariableName(label);

  return (
    <div className="flex flex-col gap-1">
      <FieldGroup legend={legend} single>
        {ANSWER_SLOTS.map((slot) => (
          <ToggleChip
            key={slot.key}
            select="single"
            check
            active={slot.key === value && !otherOpen}
            onClick={() => pick(slot.key)}
          >
            {slot.label}
          </ToggleChip>
        ))}
        <ToggleChip select="single" check active={otherOpen} onClick={openOther}>
          Boshqa
        </ToggleChip>
      </FieldGroup>

      {otherOpen && (
        <RevealPanel>
          <Input
            value={label}
            placeholder="Kompaniya nomi"
            onChange={(event) => {
              setLabel(event.target.value);
              onChange(toVariableName(event.target.value));
            }}
          />
          <FieldHint>
            {derived ? (
              <>
                Keyin matnlarda <span className="text-neutral-300">{`{{${derived}}}`}</span> deb ishlatiladi — yozish
                shart emas, matn maydonida <span className="text-neutral-300">@</span> bosing.
              </>
            ) : (
              "Javobni nima deb atashni yozing — qolganini o'zimiz hal qilamiz."
            )}
          </FieldHint>
        </RevealPanel>
      )}
    </div>
  );
}
