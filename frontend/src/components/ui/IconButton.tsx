import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { Icon, type IconName } from "./Icon";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  /** `danger` colors the hover state dim red, so a destructive click announces itself before it happens. */
  tone?: "default" | "danger";
  /**
   * Swaps the browser's native `title` bubble — slow to appear, unstyled — for one
   * that shows on hover/focus straight away. Opt-in because it is absolutely
   * positioned: only use it where there is room below the button inside the
   * nearest clipping ancestor.
   */
  tooltip?: boolean;
  /** Which edge the tooltip lines up with. `end` keeps it inside a right-hand panel. */
  tooltipAlign?: "center" | "end";
}

/** Square icon-only button. `label` becomes the title/aria-label — icon buttons never ship without one. */
export function IconButton({
  icon,
  label,
  size = 27,
  active = false,
  tone = "default",
  tooltip = false,
  tooltipAlign = "center",
  className,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      title={tooltip ? "" : label}
      aria-label={label}
      className={cn(
        // `size` is the drawn size on a mouse-driven screen. Below `md` every
        // icon button is 44px square instead, whatever it was asked for: the
        // audit found a 27px notifications bell and a 32px "⋯" in the header,
        // and a target a thumb misses is a control that is not there. The size
        // travels as a custom property rather than as an inline width/height,
        // because an inline style cannot be overridden by a media query.
        "flex h-[var(--icon-button-size)] w-[var(--icon-button-size)] max-md:h-11 max-md:w-11",
        "cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-accent-800 text-accent-ink"
          : tone === "danger"
            ? "text-neutral-500 hover:bg-danger-bg hover:text-danger-fg"
            : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100",
        className,
      )}
      style={{ "--icon-button-size": `${size}px` } as CSSProperties}
      {...rest}
    >
      {/* The glyph keeps its own size on both: a 44px target around a 13px icon
          is correct, an icon scaled up to match would be a different control. */}
      <Icon name={icon} size={Math.max(16, Math.round(size * 0.48))} className="max-md:hidden" />
      <Icon name={icon} size={Math.max(18, Math.round(size * 0.48))} className="hidden max-md:block" />
    </button>
  );

  if (!tooltip) return button;

  return (
    <span className="group relative inline-flex flex-none">
      {button}
      {/* aria-hidden: the button's aria-label already carries this text to assistive tech. */}
      <span
        aria-hidden
        className={cn(
          "t-footnote pointer-events-none absolute top-full z-20 mt-1 rounded-[8px] bg-neutral-950 px-2 py-1 whitespace-nowrap text-neutral-200 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100",
          tooltipAlign === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {label}
      </span>
    </span>
  );
}
