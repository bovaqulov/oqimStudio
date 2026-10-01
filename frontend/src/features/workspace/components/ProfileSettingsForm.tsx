"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import { setProfileNameAction } from "@/features/auth/actions";

/**
 * The reader's own name, and the address they signed in with.
 *
 * `ProfileSerializer` has always described `name` as "what someone may change
 * about themselves", and no screen offered it: the name on every avatar, in
 * the member list and in the page header was whatever was typed into the signup
 * form once — or, for an account made through Telegram, whatever Telegram
 * happened to be calling that person the day they first pressed Start.
 *
 * A client leaf and not a bare `action={…}` form, the same reasoning as
 * `WorkspaceSettingsForm` beside it: a rename that saved and said nothing left
 * the two letters in the sidebar avatar as the only evidence it had happened,
 * and none at all if the server had refused.
 *
 * The email is drawn and disabled rather than left off. A reader looking for
 * "which account am I in" looks here first, and a field that is not offered
 * with a reason beside it is a better answer than a field that is not there —
 * the (i) says why it cannot be changed and what to do instead.
 *
 * Unless there is no address. An account Telegram identified carries the
 * synthetic `tg<id>@telegram.local` the backend mints to have something in a
 * unique column, and this screen used to draw that in a field labelled "Email"
 * — a made-up address in the one place a reader goes to find out which account
 * they are in, and disabled, so it read as an address somebody had chosen for
 * them. The field says what the account actually is instead, and the (i) says
 * there is no address rather than that it cannot be edited.
 */
export function ProfileSettingsForm({
  user,
  labels,
}: {
  user: {
    name: string;
    email: string;
    /** Telegram established this identity, so `email` is plumbing. */
    viaTelegram?: boolean;
    /** Without the `@`. Empty for an account that never set one. */
    telegramUsername?: string;
  };
  labels: {
    name: string;
    email: string;
    emailInfo: string;
    telegramAccount: string;
    telegramAccountInfo: string;
    save: string;
  };
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(formData: FormData) {
    setError(null);
    setSaving(true);
    try {
      const result = await setProfileNameAction(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      showToast("Profil saqlandi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(196px,1fr))] gap-3">
        <Field label={labels.name} error={error ?? undefined}>
          <Input name="name" defaultValue={user.name} onChange={() => setError(null)} />
        </Field>
        {user.viaTelegram ? (
          <Field label={labels.telegramAccount} info={labels.telegramAccountInfo}>
            {/* The handle if Telegram gave one, and the word for the way in if
                it did not — never the synthetic address behind either. */}
            <Input
              value={user.telegramUsername ? `@${user.telegramUsername}` : "Telegram"}
              disabled
              readOnly
              className="disabled:opacity-60"
            />
          </Field>
        ) : (
          <Field label={labels.email} info={labels.emailInfo}>
            <Input value={user.email} disabled readOnly className="disabled:opacity-60" />
          </Field>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="oq-press min-h-[44px] cursor-pointer rounded-[12px] bg-accent-700 px-4 text-[15px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 md:min-h-[36px]"
        >
          {saving ? "Saqlanmoqda…" : labels.save}
        </button>
      </div>
    </form>
  );
}
