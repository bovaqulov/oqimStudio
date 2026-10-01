import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The one label shape above every Inspector control (DRY — 25-odd fields used to
 * repeat the class string). Sentence case rather than tracked ALL CAPS, and in
 * the secondary text tone: the value in the field is what the eye should land
 * on, not the name of the field. Callers keep it tight to its control (`gap-1`)
 * so label and input read as a single unit.
 */
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[11px] leading-snug text-neutral-600 max-md:text-[15px] max-md:font-medium max-md:text-neutral-200", className)}>{children}</span>;
}
