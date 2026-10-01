import "server-only";
import { ApiError, apiFind, apiList, apiRequest } from "@/lib/api/server";
import { formatRelative } from "@/lib/utils/date";
import type {
  ExpressionWarning,
  FlowEdge,
  FlowExpressionUse,
  FlowLayoutMode,
  FlowNode,
  FlowOrigin,
  FlowRecord,
  FlowScriptHook,
  FlowScripts,
  FlowSummary,
  ModuleKey,
  ScriptRunResult,
} from "../types";
import { createStarterGraph } from "./starter-graph";

/**
 * Everything that reads or writes flow data goes through this interface.
 * Pages and the flow-builder store depend on `FlowsRepository`, never on the
 * transport (Dependency Inversion) — which is why pointing it at
 * `/api/flows/` changed this one file and no component.
 *
 * Every method is tenant-scoped: the workspace id comes first and travels as
 * the request's `X-Workspace-Id`, so a flow id guessed from another workspace
 * resolves to `undefined` rather than to somebody else's graph.
 */
export interface CreateFlowInput {
  workspaceId: string;
  projectId: string;
  botId: string;
  moduleKey: ModuleKey;
  name?: string;
  description?: string;
  /**
   * The graph the flow opens with. Left out for a flow created from the
   * sidebar — it gets its module's starter graph — and passed when a branch is
   * split out of another flow, or when the wizard/template gallery compiled one
   * from a blueprint.
   */
  graph?: { nodes: FlowNode[]; edges: FlowEdge[] };
  /** How the flow was made. Absent for a blank canvas, the one case with nothing to remember. */
  origin?: FlowOrigin;
  /**
   * Whether it is live the moment it is created. A template arrives complete, so
   * it lands switched on; a blank canvas cannot answer anybody yet, so it does
   * not. Defaults to off.
   */
  enabled?: boolean;
}

export interface EnsureMainFlowInput {
  workspaceId: string;
  projectId: string;
  botId: string;
}

export interface FlowsRepository {
  list(workspaceId: string): Promise<FlowSummary[]>;
  listByModule(workspaceId: string, botId: string, moduleKey: ModuleKey): Promise<FlowSummary[]>;
  /**
   * Every flow of one bot, whatever module it sits in. The Kod tab's export
   * list is the one screen that reads them across modules: a graph taken out as
   * a worked example is not being taken out of a section, and asking the author
   * which of five tabs their flow was under before they can download it is a
   * question with no purpose.
   */
  listByBot(workspaceId: string, botId: string): Promise<FlowSummary[]>;
  /**
   * The same flows with their graphs. What the "Oqimga o'tish" block's picker
   * needs — it lists not just the flows of this module but the blocks inside
   * them, so a jump can land on the right step rather than only at the start.
   */
  listRecordsByModule(workspaceId: string, botId: string, moduleKey: ModuleKey): Promise<FlowRecord[]>;
  listRecent(workspaceId: string, limit?: number): Promise<FlowSummary[]>;
  getById(workspaceId: string, id: string): Promise<FlowRecord | undefined>;
  create(input: CreateFlowInput): Promise<FlowRecord>;
  /**
   * The bot's main `dms` flow, created on first ask. The module has an entry
   * point whether or not anyone has built one — a bot with no flow at all still
   * answers /start with a welcome — so this is called where the module is read
   * rather than left to a "create your first flow" button.
   */
  ensureMainFlow(input: EnsureMainFlowInput): Promise<FlowRecord>;
  /** Saves the canvas. The backend re-derives what the runtime matches on in the same request. */
  saveGraph(
    workspaceId: string,
    id: string,
    graph: { nodes: FlowNode[]; edges: FlowEdge[]; name: string; description: string },
  ): Promise<{ record: FlowRecord; expressionWarnings: ExpressionWarning[] } | undefined>;
  /**
   * Turns the flow on or off. The backend writes `enabled` *and* the matching
   * status label, so a card and a switch can never disagree about the same flow.
   */
  setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<FlowRecord | undefined>;
  /**
   * Runs a Kod block's source against inputs the author typed.
   *
   * Not tied to a flow id, because the block being tried may not have been
   * saved yet — asking somebody to save a draft to try one line of arithmetic
   * is the loop the panel exists to remove.
   */
  /**
   * `botId` is optional to the endpoint and not optional to the answer: naming
   * one puts that bot's shared library above the block, which is what the
   * runtime does. See the panel that calls this.
   */
  runScript(
    workspaceId: string,
    source: string,
    inputs: Record<string, unknown>,
    botId?: string | null,
  ): Promise<ScriptRunResult>;
  /**
   * Everything the Script panel opens with, from one read: this flow's own
   * file, the bot's shared library, the hooks the runtime calls, and every
   * function the flow's expressions name.
   *
   * One call and not four, because the panel is opened by a keystroke and the
   * four answers are only useful together — a rail listing hooks beside an
   * editor that has not loaded yet is a panel that flickers into usefulness.
   */
  scripts(workspaceId: string, id: string): Promise<FlowScripts | undefined>;
  /**
   * Stores this flow's own script. Refused, with a line number, when it does
   * not compile — which is the point of it being a button and not an autosave.
   *
   * Answers the same wide shape `scripts` does, so `declared` on each hook is
   * true of the file that was just saved rather than of the one before it.
   */
  saveScript(workspaceId: string, id: string, source: string): Promise<FlowScripts>;
  /**
   * Which editor this flow opens in. A view preference and nothing else — no
   * graph is converted either way — so it is an ordinary PATCH rather than an
   * endpoint of its own.
   */
  setLayoutMode(workspaceId: string, id: string, mode: FlowLayoutMode): Promise<FlowRecord | undefined>;
  /** Refuses the main flow: it is the module's entry point, not one of its flows. */
  delete(workspaceId: string, id: string): Promise<void>;
}

/**
 * The script endpoint's answer. Two files with their own timestamps, and the
 * two lists the panel's rail is built from.
 */
interface ScriptsDto {
  script: string;
  scriptUpdatedAt: string | null;
  library: string;
  libraryUpdatedAt: string | null;
  hooks: FlowScriptHook[];
  expressions: FlowExpressionUse[];
}

/*
 * Timestamps become sentences here, the house rule in `lib/utils/date`. Null
 * stays empty rather than becoming "hozir": a file nobody has ever saved has
 * no date, and printing one would answer a question the author did not ask
 * about a file that does not exist yet.
 */
function toScripts(dto: ScriptsDto): FlowScripts {
  return {
    flow: { source: dto.script ?? "", updatedAt: dto.scriptUpdatedAt ? formatRelative(dto.scriptUpdatedAt) : "" },
    library: { source: dto.library ?? "", updatedAt: dto.libraryUpdatedAt ? formatRelative(dto.libraryUpdatedAt) : "" },
    hooks: dto.hooks ?? [],
    expressions: dto.expressions ?? [],
  };
}

type SummaryDto = Omit<FlowSummary, "updatedAt"> & { updatedAt: string };
type RecordDto = Omit<FlowRecord, "updatedAt"> & { updatedAt: string };

function toSummary(dto: SummaryDto): FlowSummary {
  return { ...dto, updatedAt: formatRelative(dto.updatedAt) };
}

function toRecord(dto: RecordDto): FlowRecord {
  return { ...dto, updatedAt: formatRelative(dto.updatedAt) };
}

/**
 * The main flow leads its module: it is where /start is answered, so it is
 * what the author should read first whatever order the rest is in.
 */
function mainFirst<T extends { isMain?: boolean }>(flows: T[]): T[] {
  return [...flows].sort((left, right) => Number(right.isMain ?? false) - Number(left.isMain ?? false));
}

class ApiFlowsRepository implements FlowsRepository {
  async list(workspaceId: string): Promise<FlowSummary[]> {
    const rows = await apiList<SummaryDto>("/api/flows/", { workspaceId });
    return rows.map(toSummary);
  }

  async listByModule(workspaceId: string, botId: string, moduleKey: ModuleKey): Promise<FlowSummary[]> {
    const rows = await apiList<SummaryDto>("/api/flows/", { workspaceId, params: { botId, moduleKey } });
    return mainFirst(rows.map(toSummary));
  }

  async listByBot(workspaceId: string, botId: string): Promise<FlowSummary[]> {
    const rows = await apiList<SummaryDto>("/api/flows/", { workspaceId, params: { botId } });
    return mainFirst(rows.map(toSummary));
  }

  async listRecordsByModule(workspaceId: string, botId: string, moduleKey: ModuleKey): Promise<FlowRecord[]> {
    const rows = await apiList<RecordDto>("/api/flows/", {
      workspaceId,
      params: { botId, moduleKey, withGraph: 1 },
    });
    return mainFirst(rows.map(toRecord));
  }

  async listRecent(workspaceId: string, limit = 5): Promise<FlowSummary[]> {
    // The API already orders by "last touched", so recency is a limit, not a sort.
    const rows = await apiList<SummaryDto>("/api/flows/", { workspaceId, params: { limit } });
    return rows.slice(0, limit).map(toSummary);
  }

  async getById(workspaceId: string, id: string): Promise<FlowRecord | undefined> {
    const dto = await apiFind<RecordDto>(`/api/flows/${id}/`, { workspaceId });
    return dto && toRecord(dto);
  }

  async create(input: CreateFlowInput): Promise<FlowRecord> {
    // A new flow opens on its module's Handler already wired to a first reply,
    // not on a blank canvas — unless it arrived with a graph, which is how a
    // branch split out of another flow gets here.
    const graph = input.graph ?? createStarterGraph(input.moduleKey);
    const dto = await apiRequest<RecordDto>("/api/flows/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: {
        projectId: input.projectId,
        botId: input.botId,
        moduleKey: input.moduleKey,
        name: input.name || "Nomsiz oqim",
        description: input.description || "Yangi oqim",
        nodes: graph.nodes,
        edges: graph.edges,
        ...(input.origin ? { origin: input.origin } : {}),
      },
    });

    // Switching on is its own decision on the backend (an empty flow may not
    // run, and the plan is checked here), so a template that arrives complete
    // asks for it separately — and a refusal is *not* a failed creation. The
    // flow exists either way; throwing here left the author looking at an
    // error page for a flow that had in fact been made, with no way back to
    // it and every reason to build a duplicate.
    if (input.enabled) {
      try {
        const enabled = await this.setEnabled(input.workspaceId, dto.id, true);
        if (enabled) return enabled;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    return toRecord(dto);
  }

  async ensureMainFlow(input: EnsureMainFlowInput): Promise<FlowRecord> {
    // The interface owns the block schema, so it hands over the graph the entry
    // point should be built from; the backend keeps the "exactly one" rule.
    const graph = createStarterGraph("dms", { main: true });
    const dto = await apiRequest<RecordDto>("/api/flows/main/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: { botId: input.botId, nodes: graph.nodes, edges: graph.edges },
    });
    return toRecord(dto);
  }

  async runScript(
    workspaceId: string,
    source: string,
    inputs: Record<string, unknown>,
    botId?: string | null,
  ): Promise<ScriptRunResult> {
    return apiRequest<ScriptRunResult>("/api/flows/script/run/", {
      method: "POST",
      workspaceId,
      // Left out rather than sent empty: the endpoint answers 404 for a bot it
      // cannot find, and "" is not a bot.
      body: botId ? { source, inputs, botId } : { source, inputs },
    });
  }

  async scripts(workspaceId: string, id: string): Promise<FlowScripts | undefined> {
    const dto = await apiFind<ScriptsDto>(`/api/flows/${id}/script/`, { workspaceId });
    return dto && toScripts(dto);
  }

  async saveScript(workspaceId: string, id: string, source: string): Promise<FlowScripts> {
    const dto = await apiRequest<ScriptsDto>(`/api/flows/${id}/script/`, {
      // PUT, not PATCH: what was edited is the whole file, and a partial write
      // of a source file is not a thing that exists.
      method: "PUT",
      workspaceId,
      body: { script: source },
    });
    return toScripts(dto);
  }

  async saveGraph(
    workspaceId: string,
    id: string,
    graph: { nodes: FlowNode[]; edges: FlowEdge[]; name: string; description: string },
  ): Promise<{ record: FlowRecord; expressionWarnings: ExpressionWarning[] } | undefined> {
    const dto = await apiFind<RecordDto & { expressionWarnings?: ExpressionWarning[] }>(`/api/flows/${id}/graph/`, {
      method: "PUT",
      workspaceId,
      // The name travels with the canvas because it is edited beside it and by
      // the same autosave. It used to be left out, so a renamed flow kept its
      // new name until the tab was closed and reopened as «Nomsiz oqim».
      body: { nodes: graph.nodes, edges: graph.edges, name: graph.name, description: graph.description },
    });
    // The warnings ride the save on purpose: they are about the graph that was
    // just written, and a second request would be answering about a different
    // one by the time an autosave debounce is involved.
    return dto && { record: toRecord(dto), expressionWarnings: dto.expressionWarnings ?? [] };
  }

  async setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<FlowRecord | undefined> {
    const dto = await apiFind<SummaryDto>(`/api/flows/${id}/enable/`, {
      method: "POST",
      workspaceId,
      body: { enabled },
    });
    if (!dto) return undefined;
    return this.getById(workspaceId, id);
  }

  async setLayoutMode(workspaceId: string, id: string, mode: FlowLayoutMode): Promise<FlowRecord | undefined> {
    return apiFind<RecordDto>(`/api/flows/${id}/`, {
      method: "PATCH",
      workspaceId,
      body: { layoutMode: mode },
    }).then((dto) => (dto ? toRecord(dto) : undefined));
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    // Deleting the entry point would leave the module answering nothing; the
    // backend refuses it too, so a hand-made request cannot do what the card
    // will not.
    await apiFind(`/api/flows/${id}/`, { method: "DELETE", workspaceId });
  }
}

export const flowsRepository: FlowsRepository = new ApiFlowsRepository();
