import type { AuthErrorCode, AuthSession, ResetTokenStatus } from "./types";

/**
 * What a server action hands back.
 *
 * Errors cross the server/client boundary as data, not as exceptions: a thrown
 * custom class arrives in the browser as a generic message with its code
 * stripped, and the auth screens branch on codes. The repository turns a
 * failed result back into an `AuthFailure` so callers still see one shape.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AuthErrorCode; message: string; field?: string } };

export type SessionResult = ActionResult<AuthSession>;

/**
 * Signing up, plus the confirmation code — but only where the backend is
 * willing to hand it over, which is development. In production `devCode` is
 * always null and the code exists only in the inbox it was mailed to.
 */
export interface SignupOutcome {
  session: AuthSession;
  devCode: string | null;
}

export type SignupResult = ActionResult<SignupOutcome>;
export type ResetTokenResult = ActionResult<ResetTokenStatus>;
export type DemoTokenResult = ActionResult<{ demoToken: string | null }>;
export type VoidResult = ActionResult<null>;
