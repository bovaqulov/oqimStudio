import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { InfoTip } from "./InfoTip";

/**
 * A filled well, 44px tall, with the focus ring drawn as a 2px accent inset
 * rather than as a border swap — a border that only exists on focus makes the
 * field 1px taller the moment it is touched, and on a list of fields that is a
 * visible jump.
 */
const fieldClasses =
  "w-full rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[17px] text-text ring-0 outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-accent-500 focus:ring-inset focus-visible:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldClasses, "h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldClasses, "resize-y py-3 leading-[22px]", className)} {...rest} />;
  },
);

/**
 * One label, one field.
 *
 * There is deliberately no `hint`. A line of grey advice under every input was
 * the single biggest source of the wall of 12px text the audit measured — and
 * most of those lines said what the label already said, or named the Bot API
 * method behind the field, which is not the reader's vocabulary. What a field
 * expects belongs in its `placeholder`, as an *example* of a correct answer;
 * the rare case that genuinely needs a sentence gets `info`, which is an (i)
 * the reader can press, and there is no more than one of those on a screen.
 */
export function Field({
  label,
  required,
  /** What was wrong with this input. The one thing that may print under it. */
  error,
  /** A sentence behind an (i). Use it once per screen, or not at all. */
  info,
  children,
  /**
   * How the field sits in the layout around it — a grid span, a width. Not how
   * it looks: the input's own appearance belongs to `fieldClasses`, and a field
   * that could restyle itself is a form where two of them disagree.
   */
  className,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  info?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="t-footnote t-secondary flex items-center gap-1.5">
        {label}
        {required && <span className="text-accent-400">*</span>}
        {info && <InfoTip text={info} size={15} />}
      </span>
      {children}
      {error && (
        <span role="alert" className="t-footnote text-danger-fg">
          {error}
        </span>
      )}
    </label>
  );
}
