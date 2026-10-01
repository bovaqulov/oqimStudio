"use client";

import { useRef } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { rovingTarget } from "@/lib/utils/roving";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown before the label — the picker reads as a row of things, not a row of words. */
  icon?: IconName;
  /** Tooltip on the segment; when `disabled`, this is where the reason belongs. */
  title?: string;
  /**
   * Muted and inert, but still focusable and hoverable so `title` can say why —
   * a segment that vanishes leaves the reader wondering what they broke.
   */
  disabled?: boolean;
  /** A value is held behind this segment even though it is not the chosen one. */
  dot?: boolean;
}

/**
 * Controlled pill tab group: one of these, exactly one. A `role="radiogroup"`
 * rather than a row of buttons, so the choice reads as a choice — arrows move
 * between segments and land on the one they select, and only the selected
 * segment sits in the Tab order.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  tone = "accent",
  grow = false,
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accent for a value the user chose, "neutral" for one that is merely the default. */
  tone?: "accent" | "neutral";
  /** Segments share the full width instead of hugging their labels. */
  grow?: boolean;
  /** Names the group for screen readers when no visible legend sits above it. */
  label?: string;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(key: string, from: number) {
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length < 2) return;
    const index = enabled.findIndex((option) => option.value === options[from]?.value);
    const next = enabled[rovingTarget(key, index < 0 ? 0 : index, enabled.length)];
    if (!next) return;
    onChange(next.value);
    // The segment is selected before it is focused, so the tab stop has already
    // moved to it by the time the browser looks for something to focus.
    queueMicrotask(() => groupRef.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus());
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={cn("flex gap-0.5 rounded-full bg-neutral-800 p-0.5", className)}
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
            onClick={option.disabled ? undefined : () => onChange(option.value)}
            className={cn(
              "flex items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] transition-colors",
              grow ? "min-w-0 flex-1" : "flex-none",
              option.disabled
                ? "cursor-not-allowed text-neutral-700 line-through"
                : active
                  ? tone === "accent"
                    ? "cursor-pointer bg-accent-700 text-white"
                    : "cursor-pointer bg-neutral-700 text-neutral-100"
                  : "cursor-pointer bg-transparent text-neutral-400 hover:text-neutral-100",
            )}
          >
            {option.icon && <Icon name={option.icon} size={12} className="flex-none" />}
            <span className="min-w-0 truncate">{option.label}</span>
            {option.dot && !active && <span aria-hidden className="h-1 w-1 flex-none rounded-full bg-accent-400" />}
          </button>
        );
      })}
    </div>
  );
}
