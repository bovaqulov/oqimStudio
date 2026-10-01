"use server";

import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";
import { realtimeRepository } from "./data/realtime-repository";
import type { SocketPass, SocketPassFailure } from "./types";

/**
 * A pass for the workspace socket.
 *
 * This exists because the panel's API token is httpOnly: the page cannot read
 * it, and `new WebSocket(...)` cannot send a header even if it could. So the
 * page asks the server — which does hold the token — for something a URL is
 * allowed to carry: a signature good for half a minute, on one workspace.
 *
 * Called again on every reconnect rather than cached. A pass outlives a page
 * load and nothing more, which is the property that makes it safe to put in a
 * URL, so keeping one around would be keeping the one thing it was designed
 * not to be.
 */
export async function socketPassAction(): Promise<SocketPass | SocketPassFailure> {
  try {
    const { workspace } = await getSession();
    return await realtimeRepository.pass(workspace.id);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("socketPassAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Jonli ulanish ochilmadi.",
      final: isFinal(error),
    };
  }
}

/**
 * Is this a refusal, or a bad moment?
 *
 * The endpoint answers 401, 403 or 404 when the *caller* is the problem — not
 * signed in, not verified, or not a member of the workspace they named. None
 * of that changes because a timer went off, so retrying is a request that will
 * be refused identically every time.
 *
 * Everything else is a bad moment and stays retryable, and `isUnreachable` is
 * called out because it can carry a status too: the backend never answered, so
 * whatever number came back describes this attempt and not this caller.
 */
function isFinal(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.isUnreachable) return false;
  return error.status === 401 || error.status === 403 || error.status === 404;
}
