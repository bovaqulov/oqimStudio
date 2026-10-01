import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

export interface ToggleChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  /**
   * Renders muted and swallows the click. Uses `aria-disabled` rather than the
   * native attribute on purpose: the chip stays hoverable and focusable, so its
   * `title` can explain why the option is unavailable.
   */
  disabled?: boolean;
  /**
   * What picking this chip means, for assistive tech and for the eye. "multi"
   * is a checkbox — several may be on at once; "single" is a radio inside a
   * `role="radiogroup"`. Left off, the chip stays a plain toggle button
   * (`aria-pressed`), which is what a filter pill outside a group is.
   */
  select?: "multi" | "single";
  /**
   * Paints a tick on the active chip. Colour alone is a weak signal for
   * "chosen" in a row where every chip is coloured anyway — the tick is what
   * makes the selection unmistakable at a glance.
   */
  check?: boolean;
  /**
   * Accent marks a value the user chose; "neutral" marks one that is merely the
   * default. Both read as on — the difference is whether the chip is worth a
   * second look when scanning a configured Handler.
   */
  tone?: "accent" | "neutral";
  /** A value is held behind this option even though it is not the chosen one. */
  dot?: boolean;
  children: ReactNode;
}

/** Pill toggle used for scopes, message-type filters and similar multi-select chips. */
export function ToggleChip({
  active,
  disabled = false,
  select,
  check = false,
  tone = "accent",
  dot = false,
  className,
  children,
  onClick,
  ...rest
}: ToggleChipProps) {
  const checkbox = select === "multi";
  const radio = select === "single";

  return (
    <button
      type="button"
      role={checkbox ? "checkbox" : radio ? "radio" : undefined}
      // A radio group carries exactly one tab stop, then hands over to the
      // arrows; checkboxes stay individually tabbable, as they do natively.
      tabIndex={radio && !active ? -1 : undefined}
      data-roving=""
      aria-disabled={disabled || undefined}
      aria-checked={select ? active : undefined}
      aria-pressed={select ? undefined : active}
      onClick={disabled ? undefined : onClick}
      className={cn(
        // 44px on a phone, not 36: this is the last clickable thing in the
        // product still under the floor, and a filter chip is exactly the kind
        // of small target a thumb misses.
        "flex min-h-[44px] flex-none items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors md:min-h-[28px] md:px-2.5",
        disabled
          ? "cursor-not-allowed bg-neutral-800/40 text-neutral-700 line-through"
          : active
            ? tone === "accent"
              ? "cursor-pointer bg-accent-700 text-white"
              : "cursor-pointer bg-neutral-700 text-neutral-100"
            : "cursor-pointer bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100",
        className,
      )}
      {...rest}
    >
      {check && active && <Icon name="check" size={13} weight="bold" className="flex-none" />}
      {children}
      {/* Says the option still holds what was typed into it, so switching away
          and back is not the leap of faith it looks like. */}
      {dot && !active && <span aria-hidden className="h-1 w-1 flex-none rounded-full bg-accent-400" />}
    </button>
  );
}
