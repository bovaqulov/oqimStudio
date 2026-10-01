"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Input } from "@/components/ui/Input";
import { InfoTip } from "@/components/ui/InfoTip";
import { cn } from "@/lib/utils/cn";

/**
 * Label + control + error, wired together.
 *
 * The label is a real `<label for>` (a placeholder disappears the moment
 * someone types, taking the question with it), the error is tied to the input
 * through `aria-describedby`, and it is announced politely rather than
 * interrupting — the reader is usually still in the field it belongs to.
 *
 * This is the id-wired twin of `ui/Input`'s `Field`, and it lost its `hint`
 * for the same reason that one never had one: a grey line of advice under
 * every input was the wall of small text this pass exists to remove. What a
 * field expects belongs in its `placeholder`, as an *example*; the rare
 * sentence that changes what the reader types gets `info`, and there is no
 * more than one of those on a screen.
 */
export function AuthField({
  id,
  label,
  error,
  info,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  /** A sentence behind an (i). Once per screen, or not at all. */
  info?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="t-footnote t-secondary flex items-center gap-1.5">
        {label}
        {required && (
          <span aria-hidden className="text-accent-400">
            *
          </span>
        )}
        {info && <InfoTip text={info} size={15} />}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="t-footnote text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

export interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * The same 44px filled well every other field in the app wears — `ui/Input`
 * with a rejection state on top, rather than a second look-alike of it.
 */
export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(invalid && "ring-2 ring-danger-fg ring-inset", className)}
      {...rest}
    />
  );
});
