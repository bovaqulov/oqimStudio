import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Native select, wearing the same 44px filled well as Input and Textarea — and
 * the app's own chevron rather than the browser's, which `.oq-select` swaps in.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "oq-select h-11 w-full cursor-pointer rounded-[12px] border-0 bg-neutral-800 pr-9 pl-3.5 text-[17px] text-text outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
