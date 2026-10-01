"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { moveRovingFocus } from "@/lib/utils/roving";

/**
 * One question and the options that answer it.
 *
 * `note` is the part that earns its keep: a row of pills says nothing about
 * whether picking a second one is allowed, and users find out by clicking and
 * watching the first one switch off. Saying "bir nechtasi mumkin" / "faqat
 * bittasi" above the row costs a line and removes the guess.
 *
 * A real `<fieldset>`/`<legend>` rather than a styled div: the legend is read
 * out with every option inside it, so "Kontaktlar" arrives as "Kontakt holati,
 * Kontaktlar" instead of on its own. The arrows move between options — Tab
 * reaches the group, not each pill in it.
 */
export function FieldGroup({
  legend,
  note,
  count = 0,
  single = false,
  action,
  bodyClassName,
  children,
}: {
  legend: string;
  /** How many answers this question takes — "bir nechtasi mumkin" / "faqat bittasi". */
  note?: string;
  /** Narrowing settings inside this group; painted as an accent badge when non-zero. */
  count?: number;
  /** One answer only, so the options are radios rather than checkboxes. */
  single?: boolean;
  /** A control that belongs to the question rather than to the answers — a reset, a preset. */
  action?: ReactNode;
  /**
   * How the options are laid out. Replaces the default wrapping chip row rather
   * than adding to it — `cn` is plain clsx, so a second `display` class here
   * would race the first instead of beating it.
   */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 flex w-full items-center gap-1.5 p-0">
        <span className="t-footnote t-secondary">{legend}</span>
        {/* `note` still exists for a group that genuinely needs one, but
            "faqat bittasi" over a row of radio buttons is the control
            describing itself. */}
        {note && <span className="t-footnote t-tertiary">· {note}</span>}
        {count > 0 && (
          <span className="t-caption rounded-full bg-accent-900 px-[6px] py-[1px] text-accent-200 tabular-nums">
            {count}
          </span>
        )}
        {action && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </legend>
      <div
        role={single ? "radiogroup" : "group"}
        onKeyDown={moveRovingFocus}
        className={cn(bodyClassName ?? "flex flex-wrap gap-1.5")}
      >
        {children}
      </div>
    </fieldset>
  );
}
