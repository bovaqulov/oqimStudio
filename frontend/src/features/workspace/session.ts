import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api/server";
import { formatInstant } from "@/lib/utils/date";
import type { MemberRole, Session, User, Workspace } from "./types";

/** Which tenant the request is acting on. Set by the workspace switcher. */
export const WORKSPACE_COOKIE = "oqim_ws";
/**
 * Readable copy of who is signed in, written by the browser after login. The
 * server does not trust it — it is what the route guard in `proxy.ts` reads to
 * decide whether to show the app shell at all. The credential itself is the
 * httpOnly `oqim_token` cookie, which JavaScript cannot see.
 */
export const USER_COOKIE = "oqim_uid";

interface SessionPayload {
  user: User & { emailVerified: boolean; workspaceIds: string[] };
  workspaceId: string | null;
  memberships: (Omit<Workspace, "createdAt"> & { createdAt: string })[];
  role: MemberRole | null;
}

/**
 * The current user, their active workspace and their role in it. Every
 * tenant-scoped read in the app starts here — no page may assume which
 * workspace it is rendering for.
 *
 * The answer comes from the backend, which validates the requested workspace
 * against this account's memberships on every request: a stale or hand-edited
 * cookie cannot leak another tenant's data, it simply falls back to a
 * workspace this user does belong to.
 */
export async function getSession(): Promise<Session> {
  const store = await cookies();
  const workspaceId = store.get(WORKSPACE_COOKIE)?.value;

  let payload: SessionPayload;
  try {
    payload = await apiRequest<SessionPayload>("/api/auth/session/", { workspaceId });
  } catch (error) {
    // No credential, or one the backend no longer honours. The route guard
    // normally catches this first; landing here means the readable session
    // cookie outlived the credential — after a password reset elsewhere, or a
    // database this token was never issued from.
    //
    // Redirecting straight to /login would loop: the guard reads that same
    // cookie, decides this person is signed in, and sends them back. The
    // cookies have to go first, and only a route handler can delete them.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/api/auth/signed-out?reason=auth");
    }
    throw error;
  }

  const memberships: Workspace[] = payload.memberships.map((workspace) => ({
    ...workspace,
    createdAt: formatInstant(workspace.createdAt),
  }));
  const workspace = memberships.find((item) => item.id === payload.workspaceId) ?? memberships[0];
  if (!workspace) {
    // A verified account with no workspace has one screen it can be on.
    redirect("/onboarding/workspace");
  }

  const { emailVerified: _verified, workspaceIds: _ids, ...user } = payload.user;
  return { user, workspace, role: payload.role ?? "analyst", memberships };
}
