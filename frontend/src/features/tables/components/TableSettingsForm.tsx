"use client";

import { useState, useTransition } from "react";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { MainButton } from "@/lib/telegram/MainButton";
import { updateTableAction } from "../actions";
import type { Table } from "../types";

/**
 * The three facts about a table that are not its data.
 *
 * One save for all three, and the button only appears once something has
 * changed — the same shape the columns editor uses one tab over, so "have I
 * saved this" is answered the same way on both.
 *
 * The key is **not** here. It was, on the argument that a handle chosen in the
 * first minute is chosen before the reader knows what it is for — and the field
 * carried a tooltip warning that changing it means updating every flow that
 * uses it. That warning was the tell: the form was offering an edit whose
 * consequences it could only describe, not carry out. Nothing renames the key
 * inside an author's message text, so a rename leaves `{{ table("narxlar") }}`
 * naming something that no longer exists, rendering nothing, silently. The key
 * is derived from the name when the table is made and shown read-only under the
 * table's title, which is where somebody writing an expression looks for it.
 */
export function TableSettingsForm({
  table,
  bots,
  projects,
  canEdit,
}: {
  table: Table;
  bots: { id: string; name: string }[];
  /** Where it can be filed. Empty in a workspace with no projects yet. */
  projects: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [name, setName] = useState(table.name);
  const [botId, setBotId] = useState(table.botId ?? "");
  const [projectId, setProjectId] = useState(table.projectId ?? "");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const changed =
    name !== table.name || botId !== (table.botId ?? "") || projectId !== (table.projectId ?? "");

  function save() {
    if (pending) return;
    setError(null);

    if (!name.trim()) {
      setError({ message: "Ma'lumotga nom bering.", field: "name" });
      return;
    }

    startTransition(async () => {
      const result = await updateTableAction({
        tableId: table.id,
        name: name.trim(),
        botId: botId || null,
        projectId: projectId || null,
        wasProjectId: table.projectId,
      });
      if (result.error) {
        setError({ message: result.error, field: result.field });
        return;
      }
      showToast("Ma'lumot saqlandi");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Nomi" required error={error?.field === "name" ? error.message : null}>
        <Input
          value={name}
          disabled={!canEdit}
          maxLength={120}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </Field>

      {/*
       * The key is not editable, and that is the point rather than an omission.
       * It is what `{{ table("narxlar") }}` names, and nothing follows a rename:
       * every flow that reads this table would keep naming the old key and
       * quietly render nothing. The field that used to be here carried a
       * tooltip saying exactly that — a warning is not a substitute for not
       * offering the trap. It is shown, read only, under the table's title.
       */}
      {/*
       * Which project files it — and the only way to rescue one that is in
       * none.
       *
       * Data moved inside the project: «Ma'lumotlar» is a group on the
       * project's own page, and that is now the only screen that navigates to a
       * table. A table with no project is therefore a table nothing links to —
       * it exists, a flow reads it by name, and no list shows it. Every one of
       * those was made before the create form learned to pass a project, and
       * without this select there is no way back for them.
       */}
      <Field label="Loyiha">
        <Select value={projectId} disabled={!canEdit} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Loyihaga biriktirilmagan</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Bot">
        <Select value={botId} disabled={!canEdit} onChange={(event) => setBotId(event.target.value)}>
          <option value="">Hamma botlar uchun</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </Select>
      </Field>

      {error && !error.field && (
        <p role="alert" className="t-footnote m-0 text-danger-fg">
          {error.message}
        </p>
      )}

      {canEdit && (
        <MainButton
          inline
          visible={changed}
          text={pending ? "Saqlanmoqda…" : "Saqlash"}
          loading={pending}
          onClick={save}
        />
      )}
    </div>
  );
}
