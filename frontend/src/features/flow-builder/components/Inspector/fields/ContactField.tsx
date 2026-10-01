"use client";

import type { ContactConfig } from "@/features/flows";
import { FieldLabel } from "./FieldLabel";
import { VariableInput } from "./VariableInput";

const EMPTY: ContactConfig = { phoneNumber: "", firstName: "" };

/** `sendContact` — phone and first name are required by the Bot API; last name is optional. */
export function ContactField({
  value,
  onChange,
}: {
  value?: ContactConfig;
  onChange: (value: ContactConfig) => void;
}) {
  const contact = value ?? EMPTY;

  function commit(patch: Partial<ContactConfig>) {
    onChange({ ...contact, ...patch });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex flex-col gap-1">
        <FieldLabel>Telefon raqami</FieldLabel>
        <VariableInput
          value={contact.phoneNumber}
          onChange={(phoneNumber) => commit({ phoneNumber })}
          placeholder="+998 90 123 45 67"
        />
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Ism</FieldLabel>
        <VariableInput
          value={contact.firstName}
          onChange={(firstName) => commit({ firstName })}
          placeholder="Aziz"
        />
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>Familiya (ixtiyoriy)</FieldLabel>
        <VariableInput
          value={contact.lastName ?? ""}
          onChange={(lastName) => commit({ lastName })}
          placeholder="Karimov"
        />
      </label>
    </div>
  );
}
