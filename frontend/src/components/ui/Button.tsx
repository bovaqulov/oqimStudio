import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger-ghost";

/*
 * One filled button per screen — and on a phone that one is normally Telegram's
 * own MainButton, not this. `primary` is what is left for the desktop studio
 * and for a sheet's confirm row; everything else on a screen is a plain text
 * button or a list row.
 *
 * A destructive action is never `primary`. It is `danger-ghost` plus a
 * confirmation from the client (see `confirmDestructive`).
 */
const variantClasses: Record<Variant, string> = {
  primary: "bg-accent-700 text-white",
  secondary: "bg-neutral-800 text-neutral-100",
  ghost: "bg-transparent text-accent-400",
  "danger-ghost": "bg-transparent text-danger-fg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({
  variant = "secondary",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "oq-press inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-[12px] px-4 text-[15px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 md:min-h-[36px]",
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
