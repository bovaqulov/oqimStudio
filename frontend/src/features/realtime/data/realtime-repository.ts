import "server-only";
import { apiRequest } from "@/lib/api/server";
import type { SocketPass } from "../types";

/**
 * The workspace socket, from `/api/realtime/ticket/`.
 *
 * A read in every sense that matters — it changes nothing and can be repeated —
 * but a POST, because the answer is a credential and a credential does not
 * belong in a URL that gets logged, cached and kept in history.
 */
export interface RealtimeRepository {
  /** A pass for this workspace's socket, and the address to use it at. */
  pass(workspaceId: string): Promise<SocketPass>;
}

class ApiRealtimeRepository implements RealtimeRepository {
  async pass(workspaceId: string): Promise<SocketPass> {
    return apiRequest<SocketPass>("/api/realtime/ticket/", { method: "POST", workspaceId });
  }
}

export const realtimeRepository: RealtimeRepository = new ApiRealtimeRepository();
