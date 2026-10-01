"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/Select";
import { setInterfaceLocaleAction } from "@/features/auth/actions";
import { LOCALE_OPTIONS } from "@/lib/i18n/locales";

/**
 * The interface language, applied the moment it is picked — the same reasoning
 * as `MemberRoleSelect` next door: the select *is* the action.
 *
 * It used to be a field in the workspace form, saved by that form's "Saqlash".
 * Two states looked identical from the reader's side and neither said which one
 * they were in: a language chosen and not saved, and a language saved and
 * ignored. An uncontrolled `<select>` keeps whatever was picked, so the control
 * sat on "O'zbekcha" while every word around it stayed Russian, and the only way
 * to find out which had happened was to reload the page.
 *
 * So the button is gone from this one field. Reading the interface is not a
 * change anybody confirms, and the one setting on this screen that belongs to
 * the person rather than to the tenant has no business waiting on the tenant's
 * save.
 *
 * The value shown is the server's, with the pick held locally only while the
 * write is in flight. When it lands, the layout revalidation brings the page
 * back in the new language and this comes back holding it; when it fails, the
 * local hold clears and the select snaps back to the language actually in
 * effect, rather than displaying one nobody is reading.
 */
export function InterfaceLocaleSelect({ value }: { value: string }) {
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState<string | null>(null);

  return (
    <Select
      // No `name`: nothing here is posted with the form around it.
      aria-label="Interfeys tili"
      value={inFlight ?? value}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        if (next === value) return;
        setInFlight(next);
        startTransition(async () => {
          try {
            await setInterfaceLocaleAction(next);
          } finally {
            setInFlight(null);
          }
        });
      }}
      className="disabled:opacity-60"
    >
      {LOCALE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
