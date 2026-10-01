"use client";

import { useCallback, useState } from "react";

export type FormValues = Record<string, string | boolean>;
export type FormErrors<T extends FormValues> = Partial<Record<keyof T, string>>;

export interface AuthFormApi<T extends FormValues> {
  values: T;
  errors: FormErrors<T>;
  setValue: <K extends keyof T>(name: K, value: T[K]) => void;
  /** Validates one field — wired to `onBlur`, so nobody is corrected mid-word. */
  validateField: (name: keyof T) => void;
  /** Validates everything, focuses the first bad field, and only then calls `onValid`. */
  submit: (onValid: (values: T) => void | Promise<void>) => (event: React.FormEvent) => void;
  /** Bumps on every rejected submit — the card keys its shake animation off it. */
  shakeKey: number;
}

/**
 * Form state for the auth screens.
 *
 * Two rules it exists to enforce: validation happens on blur and on submit but
 * never on every keystroke (being corrected while still typing is hostile),
 * and a rejected submit moves focus to the first field at fault, so a keyboard
 * or screen-reader user is not left guessing which one it was.
 */
export function useAuthForm<T extends FormValues>({
  initial,
  validate,
}: {
  initial: T;
  validate: (values: T) => FormErrors<T>;
}): AuthFormApi<T> {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FormErrors<T>>({});
  const [shakeKey, setShakeKey] = useState(0);
  // Fields the reader has actually typed in. A field they only passed through
  // — autofocus puts the caret in the first one, and tabbing past it is a blur
  // — has told us nothing yet, and "Bu maydon to'ldirilishi shart" under an
  // untouched input is the form scolding somebody for arriving.
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  const setValue = useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    setTouched((current) => (current[name] ? current : { ...current, [name]: true }));
    // Clearing as soon as the field changes keeps a stale message from sitting
    // under an input the reader has already fixed.
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
  }, []);

  const validateField = useCallback(
    (name: keyof T) => {
      setTouched((currentTouched) => {
        if (!currentTouched[name]) return currentTouched;
        setValues((current) => {
          const message = validate(current)[name];
          setErrors((previous) => ({ ...previous, [name]: message }));
          return current;
        });
        return currentTouched;
      });
    },
    [validate],
  );

  const submit = useCallback(
    (onValid: (values: T) => void | Promise<void>) => (event: React.FormEvent) => {
      event.preventDefault();
      const found = validate(values);
      const firstInvalid = Object.keys(found).find((key) => found[key as keyof T]);
      if (firstInvalid) {
        // Submitting is asking; from here on every field may answer.
        setTouched(Object.fromEntries(Object.keys(values).map((key) => [key, true])) as typeof touched);
        setErrors(found);
        setShakeKey((key) => key + 1);
        document.getElementById(firstInvalid)?.focus();
        return;
      }
      setErrors({});
      void onValid(values);
    },
    [validate, values],
  );

  return { values, errors, setValue, validateField, submit, shakeKey };
}
