import { cn } from "@/lib/utils/cn";

/** Inline "working on it" for buttons and panels. Decorative — the label next to it carries the meaning. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      style={{ width: size, height: size }}
    />
  );
}
