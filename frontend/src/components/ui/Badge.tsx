import { cn } from "@/lib/utils/cn";
import type { Tone } from "./types";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  neutral: "bg-neutral-tone-bg text-neutral-tone-fg",
  accent: "bg-accent-800 text-accent-200",
};

/** A pill of state. 12/500, tinted, never a filled block of colour. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "t-caption inline-flex items-center whitespace-nowrap rounded-full px-2 py-[3px]",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
