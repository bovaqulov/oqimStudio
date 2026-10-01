"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/**
 * "Saqlash", next to the autosave indicator.
 *
 * Autosave writes on its own, so this button changes nothing about what is
 * stored — what it changes is whether the author has to believe it. Pressing it
 * (or ⌘/Ctrl+S) writes immediately and says so, which is what somebody who has
 * just been burned by a lost edit is actually asking for.
 */
export function SaveButton() {
  const save = useFlowEditorStore((state) => state.save);
  const status = useFlowEditorStore((state) => state.saveStatus);
  const [saving, setSaving] = useState(false);

  const dirty = status === "pending" || status === "error";

  // Nothing to save and nothing in flight: autosave has it, the indicator says
  // so, and ⌘S still works for anyone who reaches for it. A button that is
  // always there and always a no-op is what made this row eleven controls long.
  if (!dirty && !saving) return null;

  return (
    <button
      type="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        await save();
        setSaving(false);
      }}
      title="Saqlash (Ctrl/⌘+S)"
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] whitespace-nowrap transition-colors disabled:cursor-default",
        dirty
          ? "bg-accent-700 text-white hover:bg-accent-600"
          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
      )}
    >
      <Icon name={saving ? "arrow-clockwise" : "check"} size={12} className={cn(saving && "animate-spin")} />
      Saqlash
    </button>
  );
}
