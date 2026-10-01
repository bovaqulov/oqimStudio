"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { useFlowEditorStore, type SaveStatus } from "../store/useFlowEditorStore";

/** "hozir" goes stale about this often, so the label re-renders on its own clock. */
const TICK_MS = 30_000;

/** How long a save still counts as "hozir" before it starts reporting minutes. */
const JUST_NOW_MS = 45_000;

function savedAgo(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < JUST_NOW_MS) return "hozir";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  return new Date(timestamp).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Autosave, said out loud. The editor has always written every edit straight
 * to the browser — which left no way to tell a saved flow from a lost one, and
 * no reason to trust it. This is the whole state machine in one line of the
 * top bar: waiting to write, written (and when), or refused.
 */
export function SaveIndicator() {
  const status = useFlowEditorStore((s) => s.saveStatus);
  const saveError = useFlowEditorStore((s) => s.saveError);
  const lastSavedAt = useFlowEditorStore((s) => s.lastSavedAt);
  const save = useFlowEditorStore((s) => s.save);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [status]);

  // The clock only advances between renders, so a fresh save needs the reading taken again.
  const reference = Math.max(now, lastSavedAt ?? 0);

  const described = describe(status, lastSavedAt, reference);
  // Idle draws nothing at all now: "Avto-saqlash yoniq" is a status that is
  // true of every session and changes for nobody, and it was one of the three
  // 12px greys the audit found on the step sheet.
  if (!described) return null;
  const { icon, label, tone, spin } = described;

  return (
    <span
      // Polite: a save landing mid-sentence must not interrupt a screen reader.
      aria-live="polite"
      className={cn(
        "t-footnote flex items-center gap-[5px]",
        tone,
      )}
      title={status === "error" ? (saveError ?? "") : "Oqim serverga avtomatik saqlanadi"}
    >
      <Icon name={icon} size={12} className={cn("flex-none", spin && "animate-spin")} />
      <span className="whitespace-nowrap">{label}</span>
      {status === "error" && (
        <>
          {saveError && (
            <span className="hidden max-w-[280px] truncate text-neutral-400 sm:inline">— {saveError}</span>
          )}
          <button
            type="button"
            onClick={() => void save()}
            className="cursor-pointer rounded-[8px] bg-neutral-800 px-1.5 py-0.5 text-[10.5px] text-neutral-200 hover:bg-neutral-700 max-md:min-h-[44px] max-md:px-3 max-md:text-[15px]"
          >
            Qayta urinish
          </button>
        </>
      )}
    </span>
  );
}

function describe(
  status: SaveStatus,
  lastSavedAt: number | null,
  now: number,
): { icon: IconName; label: string; tone: string; spin?: boolean } | null {
  switch (status) {
    case "pending":
      return { icon: "arrow-clockwise", label: "Saqlanmoqda…", tone: "text-neutral-400", spin: true };
    case "saved":
      return {
        icon: "check-circle",
        label: `Saqlandi · ${lastSavedAt ? savedAgo(lastSavedAt, now) : "hozir"}`,
        tone: "text-neutral-500",
      };
    case "error":
      // The reason travels with the state: "Saqlanmadi" on its own leaves the
      // author guessing between a dropped connection, a lost permission and a
      // flow somebody deleted in another tab.
      return { icon: "warning", label: "Saqlanmadi", tone: "text-danger-fg" };
    default:
      // Nothing to report. Autosave working is the normal state, and a line
      // announcing it on every screen is a status that never changes.
      return null;
  }
}
