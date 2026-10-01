import "server-only";
import { apiRequest } from "@/lib/api/server";
import type { ModuleKey } from "../types";
import type { FlowExport, FlowSchema, ImportValidation } from "../transfer-types";

/**
 * Moving a graph in and out of the studio as JSON.
 *
 * Its own repository rather than four more methods on `flows-repository`: that
 * one is the canvas talking to its own rows, and these four are a border. What
 * arrives here was written somewhere else — by hand, or by a model that has
 * never seen this schema — so every one of them is a call whose answer is
 * findings first and data second.
 *
 * Tenant-scoped like everything else: the workspace id leads and travels as
 * `X-Workspace-Id`, so an import cannot land a graph in somebody else's bot by
 * naming its id.
 */

export interface ImportFlowInput {
  workspaceId: string;
  botId: string;
  projectId: string;
  moduleKey: ModuleKey;
  name: string;
  /**
   * Passed through exactly as it was parsed. Typing the blocks as `FlowNode`
   * here would be this side vouching for a shape only the validator has
   * actually looked at.
   */
  graph: { nodes: unknown[]; edges: unknown[] };
  /**
   * The flow's own JavaScript, when the file carried any.
   *
   * Optional, and an empty string means the same as leaving it out: the
   * endpoint reads absent and blank alike as "no code", and a caller holding a
   * file without a `script` key should not have to invent one. Sent unchecked —
   * the backend compiles it before storing and refuses the whole import if it
   * does not, which is a judgement only a JavaScript engine can make.
   */
  script?: string;
}

export interface FlowTransferRepository {
  /** Reads the graph and says what is wrong with it. Creates nothing. */
  validate(workspaceId: string, graph: { nodes: unknown[]; edges: unknown[] }): Promise<ImportValidation>;
  /**
   * Creates a new flow from the graph. Write roles only — the backend refuses
   * the rest, and the action checks first.
   *
   * Narrowed to what the caller uses: the endpoint answers the whole flow
   * record, but a second `FlowRecord` mapper in a second file is a second place
   * for `updatedAt` to be handed on as a raw timestamp.
   */
  importGraph(input: ImportFlowInput): Promise<{ id: string; name: string }>;
  /** The block vocabulary. Any member may read it. */
  schema(workspaceId: string): Promise<FlowSchema>;
  /** One flow as JSON — the worked example an author feeds back into a model. */
  exportFlow(workspaceId: string, flowId: string): Promise<FlowExport>;
}

class ApiFlowTransferRepository implements FlowTransferRepository {
  async validate(
    workspaceId: string,
    graph: { nodes: unknown[]; edges: unknown[] },
  ): Promise<ImportValidation> {
    return apiRequest<ImportValidation>("/api/flows/import/validate/", {
      method: "POST",
      workspaceId,
      body: { graph },
    });
  }

  async importGraph(input: ImportFlowInput): Promise<{ id: string; name: string }> {
    return apiRequest<{ id: string; name: string }>("/api/flows/import/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: {
        graph: input.graph,
        botId: input.botId,
        projectId: input.projectId,
        name: input.name,
        moduleKey: input.moduleKey,
        script: input.script,
      },
    });
  }

  async schema(workspaceId: string): Promise<FlowSchema> {
    return apiRequest<FlowSchema>("/api/flows/schema/", { workspaceId });
  }

  async exportFlow(workspaceId: string, flowId: string): Promise<FlowExport> {
    return apiRequest<FlowExport>(`/api/flows/${flowId}/export/`, { workspaceId });
  }
}

export const flowTransferRepository: FlowTransferRepository = new ApiFlowTransferRepository();
