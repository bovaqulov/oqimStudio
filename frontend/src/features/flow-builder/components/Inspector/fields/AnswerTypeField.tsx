"use client";

import type { AnswerType } from "@/features/flows";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { FieldGroup } from "./FieldGroup";
import { FieldHint } from "./FieldHint";

/**
 * What kind of answer the question is asking for.
 *
 * Not a formatting preference: the runtime checks the reply against this and
 * re-asks when it does not fit (`apps/engine/validation.py`), so picking
 * «Telefon» is what stops "salom men raqam emasman" becoming somebody's phone
 * number and the clinic calling it. What is stored is normalised too — three
 * ways of typing the same number are the same number — so a flow reading
 * `{{mijoz_telefoni}}` gets one shape however it was typed.
 *
 * The two share-button types Telegram has (`contact`, `location`) are
 * deliberately absent. They are answered by a reply-keyboard row rather than by
 * typing, so offering them here would promise a button this block does not
 * draw — the same mismatch that already puts «Telefon so'rash» on an inline
 * keyboard that cannot carry it.
 */
const ANSWER_TYPES: { value: AnswerType; label: string; hint: string }[] = [
  { value: "text", label: "Matn", hint: "Har qanday javob qabul qilinadi." },
  { value: "phone", label: "Telefon", hint: "Masalan: +998 90 123 45 67 — bitta ko'rinishga keltiriladi." },
  { value: "email", label: "Email", hint: "Masalan: ism@pochta.uz" },
  { value: "number", label: "Raqam", hint: "Faqat son. Masalan: 3" },
  { value: "date", label: "Sana", hint: "Masalan: 25.08.2026. O'tib ketgan sana qabul qilinmaydi." },
];

export function AnswerTypeField({
  value,
  onChange,
}: {
  value: AnswerType | undefined;
  onChange: (value: AnswerType) => void;
}) {
  const active = value ?? "text";
  const hint = ANSWER_TYPES.find((option) => option.value === active)?.hint;

  return (
    <div className="flex flex-col gap-1">
      <FieldGroup legend="Qanday javob kutilyapti?" single>
        {ANSWER_TYPES.map((option) => (
          <ToggleChip
            key={option.value}
            select="single"
            check
            active={option.value === active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </ToggleChip>
        ))}
      </FieldGroup>
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}
