"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ApiError, TOKEN_COOKIE, WORKSPACE_COOKIE, apiRequest } from "@/lib/api/server";
import { workspacesRepository } from "@/features/workspace/data/workspaces-repository";
import { cookieScopeFor } from "./cookie-scope";
import type {
  AuthErrorCode,
  AuthSession,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  TelegramBotLoginStatus,
  TelegramSignInConfig,
} from "./types";
import type { DemoTokenResult, ResetTokenResult, SessionResult, SignupResult, VoidResult } from "./action-types";
import {
  decodeSession,
  encodeSession,
  REMEMBER_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "./session-cookie";

/**
 * Everything the auth screens do, as server actions.
 *
 * They exist as server functions for one reason: the credential. The backend
 * answers a login with a token, and that token is written straight into an
 * httpOnly cookie here — the browser never holds it, so an XSS on any page of
 * this app cannot walk away with a workspace. What the browser does get is the
 * readable `AuthSession` the route guard and the header need, which contains
 * nothing worth stealing.
 */

interface BackendSession {
  user: { id: string; name: string; email: string; locale: string; emailVerified: boolean };
  workspaceId: string | null;
  expiresAt: number | null;
  token: string;
}

function toAuthSession(payload: BackendSession, remember: boolean): AuthSession {
  const ttl = (remember ? REMEMBER_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS) * 1000;
  return {
    userId: payload.user.id,
    email: payload.user.email,
    name: payload.user.name,
    workspaceId: payload.workspaceId,
    emailVerified: payload.user.emailVerified,
    expiresAt: payload.expiresAt ?? Date.now() + ttl,
  };
}

async function persist(payload: BackendSession, remember: boolean): Promise<AuthSession> {
  const store = await cookies();
  const maxAge = remember ? REMEMBER_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
  // Decided from the host, not from `NODE_ENV`: a tunnel in front of a
  // development build is still HTTPS to the browser, and that is the case a
  // Mini App is actually tested in.
  const scope = cookieScopeFor((await headers()).get("host"));
  store.set(TOKEN_COOKIE, payload.token, {
    httpOnly: true,
    path: "/",
    maxAge,
    ...scope,
  });
  if (payload.workspaceId) {
    store.set(WORKSPACE_COOKIE, payload.workspaceId, { path: "/", maxAge, ...scope });
  }
  return toAuthSession(payload, remember);
}

function failure(error: unknown): { ok: false; error: { code: AuthErrorCode; message: string; field?: string } } {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: { code: error.code as AuthErrorCode, message: error.message, ...(error.field ? { field: error.field } : {}) },
    };
  }
  // A backend that is down is not a wrong password, and the screens say so.
  return { ok: false, error: { code: "network_error", message: "Serverga ulanib bo'lmadi. Birozdan so'ng urinib ko'ring." } };
}

export async function loginAction(input: LoginInput): Promise<SessionResult> {
  try {
    const payload = await apiRequest<BackendSession>("/api/auth/login/", {
      method: "POST",
      token: null,
      body: { email: input.email, password: input.password, remember: input.remember },
    });
    return { ok: true, data: await persist(payload, input.remember) };
  } catch (error) {
    return failure(error);
  }
}

export async function signupAction(input: SignupInput): Promise<SignupResult> {
  try {
    const payload = await apiRequest<BackendSession & { demoToken?: string }>("/api/auth/signup/", {
      method: "POST",
      token: null,
      body: { name: input.name, email: input.email, password: input.password },
    });
    const session = await persist(payload, false);
    // Present only where there is no inbox to open; the confirmation screen
    // shows it as a development banner rather than making a tester guess.
    return { ok: true, data: { session, devCode: payload.demoToken ?? null } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Signing in with the Telegram Login Widget.
 *
 * The payload is handed over exactly as Telegram signed it — no field is
 * added, removed or reordered on the way — because the backend recomputes the
 * signature over those very fields. Anything this action "helpfully" changed
 * would make a valid login look forged.
 */
export async function telegramLoginAction(payload: Record<string, unknown>): Promise<SessionResult> {
  try {
    const session = await apiRequest<BackendSession>("/api/auth/telegram/", {
      method: "POST",
      token: null,
      body: payload,
    });
    return { ok: true, data: await persist(session, true) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Signs in from inside a Telegram Mini App.
 *
 * `initData` is passed through untouched — it is a signed string, and any
 * normalising on the way would break the signature it is checked by. The
 * backend holds the token that verifies it; nothing here inspects it.
 */
export async function telegramWebAppLoginAction(initData: string): Promise<SessionResult> {
  try {
    const session = await apiRequest<BackendSession>("/api/auth/telegram/webapp/", {
      method: "POST",
      token: null,
      body: { initData },
    });
    // Always remembered: a Mini App is reopened from a chat, and a session that
    // expired between visits would put a login screen in front of somebody the
    // client had already identified.
    return { ok: true, data: await persist(session, true) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Which bot the widget belongs to — `null` when Telegram login is not
 * configured *for this domain*.
 *
 * Telegram checks the domain the widget is rendered on against the one
 * registered with @BotFather, so the question only has an answer once the
 * caller says where it is being asked from. This runs on the panel's server,
 * where the browser's `Host` header is the public domain the reader typed.
 */
export async function telegramConfigAction(): Promise<TelegramSignInConfig | null> {
  try {
    const host = (await headers()).get("host") ?? "";
    const config = await apiRequest<{ enabled: boolean; botUsername: string; botFlow: boolean }>(
      "/api/auth/telegram/config/",
      { token: null, params: { host } },
    );
    if (!config.botUsername || (!config.enabled && !config.botFlow)) return null;
    return { botUsername: config.botUsername, widget: config.enabled, botFlow: config.botFlow };
  } catch {
    // The sign-in screen still has to render with a password form on it.
    return null;
  }
}

/**
 * Signing in by pressing Start in the bot — the way in that needs no
 * registered domain (see `apps/accounts/bot_login.py`).
 *
 * Two steps, because the person leaves the browser in between: this one opens
 * an attempt and names the `t.me` link that completes it.
 */
export async function telegramBotStartAction(): Promise<{ nonce: string; url: string; expiresIn: number } | null> {
  try {
    return await apiRequest("/api/auth/telegram/start/", { method: "POST", token: null, body: {} });
  } catch {
    return null;
  }
}

/**
 * Whether that attempt has been approved yet. On the first "yes" the session
 * is real — the credential cookie is written here, server-side, exactly as it
 * is for a password login.
 */
export async function telegramBotStatusAction(
  nonce: string,
): Promise<{ status: TelegramBotLoginStatus; session?: AuthSession }> {
  try {
    const data = await apiRequest<{ status: TelegramBotLoginStatus; session?: BackendSession }>(
      "/api/auth/telegram/status/",
      { token: null, params: { nonce } },
    );
    if (data.status === "approved" && data.session) {
      return { status: "approved", session: await persist(data.session, true) };
    }
    return { status: data.status };
  } catch {
    return { status: "error" };
  }
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  try {
    await apiRequest("/api/auth/logout/", { method: "POST", body: {} });
  } catch {
    // Signing out has to work even when the backend does not answer: the
    // credential is a cookie, and clearing it is what actually ends the session.
  }
  store.delete(TOKEN_COOKIE);
  store.delete(WORKSPACE_COOKIE);
}

export async function verifyEmailAction(token: string): Promise<SessionResult> {
  try {
    const payload = await apiRequest<BackendSession>("/api/auth/verify-email/", {
      method: "POST",
      token: null,
      body: { token },
    });
    return { ok: true, data: await persist(payload, false) };
  } catch (error) {
    return failure(error);
  }
}

export async function resendVerificationAction(): Promise<DemoTokenResult> {
  try {
    const payload = await apiRequest<{ demoToken?: string }>("/api/auth/resend-verification/", {
      method: "POST",
      body: {},
    });
    return { ok: true, data: { demoToken: payload.demoToken ?? null } };
  } catch (error) {
    return failure(error);
  }
}

export async function forgotPasswordAction(email: string): Promise<DemoTokenResult> {
  try {
    const payload = await apiRequest<{ demoToken: string | null }>("/api/auth/forgot-password/", {
      method: "POST",
      token: null,
      body: { email },
    });
    return { ok: true, data: { demoToken: payload.demoToken ?? null } };
  } catch (error) {
    return failure(error);
  }
}

export async function checkResetTokenAction(token: string): Promise<ResetTokenResult> {
  try {
    const status = await apiRequest<{ valid: boolean; emailMasked?: string; reason?: string }>(
      `/api/auth/reset-password/${encodeURIComponent(token)}/`,
      { token: null },
    );
    return {
      ok: true,
      data: {
        valid: status.valid,
        ...(status.emailMasked ? { emailMasked: status.emailMasked } : {}),
        ...(status.reason ? { reason: status.reason as "invalid_token" | "expired_token" } : {}),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<VoidResult> {
  try {
    await apiRequest("/api/auth/reset-password/", {
      method: "POST",
      token: null,
      body: { token: input.token, password: input.password },
    });
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Onboarding — the two ways an account gets a workspace                       */
/* -------------------------------------------------------------------------- */

export async function createWorkspaceForUserAction(input: {
  name: string;
  locale: string;
}): Promise<{ workspaceId: string } | { error: string }> {
  try {
    const workspace = await workspacesRepository.create(input);
    const store = await cookies();
    store.set(WORKSPACE_COOKIE, workspace.id, {
      path: "/",
      maxAge: REMEMBER_MAX_AGE_SECONDS,
      // The same scope the session itself gets: a workspace cookie the browser
      // drops inside Telegram makes every tenant-scoped read fail one step
      // after a sign-in that worked.
      ...cookieScopeFor((await headers()).get("host")),
    });
    // The switcher in the sidebar is rendered by the layout from the session's
    // memberships, and the redirect that follows is client-side — without this
    // the workspace just created is missing from the list it was created from.
    revalidatePath("/", "layout");
    return { workspaceId: workspace.id };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Ish maydonini yaratib bo'lmadi." };
  }
}

/**
 * Puts the new workspace on the readable session descriptor as well.
 *
 * Two cookies name a tenant and they answer different questions: `oqim_ws` is
 * what the server resolves a request against, `oqim_session` is what the route
 * guard reads — and only the second decides whether an account is still stuck
 * on /onboarding/workspace. The onboarding screen keeps them in step from the
 * browser afterwards (`persistSession`), so the gap only ever showed where
 * there is no browser step: the /join button redeemed the invite, joined the
 * workspace, and the redirect it ended on bounced the brand-new member back to
 * "create a workspace" — with the code by then spent.
 *
 * The window is carried over rather than reset. `expiresAt` is absolute, so
 * re-deriving max-age from it leaves a 12-hour session twelve hours long
 * instead of quietly promoting it to "remember me".
 */
async function noteWorkspaceOnSession(workspaceId: string): Promise<void> {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return;
  const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000);
  if (maxAge <= 0) return;
  store.set(SESSION_COOKIE, encodeSession({ ...session, workspaceId }), {
    path: "/",
    maxAge,
    ...cookieScopeFor((await headers()).get("host")),
  });
}

export async function joinWorkspaceWithCodeAction(input: {
  code: string;
}): Promise<{ workspaceId: string } | { error: string }> {
  try {
    const workspace = await workspacesRepository.join(input.code);
    const store = await cookies();
    store.set(WORKSPACE_COOKIE, workspace.id, {
      path: "/",
      maxAge: REMEMBER_MAX_AGE_SECONDS,
      // The same scope the session itself gets: a workspace cookie the browser
      // drops inside Telegram makes every tenant-scoped read fail one step
      // after a sign-in that worked.
      ...cookieScopeFor((await headers()).get("host")),
    });
    await noteWorkspaceOnSession(workspace.id);
    revalidatePath("/", "layout");
    return { workspaceId: workspace.id };
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : "Bunday taklif kodi topilmadi. Kodni admindan qayta so'rang.",
    };
  }
}

/**
 * The signed-in person's own interface language.
 *
 * It lives here rather than beside the workspace actions because it is not a
 * tenant setting: the backend keeps it on `User`, behind `PATCH
 * /api/auth/session/`, which is the endpoint this module already owns.
 *
 * No permission check, deliberately. The old "Interfeys tili" wrote the
 * *workspace's* locale and was gated on `canManageWorkspace`, which produced
 * exactly two wrong outcomes and no right one: an admin who preferred Russian
 * switched the whole team into it, and the analyst beside them — the one member
 * whose job is reading — could not change their own. Reading the interface is
 * not a privilege anybody grants.
 *
 * `revalidatePath("/", "layout")` because the language is resolved in the root
 * layout: without it the chrome keeps the words it was rendered with and only
 * the next full navigation catches up.
 */
export async function setInterfaceLocaleAction(locale: string): Promise<void> {
  await apiRequest("/api/auth/session/", { method: "PATCH", body: { locale } });
  revalidatePath("/", "layout");
}

/**
 * The signed-in person's own display name.
 *
 * Beside `setInterfaceLocaleAction` and not beside the workspace actions for
 * the same reason: it is kept on `User`, behind `PATCH /api/auth/session/`, and
 * it belongs to the reader rather than to the tenant. No permission check —
 * there is no role under which somebody may not be called what they are called.
 *
 * It is drawn in more places than a settings screen suggests: the avatar's
 * initials, the member list, the header, every notification the runtime writes
 * about a handoff. So `revalidatePath("/", "layout")` and not just this page.
 *
 * The backend takes it from here: a name that arrives on this endpoint sets
 * `User.name_is_custom`, which is what stops the next Telegram sign-in putting
 * Telegram's own name back over it.
 */
export async function setProfileNameAction(formData: FormData): Promise<{ error?: string }> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Ismingizni kiriting." };

  try {
    await apiRequest("/api/auth/session/", { method: "PATCH", body: { name } });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("setProfileNameAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
  revalidatePath("/", "layout");
  return {};
}
