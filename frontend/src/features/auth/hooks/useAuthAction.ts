"use client";

import { useCallback, useRef, useState } from "react";
import { AuthFailure } from "../data/auth-repository";
import type { AuthError, AuthErrorCode } from "../types";

export interface AuthActionState<TInput, TResult> {
  /** Result of the last successful run, `null` until there is one. */
  data: TResult | null;
  loading: boolean;
  error: AuthError | null;
  /** Runs the action; resolves to the result, or `null` when it failed. */
  run: (input: TInput) => Promise<TResult | null>;
  reset: () => void;
}

/**
 * An error, as the form beneath it should read it.
 *
 * The fallback is deliberately about the *connection*, because that is the only
 * thing an unrecognised throw can honestly be blamed on. Which is why anything
 * carrying its own sentence has to be recognised: a wrong invite code came back
 * from the server as "Taklif kodi yaroqsiz yoki muddati tugagan", was rethrown
 * as a plain `Error` by the screen, failed the `instanceof` below, and was
 * shown to the reader as "Aloqa uzildi. Internetni tekshirib, qayta urinib
 * ko'ring." — a sentence that sent them to check their wifi over a typo.
 *
 * `AuthFailure` is still the type to throw. The structural check is the belt to
 * that brace: a rejected server action crosses a serialisation boundary, and a
 * class does not survive one.
 */
function toAuthError(cause: unknown): AuthError {
  if (cause instanceof AuthFailure) return { code: cause.code, message: cause.message, field: cause.field };
  if (isCarryingCode(cause)) {
    return { code: cause.code, message: cause.message, ...(cause.field ? { field: cause.field } : {}) };
  }
  return {
    code: "network_error",
    message: "Aloqa uzildi. Internetni tekshirib, qayta urinib ko'ring.",
  };
}

function isCarryingCode(cause: unknown): cause is { code: AuthErrorCode; message: string; field?: string } {
  return (
    typeof cause === "object" &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === "string" &&
    typeof (cause as { message?: unknown }).message === "string" &&
    (cause as { message: string }).message.length > 0
  );
}

/**
 * The write-side counterpart of `useResource`: one call, three states, and a
 * guard that makes a second submit while the first is in flight a no-op — the
 * reason a double-clicked button cannot create two accounts.
 */
export function useAuthAction<TInput, TResult>(
  action: (input: TInput) => Promise<TResult>,
): AuthActionState<TInput, TResult> {
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (input: TInput): Promise<TResult | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await action(input);
        setData(result);
        return result;
      } catch (cause) {
        setError(toAuthError(cause));
        return null;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [action],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, run, reset };
}
