import "server-only";
import { apiFind, apiList, apiRequest } from "@/lib/api/server";
import type { AgentDraft, AgentRecord, AgentRunRecord, AgentStatus } from "../types";

/**
 * Agents, from `/api/agents/`.
 *
 * An agent is written **whole**, tools included. They are one thing an author
 * edits on one screen — who it is and what it may do — and a split write would
 * let a save land half applied: a persona describing a tool that was not
 * created, or a tool the instructions no longer mention. Same argument as a
 * flow's graph, which is also written in one call.
 */
export interface AgentsRepository {
  list(workspaceId: string): Promise<AgentRecord[]>;
  /**
   * The agents of one project — what the project's «Resurslar» tab lists and
   * what an «AI agent» block may pick from.
   *
   * The workspace still travels as the tenant header, and the backend applies
   * it first: a `projectId` from another workspace narrows an already-filtered
   * list to nothing rather than opening somebody else's folder.
   */
  listByProject(workspaceId: string, projectId: string): Promise<AgentRecord[]>;
  get(workspaceId: string, agentId: string): Promise<AgentRecord | undefined>;
  /** Whether this deployment can run an agent, and what it may run on. */
  status(workspaceId: string): Promise<AgentStatus>;
  /** One agent's trace, newest turn first. */
  runs(workspaceId: string, agentId: string, limit?: number): Promise<AgentRunRecord[]>;
  create(workspaceId: string, draft: AgentDraft): Promise<AgentRecord>;
  update(workspaceId: string, agentId: string, draft: Partial<AgentDraft>): Promise<AgentRecord>;
  remove(workspaceId: string, agentId: string): Promise<void>;
}

/**
 * What a screen shows when the backend has not answered the status call.
 *
 * "Not configured" rather than "configured": a panel that says an agent will
 * work and then does not is worse than one that under-promises, and the block
 * itself already fails the same way — cleanly, into an exit.
 */
export const UNKNOWN_STATUS: AgentStatus = {
  available: false,
  offline: false,
  reason: "Holat aniqlanmadi",
  defaultModel: "",
  defaultEffort: "medium",
  effortLevels: ["low", "medium", "high"],
  models: [],
};

class ApiAgentsRepository implements AgentsRepository {
  list(workspaceId: string): Promise<AgentRecord[]> {
    return apiList<AgentRecord>("/api/agents/", { workspaceId });
  }

  listByProject(workspaceId: string, projectId: string): Promise<AgentRecord[]> {
    return apiList<AgentRecord>("/api/agents/", { workspaceId, params: { projectId } });
  }

  get(workspaceId: string, agentId: string): Promise<AgentRecord | undefined> {
    return apiFind<AgentRecord>(`/api/agents/${agentId}/`, { workspaceId });
  }

  status(workspaceId: string): Promise<AgentStatus> {
    return apiRequest<AgentStatus>("/api/agents/status/", { workspaceId });
  }

  runs(workspaceId: string, agentId: string, limit = 50): Promise<AgentRunRecord[]> {
    return apiList<AgentRunRecord>(`/api/agents/${agentId}/runs/`, { workspaceId, params: { limit } });
  }

  create(workspaceId: string, draft: AgentDraft): Promise<AgentRecord> {
    return apiRequest<AgentRecord>("/api/agents/", { method: "POST", workspaceId, body: draft });
  }

  update(workspaceId: string, agentId: string, draft: Partial<AgentDraft>): Promise<AgentRecord> {
    return apiRequest<AgentRecord>(`/api/agents/${agentId}/`, { method: "PATCH", workspaceId, body: draft });
  }

  async remove(workspaceId: string, agentId: string): Promise<void> {
    await apiRequest<void>(`/api/agents/${agentId}/`, { method: "DELETE", workspaceId });
  }
}

export const agentsRepository: AgentsRepository = new ApiAgentsRepository();
