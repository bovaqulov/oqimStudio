import type { AuthError, AuthErrorCode, AuthSession, LoginInput, ResetPasswordInput, ResetTokenStatus, SignupInput } from "../types";
import type { ActionResult, SignupOutcome } from "../action-types";
import {
  checkResetTokenAction,
  forgotPasswordAction,
  loginAction,
  logoutAction,
  resendVerificationAction,
  resetPasswordAction,
  signupAction,
  verifyEmailAction,
} from "../actions";

/**
 * Thrown by every repository method that fails, so callers branch on a code
 * rather than on a message string.
 */
export class AuthFailure extends Error implements AuthError {
  readonly code: AuthErrorCode;
  readonly field?: string;

  constructor(code: AuthErrorCode, message: string, field?: string) {
    super(message);
    this.name = "AuthFailure";
    this.code = code;
    if (field) this.field = field;
  }
}

/**
 * Everything the auth screens can ask for.
 *
 * Each method is one server action away from the backend. The actions are what
 * hold the credential — the token comes back from Django and goes straight
 * into an httpOnly cookie there, never through this module — so what crosses
 * into the browser is the session the header renders and nothing more.
 */
export interface AuthRepository {
  login(input: LoginInput): Promise<AuthSession>;
  /** The session, plus the confirmation code where the backend exposes one (development). */
  signup(input: SignupInput): Promise<SignupOutcome>;
  /** Always resolves — an unknown address must not reveal that it is unknown. */
  requestPasswordReset(email: string): Promise<{ demoToken: string | null }>;
  checkResetToken(token: string): Promise<ResetTokenStatus>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  /** Sends the confirmation mail again. In development the code comes back with it. */
  resendVerification(): Promise<{ demoToken: string | null }>;
  /** The code from the emailed link. */
  verifyEmail(code: string): Promise<AuthSession>;
  logout(): Promise<void>;
}

/** Turns a failed action result back into the one error shape the screens catch. */
function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new AuthFailure(result.error.code, result.error.message, result.error.field);
}

class ApiAuthRepository implements AuthRepository {
  async login(input: LoginInput): Promise<AuthSession> {
    return unwrap(await loginAction(input));
  }

  async signup(input: SignupInput): Promise<SignupOutcome> {
    return unwrap(await signupAction(input));
  }

  async requestPasswordReset(email: string): Promise<{ demoToken: string | null }> {
    return unwrap(await forgotPasswordAction(email));
  }

  async checkResetToken(token: string): Promise<ResetTokenStatus> {
    return unwrap(await checkResetTokenAction(token));
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    unwrap(await resetPasswordAction(input));
  }

  async resendVerification(): Promise<{ demoToken: string | null }> {
    return unwrap(await resendVerificationAction());
  }

  async verifyEmail(code: string): Promise<AuthSession> {
    return unwrap(await verifyEmailAction(code));
  }

  async logout(): Promise<void> {
    await logoutAction();
  }
}

export const authRepository: AuthRepository = new ApiAuthRepository();
