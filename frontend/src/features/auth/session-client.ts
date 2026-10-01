"use client";

import { cookieAttributes } from "./cookie-scope";
import type { AuthSession } from "./types";
import {
  decodeSession,
  encodeSession,
  isInvitePath,
  isSessionExpired,
  REMEMBER_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./session-cookie";

/**
 * Browser-side session storage for the mock auth layer.
 *
 * Everything here is a stand-in: the cookie is readable by JavaScript, which a
 * real deployment would never allow. When the backend lands it sets an
 * httpOnly cookie itself and this file shrinks to a reader — the session
 * *shape* and every consumer stay exactly as they are.
 *
 * Two more cookies are written next to it (`oqim_uid`, `oqim_ws`) because the
 * server already resolves the tenant from those; they are what makes the rest
 * of the app see the person who just signed in.
 */
const USER_COOKIE = "oqim_uid";
const WORKSPACE_COOKIE = "oqim_ws";

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  // The attributes are the whole reason a Mini App can hold a session — see
  // [[cookieAttributes]]. Written the same way on the way out, or the browser
  // treats the clear as a different cookie and leaves the original in place.
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; ${cookieAttributes()}`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; ${cookieAttributes()}`;
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function persistSession(session: AuthSession, remember = false): void {
  const maxAge = remember ? REMEMBER_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
  writeCookie(SESSION_COOKIE, encodeSession(session), maxAge);
  writeCookie(USER_COOKIE, session.userId, maxAge);
  if (session.workspaceId) writeCookie(WORKSPACE_COOKIE, session.workspaceId, maxAge);
}

export function readSession(): AuthSession | null {
  if (typeof document === "undefined") return null;
  const session = decodeSession(readCookie(SESSION_COOKIE));
  return isSessionExpired(session) ? null : session;
}

export function clearSession(): void {
  clearCookie(SESSION_COOKIE);
  clearCookie(USER_COOKIE);
  clearCookie(WORKSPACE_COOKIE);
}

/** Where to send someone once they are signed in and have a workspace. */
export function landingPathFor(session: AuthSession, next?: string | null): string {
  if (!session.emailVerified) return `/verify-email?email=${encodeURIComponent(session.email)}`;
  // Only same-origin paths are honoured — an absolute URL in `next` would be an
  // open redirect.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  // An invite outranks "no workspace yet", and it is the same ordering the
  // route guard makes (`proxy.ts`, WORKSPACELESS_ROUTES). Onboarding used to
  // win here unconditionally, which spent the sign-in that `next` existed to
  // carry: the guard had sent this person to /login *from* /join/<code>, and
  // the moment they got back their code was gone.
  if (!session.workspaceId) return target && isInvitePath(target) ? target : "/onboarding/workspace";
  return target ?? "/dashboard";
}
