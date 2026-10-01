"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useHelpDialogStore } from "./help-store";

/*
 * The key combinations stay here and the descriptions come from the
 * dictionary: "⌘ / Ctrl + K" is the same string in every language, and a
 * translator handed one would eventually mistype it in one of the three.
 *
 * Built per render rather than as a module-level `const` — a constant is
 * evaluated once per process and would serve whichever language asked first to
 * everybody after it.
 */
function helpGroups(t: Dictionary): { name: string; rows: { keys: string; description: string }[] }[] {
  const help = t.chrome.help;
  return [
    {
      name: help.general,
      rows: [
        { keys: "⌘ / Ctrl + K", description: help.globalSearch },
        { keys: "⌘ / Ctrl + S", description: help.saveFlow },
        { keys: "?", description: help.toggleHelp },
        { keys: "Esc", description: help.cancel },
        { keys: "Alt + 1…9", description: help.switchScreens },
      ],
    },
    {
      name: help.canvas,
      rows: [
        { keys: "1…9", description: help.addBlock },
        { keys: "⌘ / Ctrl + Z", description: help.undo },
        { keys: "⌘⇧Z / Ctrl + Y", description: help.redo },
        { keys: "Enter", description: help.editBlock },
        { keys: "⌘ / Ctrl + A", description: help.selectAll },
        { keys: "Shift + klik", description: help.addToSelection },
        { keys: "⌘ / Ctrl + D", description: help.duplicateBlock },
        { keys: "Delete", description: help.deleteBlock },
        { keys: "← ↑ → ↓", description: help.nudgeBlock },
        { keys: "+ / −", description: help.zoom },
        { keys: "0", description: help.recenter },
      ],
    },
  ];
}

/**
 * Help, in the order somebody stuck actually needs it: the help centre first —
 * it is where the written answers are, and it no longer has a sidebar entry to
 * be found in — then the shortcuts for whoever came looking for those.
 *
 * A sheet on a phone and a centred dialog from `md` up: a centred box collapses
 * around the on-screen keyboard, and its buttons go with it.
 */
export function HelpDialog() {
  const open = useHelpDialogStore((state) => state.open);
  const hide = useHelpDialogStore((state) => state.hide);
  const t = useT();

  if (!open) return null;

  return (
    <div
      onClick={hide}
      className="fixed inset-0 z-[60] flex h-[100dvh] flex-col justify-end bg-neutral-950/70 backdrop-blur-[3px] md:items-center md:justify-center md:p-6"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="animate-sheet flex max-h-[88dvh] w-full flex-col rounded-t-[22px] bg-overlay shadow-lg md:animate-rise md:max-h-full md:w-[min(520px,100%)] md:rounded-lg"
      >
        {/* The grab handle is what tells a reader this is a sheet they can
            dismiss downward, rather than a page that arrived. Every other
            dialog draws one through `Modal`; this one is its own overlay
            because it owns the "?" toggle, so it draws its own. */}
        <div aria-hidden className="flex justify-center pt-2 pb-0.5 md:hidden">
          <span className="h-1 w-9 rounded-full bg-neutral-700" />
        </div>
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-neutral-700 md:hidden" />

        <div className="flex flex-none items-center gap-2 px-4 py-3 md:px-5 md:pt-5 md:pb-4">
          <Icon name="question" size={16} className="text-accent-300" />
          <span className="flex-1 text-[15px] font-medium md:text-[14px]">{t.chrome.help.title}</span>
          <IconButton icon="x" label={t.chrome.close} size={32} className="oq-tap relative" onClick={hide} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(16px_+_env(safe-area-inset-bottom))] md:px-5 md:pb-5">
          <Link
            href="/help"
            onClick={hide}
            className="mb-4 flex items-center gap-2.5 rounded-md border border-accent-900 bg-accent-950 px-3.5 py-3 text-[15px] text-accent-200 hover:border-accent-700 md:text-[12px]"
          >
            <Icon name="chat-dots" size={16} className="flex-none" />
            <span className="min-w-0 flex-1">{t.chrome.help.centerLink}</span>
            <Icon name="caret-right" size={13} className="flex-none" />
          </Link>

          <div className="flex flex-col gap-4">
            {helpGroups(t).map((group) => (
              <div key={group.name}>
                <div className="mb-2 text-[12px] tracking-[.08em] text-neutral-600 uppercase md:text-[10.5px]">
                  {group.name}
                </div>
                <div className="flex flex-col">
                  {group.rows.map((row) => (
                    <div key={row.keys} className="flex items-center gap-3 border-b border-neutral-800 py-[7px]">
                      <span className="min-w-[118px] rounded-sm bg-neutral-800 px-[7px] py-0.5 text-center text-[13px] whitespace-nowrap text-neutral-200 md:text-[11.5px]">
                        {row.keys}
                      </span>
                      <span className="flex-1 text-[13px] text-neutral-400 md:text-[12px]">{row.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
