"use client";

import { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import { EditSheet } from "@/features/bots/components/settings/EditSheet";
import { updateProjectAction } from "../actions";

/**
 * Renaming a project, from the row that used to only acknowledge the click.
 *
 * What was here was a `ToastButton` whose whole behaviour was a toast reading
 * "sozlamalar" — so a project created with a typo in its name could not be
 * corrected from the panel at all, and in the light theme, where the toast was
 * white on white, the row looked simply dead.
 *
 * The sheet is the one every other single-setting edit opens, so the shape of
 * "change one thing and confirm" is learned once. The save is not optimistic: a
 * name is what the breadcrumb, the sidebar and every card carry, and showing
 * the new one before the server has taken it would have four places agreeing on
 * something that might still be refused.
 */
export function EditProjectButton({
  project,
}: {
  project: { id: string; name: string; description: string };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openSheet() {
    // Reopened after a cancel, the fields should say what the project says —
    // not what the reader half-typed the last time and thought better of.
    setName(project.name);
    setDescription(project.description);
    setError(null);
    setOpen(true);
  }

  // `false` keeps the sheet open: a refusal has to be readable beside the field
  // it is about, and the reader's typing has to survive it.
  async function save(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const data = new FormData();
      data.set("projectId", project.id);
      data.set("name", name);
      data.set("description", description);
      const result = await updateProjectAction(data);
      if (result?.error) {
        setError(result.error);
        return false;
      }
      // The action's `revalidatePath` reaches this screen on its own — a server
      // action called from a client component refreshes the route it was called
      // from — so there is nothing to re-fetch here.
      showToast("Loyiha saqlandi");
      return true;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openSheet} className="oq-row cursor-pointer">
        <span className="t-body min-w-0 flex-1 truncate text-left text-accent-400">Tahrirlash</span>
      </button>

      {open && (
        <EditSheet
          title="Loyihani tahrirlash"
          onClose={() => setOpen(false)}
          onDone={save}
          doneText={saving ? "Saqlanmoqda…" : "Saqlash"}
        >
          <Field label="Nomi" required error={error ?? undefined}>
            <Input
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <Field label="Tavsif">
            <Textarea
              value={description}
              rows={3}
              placeholder="Loyiha nima uchun — bir jumla"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </EditSheet>
      )}
    </>
  );
}
