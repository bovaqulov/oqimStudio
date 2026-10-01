import type { AuthSession } from "./types";

/**
 * The mock session cookie.
 *
 * A real deployment replaces this with an httpOnly, signed cookie the browser
 * cannot read or forge — which is why nothing here is treated as trusted:
 * `getSession()` still validates the user and workspace against the directory
 * on every request, and this value only decides *who to look up* and whether
 * the session is still within its window.
 */
export const SESSION_COOKIE = "oqim_session";

/** Long session for "remember me", short one for a shared computer. */
export const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

/**
 * The invite route, named beside the cookie because three readers of that
 * cookie have to agree about it and none of them can see the other two.
 *
 * `workspaceId` being null normally means "send them to onboarding" — the route
 * guard says so, the sign-in redirect says so, and `getSession()` says so. This
 * is the one path where that answer is wrong: an invite's primary reader signed
 * up *because* they were invited, so they have no workspace by definition, and
 * every one of those three rules was throwing away the code that was about to
 * give them one. Written as a constant so a fourth reader cannot be added
 * without meeting it.
 */
export const INVITE_ROUTE = "/join";

/** `/join/<code>`, and not `/joinery`. An invite always carries a code. */
export function isInvitePath(pathname: string): boolean {
  return pathname.startsWith(`${INVITE_ROUTE}/`);
}

/** Base64 so a stray quote in a name cannot break the cookie; not encryption. */
export function encodeSession(session: AuthSession): string {
  const json = JSON.stringify(session);
  if (typeof btoa === "function") return btoa(encodeURIComponent(json));
  return Buffer.from(encodeURIComponent(json)).toString("base64");
}

export function decodeSession(raw: string | undefined): AuthSession | null {
  if (!raw) return null;
  try {
    const json = typeof atob === "function" ? atob(raw) : Buffer.from(raw, "base64").toString();
    const parsed = JSON.parse(decodeURIComponent(json)) as AuthSession;
    if (!parsed?.userId || typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isSessionExpired(session: AuthSession | null, now = Date.now()): boolean {
  return !session || session.expiresAt <= now;
}
