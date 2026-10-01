"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { validateEmail } from "@/features/auth/validate";
import { inviteMemberAction } from "../actions";
import { ROLE_DEFINITIONS } from "../roles";

/**
 * Inviting one person by address.
 *
 * A client component for one reason: the answer. As a bare `action={…}` form
 * this was the browser's own validator — "Please include an '@' in the email
 * address", in English, in the middle of an Uzbek screen — and, past that, a
 * server action that returned silently on every refusal, so a rejected invite
 * and a sent one looked exactly alike.
 *
 * `validateEmail` is the same check the sign-in screens use, so an address is
 * judged by one rule in this product rather than by three.
 */
export function InviteMemberForm({ roleLegend }: { roleLegend: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    const invalid = validateEmail(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await inviteMemberAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      showToast(`${email.trim()} taklif qilindi`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={submit}
      // The browser's bubble is what `validateEmail` replaces; leaving both on
      // means whichever fires first wins, and it is never the Uzbek one.
      noValidate
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[168px] flex-1">
        <Field label="Ism">
          <Input name="name" placeholder="Ism familiya" />
        </Field>
      </div>
      <div className="min-w-[196px] flex-1">
        <Field label="Email" required error={error ?? undefined}>
          <Input
            name="email"
            type="email"
            placeholder="ism@kompaniya.uz"
            onChange={() => setError(null)}
          />
        </Field>
      </div>
      <div className="min-w-[148px]">
        <Field label="Rol" info={roleLegend}>
          <Select name="role" defaultValue="editor">
            {ROLE_DEFINITIONS.filter((definition) => definition.key !== "owner").map((definition) => (
              <option key={definition.key} value={definition.key}>
                {definition.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer rounded-md bg-accent-700 px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Yuborilmoqda…" : "Taklif yuborish"}
      </button>
    </form>
  );
}
