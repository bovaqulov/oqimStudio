"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { updateWorkspaceAction } from "../actions";

/**
 * The tenant's own two fields, and an answer when they are saved.
 *
 * A client leaf for one reason, the same one as `InviteMemberForm`: as a bare
 * `action={…}` form this saved and said nothing. The only evidence a rename had
 * been taken was the two letters in the sidebar avatar changing — and if the
 * server had refused, not even that. A save that produces no sentence is
 * indistinguishable from a save that did not happen.
 */
export function WorkspaceSettingsForm({
  workspace,
  timezones,
  locales,
  canManage,
  labels,
}: {
  workspace: { name: string; timezone: string; locale: string };
  timezones: readonly string[];
  locales: readonly { value: string; label: string }[];
  canManage: boolean;
  labels: { name: string; timezone: string; reportLocale: string; reportLocaleInfo: string; save: string };
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setSaving(true);
    try {
      const result = await updateWorkspaceAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      showToast("Ish maydoni saqlandi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(196px,1fr))] gap-3">
        <Field label={labels.name} error={error ?? undefined}>
          <Input
            name="name"
            defaultValue={workspace.name}
            disabled={!canManage}
            onChange={() => setError(null)}
          />
        </Field>
        <Field label={labels.timezone}>
          <Select name="timezone" defaultValue={workspace.timezone} disabled={!canManage}>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>
        {/*
          The tenant's, not the reader's — which is the whole reason it needs
          an (i) beside a screen that also offers "Interfeys tili". This one
          decides how the numbers and dates on a *shared* report are written;
          that one decides which words the person in front of the screen sees.
          It had been settable at sign-up and nowhere afterwards, so a workspace
          created in a hurry read its analytics in the wrong language for ever.
        */}
        <Field label={labels.reportLocale} info={labels.reportLocaleInfo}>
          <Select name="locale" defaultValue={workspace.locale} disabled={!canManage}>
            {locales.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {/* A manager's button. It was drawn for everybody while the language
          field sat in this form — that field was the reader's own, so a form
          nobody could submit was a setting nobody could change. The language
          applies on change now and has left the form, so everything still
          inside it is the tenant's. */}
      {canManage && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="oq-press min-h-[44px] cursor-pointer rounded-[12px] bg-accent-700 px-4 text-[15px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 md:min-h-[36px]"
          >
            {saving ? "Saqlanmoqda…" : labels.save}
          </button>
        </div>
      )}
    </form>
  );
}
