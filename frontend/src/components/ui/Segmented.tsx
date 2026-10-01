"use client";

import { useRef } from "react";
import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";
import { rovingTarget } from "@/lib/utils/roving";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** A count carried on the segment — unread, pending, whatever the screen counts. */
  badge?: number;
  /** Muted and inert, but still focusable so `title` can say why. */
  disabled?: boolean;
  title?: string;
}

/**
 * One of these, exactly one — in two dresses.
 *
 * `inset` is the iOS segmented control: a 36px track on a filled surface, one
 * raised pill sliding between equal shares of it. It belongs *inside* content —
 * a period picker above a chart, a metric switch on a card.
 *
 * `island` is the floating chrome's section tab strip: a 38px glass capsule that
 * sits clear of the screen edges with the page scrolling underneath it, and a
 * lighter capsule inside marking the section you are in. It belongs to the
 * chrome, not to the content. Its segments share the strip when they fit and
 * scroll sideways when they do not, so three sections fill the capsule the way
 * a row of folder tabs does and five overflow rather than squeezing.
 *
 * Neither uses a blue fill for the chosen segment. A filled blue segment reads
 * as the screen's primary action, which is a promotion no tab bar has earned —
 * and it would collide with the one blue thing that *is* the action.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  grow = true,
  variant = "inset",
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Segments share the width equally. `island` always shares, so it is ignored there. */
  grow?: boolean;
  variant?: "inset" | "island";
  label?: string;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const island = variant === "island";
  const share = island ? false : grow;

  function move(key: string, from: number) {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length < 2) return;
    const index = enabled.findIndex((option) => option.value === options[from]?.value);
    const next = enabled[rovingTarget(key, index < 0 ? 0 : index, enabled.length)];
    if (!next) return;
    onChange(next.value);
    queueMicrotask(() => groupRef.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex items-stretch",
        island
          ? // 38px track, 4px of padding, so the inner capsule lands at 30px.
            "oq-island no-scrollbar h-[38px] w-full gap-1 overflow-x-auto rounded-[19px] p-1"
          : "h-9 gap-0.5 rounded-full bg-neutral-800 p-0.5",
        // cn-override-ok: guarded by `!island`, and the width above it only
        // exists on the island branch — the two can never both land.
        !island && (grow ? "w-full" : "w-max"),
        className,
      )}
      onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const index = options.findIndex((option) => option.value === value);
        event.preventDefault();
        move(event.key, index < 0 ? 0 : index);
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-value={option.value}
            aria-checked={active}
            aria-disabled={option.disabled || undefined}
            tabIndex={active ? 0 : -1}
            title={option.title}
            onClick={
              option.disabled
                ? undefined
                : () => {
                    haptic("light");
                    onChange(option.value);
                  }
            }
            className={cn(
              // `min-w-*` moved into the two branches below. It was `min-w-0`
              // here and `min-w-max` in the island arm, which meant both landed
              // and the stylesheet picked — `min-w-max` as it happens, which is
              // what the island wanted, by luck rather than by the code saying so.
              "flex items-center justify-center gap-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              island
                ? // `flex-1` with `min-w-max`: the segments share the strip when
                  // they fit — which is what a folder-tab row looks like, and the
                  // audit found three tabs bunched into its left half with the
                  // right half empty — and stop shrinking at their own text, so a
                  // module with five sections overflows into the scroll instead of
                  // squeezing.
                  "h-[30px] min-w-max flex-1 rounded-[15px] px-3.5"
                : // `px-2` when the segments share the width: five labels on a
                  // 390px screen have ~68px each, and 24px of that going to
                  // padding is what decides whether "14 kun" fits or truncates.
                  cn("min-w-0 rounded-full", share ? "flex-1 px-2" : "flex-none px-3"),
              option.disabled
                ? "cursor-not-allowed text-neutral-700"
                : active
                  ? island
                    ? "cursor-pointer bg-[var(--island-active)] text-text"
                    : "cursor-pointer bg-surface-raised text-text shadow-md"
                  : cn("cursor-pointer", island ? "text-[var(--island-muted)]" : "text-neutral-500"),
            )}
          >
            {/* An island tab scrolls rather than truncates: half a section name
                is not a section name. Inside a content control there is nowhere
                to scroll to, so it still truncates there. */}
            <span className={island ? "whitespace-nowrap" : "min-w-0 truncate"}>{option.label}</span>
            {option.badge !== undefined && option.badge > 0 && (
              <span className="flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-[9px] bg-accent-500 px-1 text-[11px] font-bold text-white tabular-nums">
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
