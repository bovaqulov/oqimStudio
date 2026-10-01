/**
 * What an AI agent is, on this side of the wire.
 *
 * The same shape `backend/apps/agents/serializers.py` emits, camelCase
 * included — the two halves match on purpose, so a screen and an endpoint can
 * only disagree if one of them changed without the other.
 *
 * The split worth understanding before editing either half: **the block holds
 * an id and nothing else** (`AgentBlockConfig` in `features/flows/types.ts`).
 * Who the agent is, what it may do and what it may spend live here, once per
 * project, because an author who fixes a wording should fix it in one place
 * and have every flow that calls the agent get the fix.
 *
 * Once per *project* and not once per workspace: an account can hold a
 * clinic's bots and a shop's, and an instruction written for one of them is
 * wrong in the other. A flow may only call an agent of its own project — the
 * picker offers no others, and the runtime refuses a graph that names one
 * anyway (`backend/apps/agents/services.py`).
 */

/** What a tool does, and therefore which block's code path actually runs. */
export type AgentToolKind = "http" | "save" | "handoff";

/**
 * One argument the model is allowed to fill in on an HTTP tool.
 *
 * The model never supplies a destination — the URL is the author's and lives
 * on the tool. It supplies values for parameters somebody drew, and each one
 * is checked against this declaration before anything runs. That is why the
 * type list is short and closed: an `enum` is the strongest of them, because
 * the model can only ever pass one of the strings written down here.
 */
export interface AgentToolParam {
  name: string;
  /** What the author calls it in the editor. */
  label?: string;
  /** What the *model* is told it is for. */
  description?: string;
  type: "string" | "number" | "enum";
  required?: boolean;
  /** Only for `type: "enum"` — the closed list of accepted values. */
  enum?: string[];
  /** Only for `type: "string"`. 200 when unset. */
  maxLength?: number;
}

/**
 * Per-kind settings. Every field is optional here because one interface covers
 * three kinds; the backend reads only the ones its kind uses.
 */
export interface AgentToolConfig {
  /** `http`: the endpoint, with `{param}` holes the arguments fill. */
  url?: string;
  /** `http`: the arguments the model may pass. */
  params?: AgentToolParam[];
  /** `save`: which contact variable is written. The name is the author's; only the value is the model's. */
  variable?: string;
}

export interface AgentTool {
  /** Absent on a tool that has not been saved yet. */
  id?: string;
  kind: AgentToolKind;
  /** The identifier the model sees: a letter first, then letters, digits and `_`. */
  name: string;
  /** Written for the model — this is the one place an author's words reach the prompt. */
  description: string;
  config: AgentToolConfig;
  enabled: boolean;
  order?: number;
}

/** What the agent has spent today, against what it is allowed. */
export interface AgentUsage {
  tokensToday: number;
  /** 0 means uncapped. */
  budget: number;
}

export interface AgentRecord {
  id: string;
  /**
   * The project this agent belongs to, and the bounds of what may call it.
   * Required on a create; writable, so an agent can be moved between folders
   * the way a bot can.
   */
  projectId: string;
  name: string;
  /** One line for the author and the card. Never sent to the model. */
  persona: string;
  /** The system instruction, verbatim and alone — see `services.build_system_prompt`. */
  instructions: string;
  model: string;
  effort: string;
  maxTurns: number;
  maxOutputTokens: number;
  /** Tokens per rolling day, across every conversation. 0 is uncapped. */
  dailyTokenBudget: number;
  historyDepth: number;
  replyMaxChars: number;
  /**
   * Where a failure goes: true sends it to the block's «operatorga» exit,
   * false to «tushunmadi». The author's call, because it depends on whether
   * there is anybody on the other end of a handover at two in the morning.
   */
  escalateOnFailure: boolean;
  enabled: boolean;
  tools: AgentTool[];
  usage: AgentUsage;
  updatedAt: string;
}

/** One model an agent may run on, as `/api/agents/status/` describes it. */
export interface AgentModelOption {
  id: string;
  label: string;
  hint: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  contextTokens: number;
  /** False means this model rejects `effort` outright, so the control is hidden. */
  supportsEffort: boolean;
}

/**
 * Whether this deployment can run an agent at all.
 *
 * Three states and not two. `available` false with a `reason` is a machine
 * with no API key — the block says so and takes its exit, and nothing else in
 * the runtime changes. `offline` true is the deliberate local mode: the whole
 * path works and no request leaves the machine.
 */
export interface AgentStatus {
  available: boolean;
  offline: boolean;
  reason: string;
  defaultModel: string;
  defaultEffort: string;
  effortLevels: string[];
  models: AgentModelOption[];
}

/** Which exit the block took. */
export type AgentOutcome = "answered" | "unclear" | "handoff";

export interface AgentRunMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool_use" | "tool_result";
  text: string;
  /** Tool arguments as validated, the tool's answer, or why a call was rejected. */
  payload: Record<string, unknown>;
  at: string;
}

/** One turn of one agent — the trace that answers "why did it say that". */
export interface AgentRunRecord {
  id: string;
  agentId: string;
  flowRunId: string | null;
  contactId: string | null;
  contactName: string;
  nodeId: string;
  outcome: AgentOutcome;
  /** `AgentRun.Reason` — why that exit, which the outcome alone cannot say. */
  reason: string;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  reply: string;
  error: string;
  isTest: boolean;
  startedAt: string;
  messages: AgentRunMessage[];
}

/** The fields a save actually writes. The trace and the usage are read-only. */
export type AgentDraft = Omit<AgentRecord, "id" | "usage" | "updatedAt">;
