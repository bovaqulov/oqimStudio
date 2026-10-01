import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Settings that exist only because an option above them is on. The rule down the
 * left edge and the slightly lifted background are the whole point: they tie the
 * panel back to the choice that opened it, so a stack of revealed settings never
 * reads as one flat list of unrelated fields.
 *
 * `nested` is for a reveal inside a reveal — it drops the accent and the second
 * background lift, so depth two reads as subordinate rather than as a rival.
 *
 * The outer grid is what `animate-reveal` animates; the inner `overflow-hidden`
 * row is what the collapsed state clips against.
 */
export function RevealPanel({ children, nested = false }: { children: ReactNode; nested?: boolean }) {
  return (
    <div className="animate-reveal">
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "mt-1 flex flex-col gap-1.5 rounded-r-md border-l-2 py-2 pr-2 pl-2.5",
            nested ? "border-neutral-700" : "border-accent-600 bg-neutral-700/15",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
