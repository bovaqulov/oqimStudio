import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The one card shape (DRY).
 *
 * A hairline rather than a shadow, in both themes. The page is true black now
 * and a 1px shadow on black is invisible — what separates a card from the
 * ground is the faint lift of its own translucent fill plus half a pixel of
 * edge. Same reasoning in light, where a white card on a white page has
 * nothing but the edge to sit against.
 */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[16px] border border-separator bg-surface", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
