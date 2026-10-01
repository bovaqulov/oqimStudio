import type { FlowEdge, FlowNode, ModuleKey } from "./types";

/**
 * A graph moving in or out of the studio as JSON.
 *
 * Kept out of `types.ts`, which describes what a flow *is*, and out of
 * `transfer-actions.ts`, which may only export async functions — a plain
 * `interface` in a `"use server"` module is a build error the moment a client
 * component imports it, the same reason `bots/form-state.ts` exists.
 *
 * Everything here is what the backend sends, so it is also what an author's
 * hand-written file may claim to be. Nothing below is trusted: the fields that
 * arrive from a paste are read through the guards in `import-json.ts`, and the
 * ones that arrive from our own API are still typed loosely where the contract
 * leaves a shape open.
 */

export type ImportSeverity = "error" | "warning";

/**
 * One thing wrong with a pasted graph.
 *
 * `nodeId` is the whole point of the list. A validator that answers "invalid
 * graph" leaves the author re-reading forty blocks of JSON by eye; one that
 * answers "«s1»" tells them which of the forty to open — and a graph written
 * by another AI is one nobody has read line by line in the first place.
 */
export interface ImportFinding {
  severity: ImportSeverity;
  /** Stable backend vocabulary — `unknown_type`, `dangling_edge`. Not printed; branch on it, not on the sentence. */
  code: string;
  /** The block it is about, when it is about one. Graph-wide findings have none. */
  nodeId?: string | null;
  /** The connection it is about. A dangling edge belongs to no block, and naming one would be a guess. */
  edgeId?: string | null;
  message: string;
}

/** What an import would create, counted before it creates it. */
export interface ImportSummary {
  nodes: number;
  edges: number;
  /**
   * How many blocks of each type. A plain record and not `Record<NodeType, number>`:
   * the graph may name a type this build has never heard of, which is precisely
   * the case the preview has to be able to draw.
   */
  types: Record<string, number>;
}

export interface ImportValidation {
  /** False when any finding is an error. Warnings leave it true. */
  ok: boolean;
  findings: ImportFinding[];
  summary: ImportSummary;
}

export interface FlowSchemaNodeType {
  type: string;
  label: string;
  /** What a card's header says — shorter than `label`, and the name the findings quote. */
  kindLabel?: string;
  /**
   * The exits an edge may leave this block by, and only the unconditional ones.
   * A block's buttons publish `btn:<id>` each and a back row publishes `back`;
   * neither can be listed here, because both are read off a block's contents.
   */
  ports: string[];
  /** Whether a flow may start here — and nothing may route *into* such a block. */
  entry: boolean;
  buttonPorts: boolean;
  backPort?: boolean;
  /** What the body field is called on this block, absent where it has none. */
  bodyLabel?: string | null;
  /** Whether an empty body here means the block sends nothing at run time. */
  bodyRequired?: boolean;
  /**
   * Field name to the one line saying what goes in it. A map and not a list:
   * the sentences are the half worth having — a model handed bare field names
   * fills them with plausible nonsense — so they travel into the prompt whole.
   */
  fields: Record<string, string>;
}

export interface FlowSchema {
  version: number;
  /** The backend's own instructions, written to be pasted into another model. */
  howTo: string;
  nodeTypes: FlowSchemaNodeType[];
}

/** One flow, as the export endpoint hands it over. */
export interface FlowExport {
  schemaVersion: number;
  name: string;
  description: string;
  moduleKey: ModuleKey;
  graph: { nodes: FlowNode[]; edges: FlowEdge[] };
  /**
   * The flow's own JavaScript — its hooks, travelling with the graph so a round
   * trip returns the flow that left.
   *
   * Optional because the export leaves the key out altogether for a flow with
   * no code, rather than sending `""`: the file's second job is to be pasted
   * into another model as a worked example, and an empty `script` sitting in
   * one is an invitation to fill it. Absent and empty say the same thing here.
   */
  script?: string;
}

/**
 * The answer the panel gets from a validation run.
 *
 * A transport failure is its own case rather than a synthetic error finding:
 * "server javob bermadi" is not something wrong with the author's graph, and
 * listing it beside `unknown_type` would send them editing a file that is fine.
 */
export type FlowImportCheck =
  | { status: "checked"; validation: ImportValidation }
  | { status: "error"; message: string };

/**
 * The answer the import form gets back.
 *
 * There is no success status: a created flow redirects to its own canvas, so a
 * state nothing ever renders would be a lie about what can happen — the same
 * reasoning as `ConnectBotState`.
 */
export interface FlowImportState {
  status: "idle" | "error";
  message?: string;
  /**
   * When it was refused. Two refusals with the same words are two events, and
   * a state that cannot tell them apart shows the toast once and then goes
   * quiet on every retry.
   */
  failedAt?: number;
}

export const FLOW_IMPORT_INITIAL_STATE: FlowImportState = { status: "idle" };
