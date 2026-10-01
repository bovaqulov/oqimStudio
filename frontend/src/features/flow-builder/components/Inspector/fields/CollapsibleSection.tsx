"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

/**
 * A sub-section of a field group that can fold away. Optional settings — media
 * filters, bot-status events, a block's second tier of settings — are picked
 * once and rarely revisited, so leaving them open costs more panel height than
 * the click it saves.
 *
 * `selectedCount` and `summary` are the two halves of the same deal, and the
 * deal is what makes folding safe: a section may hide its controls, never the
 * fact that it is doing something. Count for a section that answers "how
 * many", a summary line for one whose settings have values worth reading —
 * "Claude Opus 5 · t=0.3 · 600 token" says on the closed header everything an
 * author needed to open it for.
 */
export function CollapsibleSection({
  title,
  selectedCount = 0,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  selectedCount?: number;
  /** What is set inside, for a closed header. Dropped when the section is open — the controls say it better. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-900 pt-[10px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1.5 text-left text-[11px] text-neutral-400 transition-colors hover:text-neutral-100 max-md:min-h-[44px] max-md:text-[15px] max-md:font-medium max-md:text-neutral-200"
      >
        <Icon
          name="caret-down"
          size={10}
          className={cn("flex-none transition-transform duration-150", open ? "" : "-rotate-90")}
        />
        <span className="flex-none">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] max-md:text-[12px] text-neutral-600">{!open && summary}</span>
        {selectedCount > 0 && (
          <span
            className={cn(
              "rounded-full px-[6px] py-[1px] text-[10px] max-md:text-[12px] tabular-nums",
              open ? "text-neutral-600" : "bg-accent-900 text-accent-200",
            )}
          >
            {selectedCount}
          </span>
        )}
      </button>
      {open && <div className="flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}
