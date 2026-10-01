/**
 * The auth contract. These types are what the UI is written against, so
 * pointing the repository at a real backend changes no component.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** BCP-47 tag the interface is rendered in for this person. */
  locale: string;
  /** `false` until the address is confirmed — gates entry to the app shell. */
  emailVerified: boolean;
  /** Workspaces this account belongs to. Empty for a brand-new signup. */
  workspaceIds: string[];
  /**
   * Telegram established this identity, so `email` is the synthetic
   * `tg<id>@telegram.local` the backend mints — plumbing, not an address
   * anybody owns. Any screen that shows the address has to know the
   * difference; see `ProfileSettingsForm`.
   */
  viaTelegram?: boolean;
  /** Without the `@`, and empty for an account that has not set one. */
  telegramUsername?: string;
}

/**
 * A signed-in session as the browser is allowed to hold it. No token, no
 * password hash: a real deployment swaps `token` in as an httpOnly cookie the
 * client never reads, and nothing here changes.
 */
export interface AuthSession {
  userId: string;
  email: string;
  name: string;
  /** Active tenant; `null` until the user picks or creates one. */
  workspaceId: string | null;
  emailVerified: boolean;
  /** Unix ms. The middleware treats anything past this as signed out. */
  expiresAt: number;
}

/**
 * Every failure the auth layer can produce, as a code the UI can branch on.
 * `field` points the message at an input; unset means it belongs to the form.
 */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "email_not_found"
  | "weak_password"
  | "invalid_token"
  | "expired_token"
  | "rate_limited"
  | "server_error"
  | "network_error";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  /** Name of the input the message belongs under, when it is about one field. */
  field?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  /** Long session vs. one that ends with the browser day. */
  remember: boolean;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

/** What a reset link resolves to before the new password is accepted. */
export interface ResetTokenStatus {
  valid: boolean;
  /** Masked address the link belongs to, e.g. "az•••@sunrise.uz". */
  emailMasked?: string;
  reason?: Extract<AuthErrorCode, "invalid_token" | "expired_token">;
}

export interface CreateWorkspaceInput {
  name: string;
  currency: string;
  locale: string;
}

export interface JoinWorkspaceInput {
  /** Invite code handed out by a workspace admin. */
  code: string;
}

/**
 * What the sign-in screens know about Telegram login.
 *
 * Two different ways in, and they are not interchangeable: the widget is one
 * tap but only works on the domain registered with @BotFather, while pressing
 * Start in the bot works anywhere and costs an app switch.
 */
export interface TelegramSignInConfig {
  botUsername: string;
  /** The Login Widget can sign somebody in from this domain. */
  widget: boolean;
  /** A login bot is configured, so the `t.me` link path is available. */
  botFlow: boolean;
}

/** Where a bot-link attempt stands. `error` is ours: the backend never answered. */
export type TelegramBotLoginStatus = "pending" | "approved" | "expired" | "consumed" | "error";
