import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Explanatory prose under a control. Deliberately a step brighter than
 * [[FieldLabel]]: a label is one or two words the eye skims, while a hint is a
 * full sentence someone actually reads, and on the panel's dark ground the
 * label's tone is too low-contrast to read comfortably at length.
 */
export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[10.5px] leading-relaxed max-md:text-[13px] text-neutral-500", className)}>{children}</p>;
}
