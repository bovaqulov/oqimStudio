"use client";

import { forwardRef, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

/**
 * One chapter of the trigger editor. Controlled rather than self-managing: the
 * summary line above jumps into these, so something outside has to be able to
 * open one.
 *
 * The count on a folded header is the deal that makes folding honest — a
 * section is allowed to hide its controls, never the fact that it is doing
 * something. A chapter with nothing set stays quiet and can be skipped.
 */
export const AccordionSection = forwardRef<
  HTMLDivElement,
  {
    title: string;
    icon: IconName;
    hint: string;
    count?: number;
    /** Something inside is wrong — folding may hide the control, never the fact. */
    issue?: "error" | "warning";
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
  }
>(function AccordionSection({ title, icon, hint, count = 0, issue, open, onToggle, children }, ref) {
  return (
    <div ref={ref} className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-800/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-neutral-800/60"
      >
        <Icon name={icon} size={13} className={cn("flex-none", open ? "text-accent-300" : "text-neutral-600")} />
        <span className="flex-none text-[12px] max-md:text-[15px] text-neutral-200">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] max-md:text-[12px] text-neutral-600">{hint}</span>
        {issue && (
          <Icon
            name="warning"
            size={11}
            className={cn("flex-none", issue === "error" ? "text-danger-fg" : "text-warning-fg")}
          />
        )}
        {count > 0 && (
          <span className="flex-none rounded-full bg-accent-900 px-[6px] py-[1px] text-[10px] max-md:text-[12px] text-accent-200 tabular-nums">
            {count}
          </span>
        )}
        <Icon
          name="caret-down"
          size={10}
          className={cn("flex-none text-neutral-600 transition-transform duration-150", open ? "" : "-rotate-90")}
        />
      </button>
      {open && <div className="flex flex-col gap-3 border-t border-neutral-800 px-2.5 py-2.5">{children}</div>}
    </div>
  );
});
