"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { AUTH_COPY } from "../messages";
import { scorePassword } from "../password";
import { AuthField } from "./AuthField";

const STRENGTH_TONE = [
  "bg-danger-fg",
  "bg-danger-fg",
  "bg-warning-fg",
  "bg-accent-500",
  "bg-success-fg",
];

/**
 * A password input with the three things that stop people getting locked out:
 * a reveal toggle, a Caps Lock warning (the classic silent failure), and — on
 * signup only — a strength meter.
 *
 * The meter used to print a second line under itself ("Maslahat: raqam
 * qo'shing, katta harf qo'shing.") on top of the label, the rule and the
 * error. That is four pieces of text for one field. What is left is the bar
 * and the word for where the password stands; the rule that produced the bar
 * lives on the field's (i), and a rejected password still says exactly what
 * was wrong in its error.
 */
export function PasswordField({
  id,
  label,
  value,
  error,
  info,
  autoComplete,
  showStrength = false,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  /** The one (i) a screen is allowed. Used for the password rule on signup and reset. */
  info?: string;
  /** "current-password" for sign-in, "new-password" everywhere else. */
  autoComplete: "current-password" | "new-password";
  showStrength?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const strength = showStrength && value ? scorePassword(value) : null;

  return (
    <AuthField id={id} label={label} error={error} info={info} required>
      {/* The ring belongs round the whole well, not round the bare input that
          shares it with the reveal button — so the input opts out of its own. */}
      <div
        className={cn(
          "flex h-11 items-stretch overflow-hidden rounded-[12px] bg-neutral-800",
          error ? "ring-2 ring-danger-fg ring-inset" : "focus-within:ring-2 focus-within:ring-accent-500 focus-within:ring-inset",
        )}
      >
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            setCapsLock(false);
            onBlur?.();
          }}
          onKeyUp={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
          className="min-w-0 flex-1 border-none bg-transparent px-3.5 text-[17px] text-text placeholder:text-neutral-600 focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? AUTH_COPY.common.passwordHide : AUTH_COPY.common.passwordShow}
          aria-pressed={visible}
          className="w-11 flex-none cursor-pointer text-neutral-500"
        >
          <Icon name={visible ? "eye-slash" : "eye"} size={17} className="mx-auto" />
        </button>
      </div>

      {capsLock && (
        <p role="status" className="t-footnote flex items-center gap-1.5 text-warning-fg">
          <Icon name="warning" size={15} className="flex-none" />
          {AUTH_COPY.common.capsLock}
        </p>
      )}

      {strength && (
        <div className="flex items-center gap-2.5">
          <span className="flex flex-1 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index < strength.score ? STRENGTH_TONE[strength.score] : "bg-neutral-800",
                )}
              />
            ))}
          </span>
          <span className="t-footnote t-secondary flex-none">{strength.label}</span>
        </div>
      )}
    </AuthField>
  );
}
