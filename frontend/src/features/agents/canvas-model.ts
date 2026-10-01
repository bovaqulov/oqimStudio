import type { IconName } from "@/components/ui/icon-names";
import { AGENT_OUTCOMES, AGENT_OUTCOME_COLOR, AGENT_OUTCOME_LABEL } from "./outcomes";
import type { AgentDraft, AgentOutcome, AgentTool, AgentToolKind } from "./types";

/**
 * The agent, drawn as a graph — derived from the columns it already has.
 *
 * ## Why there is no stored graph
 *
 * The obvious shape for a canvas is a `graph` column: nodes with positions,
 * edges with ids, saved beside the agent the way a flow saves its own. That is
 * the wrong shape here, and `apps/agents/services.py::run_agent` is the
 * argument:
 *
 *  * **Nothing walks an edge.** Every enabled tool is handed to the model at
 *    once (`schemas = [schema_for(tool) for tool in enabled_tools]`) and the
 *    model decides which to call. There is no dispatch order to draw, no
 *    condition on a wire, no port a result leaves by.
 *  * **The exit is computed, not routed.** `answered` / `unclear` / `handoff`
 *    come out of the guard's verdict, the tool loop and `_failure_port` —
 *    which reads one boolean, `escalateOnFailure`. An edge into an exit would
 *    be a picture of a decision made somewhere else.
 *  * **A line that controls nothing but is saved anyway is a lie on a canvas**,
 *    and this tree has paid for that class of bug more than once (see the root
 *    `CLAUDE.md` on `check:effects` and the flow editor's stale-edge traps).
 *
 * So the canvas is a **second reading of the same fields**, not a second
 * source of truth. Every node is computed from `AgentDraft` and every edit
 * writes back into `AgentDraft`; the save posts the same payload the form
 * always posted, to the same action, into the same serializer. No migration,
 * no `graph` column, nothing for the runtime to disagree with.
 *
 * The one thing on the canvas that *is* stored is the order of the tool cards:
 * `AgentSerializer._write_tools` renumbers `AgentTool.order` from the array
 * index, and that order is the order the schemas reach the model in. So moving
 * a tool card up is a real edit; moving any other node is not, which is why
 * nothing here is draggable — there are no positions to save, and a canvas
 * that let an author arrange cards and then forgot the arrangement would be
 * the same lie from the other end.
 *
 * ## Where the lines do mean something
 *
 * They mean *containment*, and they are read top to bottom: who the agent is,
 * what it is told, what it may reach for, what bounds it, where it comes out.
 * That is the order `_run` actually applies them in — the system prompt is
 * built, the tools are attached, the budgets are checked, an exit is taken.
 */

/**
 * One node kind on the agent canvas.
 *
 * Every node on the *spine* uses its kind as its id (`"persona"`, `"limits"`,
 * …), which is what lets `FIELD_HOME` below double as the map from a refused
 * field to the card the reader has to open. Only the branch cards need ids of
 * their own, and they carry an index (`tool:0`).
 */
export type AgentNodeKind =
  | "persona"
  | "instructions"
  | "knowledge"
  | "tools"
  | "tool"
  | "limits"
  | "outputs";

/**
 * Every field a save writes, and the node that edits it.
 *
 * A `Record` over `keyof AgentDraft` on purpose: a field added to the draft
 * without a node to edit it fails `npm run typecheck` here, rather than
 * becoming a column no screen can reach. That is the whole guarantee the
 * canvas rests on — it is the *only* editor now, so a homeless field is a
 * setting the author has lost.
 */
export const FIELD_HOME: Record<keyof AgentDraft, AgentNodeKind | "screen"> = {
  // Decided by the screen that opened the editor — the project's own
  // «Resurslar» tab — and carried through as a hidden field. There is no node
  // for it because moving an agent between folders is not something this
  // canvas does.
  projectId: "screen",
  name: "persona",
  persona: "persona",
  enabled: "persona",
  instructions: "instructions",
  tools: "tools",
  model: "limits",
  effort: "limits",
  maxTurns: "limits",
  maxOutputTokens: "limits",
  dailyTokenBudget: "limits",
  historyDepth: "limits",
  replyMaxChars: "limits",
  escalateOnFailure: "outputs",
};

/** What each tool kind is called, and the one line explaining what it may do. */
export const TOOL_KIND_META: Record<AgentToolKind, { label: string; icon: IconName; color: string; hint: string }> = {
  http: {
    label: "Ma'lumot olish (HTTP)",
    icon: "globe-hemisphere-west",
    // The «HTTP so'rov» block's own colour: this tool runs that block's code.
    color: "#6fb9c4",
    hint: "Siz yozgan manzilga so'rov yuboradi. Agent faqat siz belgilagan parametrlarni to'ldiradi — manzilni o'zgartira olmaydi.",
  },
  save: {
    label: "Ma'lumotni saqlash",
    icon: "bookmark-simple",
    color: "#7fbf9a",
    hint: "Bitta o'zgaruvchini kontaktga yozadi. Nomini siz belgilaysiz, qiymatini agent to'ldiradi.",
  },
  handoff: {
    label: "Operatorga uzatish",
    icon: "headset",
    color: "#d99a9a",
    hint: "Agent odam kerakligini aytadi. Blok «Operatorga» chiqishidan ketadi — nima bo'lishini oqimda siz chizasiz.",
  },
};

/** One exit drawn on the «Chiqishlar» node. */
export interface AgentNodePort {
  id: AgentOutcome;
  label: string;
  color: string;
  /** How many of the traced turns left by this exit, when a trace was read. */
  count?: number;
  /** True for the exit `escalateOnFailure` currently points failures at. */
  carriesFailures: boolean;
}

/** One card on the canvas. */
export interface AgentNode {
  id: string;
  kind: AgentNodeKind;
  title: string;
  icon: IconName;
  color: string;
  /** What this node currently holds, in one or two lines. */
  summary: string;
  /** Something that will not work until the author fixes it. */
  problem?: string;
  /** A tone-neutral pill on the card — «O'chirilgan», «Hali yo'q». */
  badge?: string;
  /**
   * Drawn dashed and dimmed. Reserved for a node that names something the
   * product does not have yet, so the shape of the answer is visible without
   * the card pretending to be one. It still opens — onto an explanation of
   * what to do instead — because the card raises a question and refusing the
   * press would leave the reader holding it.
   */
  pending?: boolean;
  /** Index into `draft.tools` — tool nodes only. */
  toolIndex?: number;
  /** The exits — the «Chiqishlar» node only. */
  ports?: AgentNodePort[];
  /** How tall the card is drawn, so the layout needs no measuring. */
  height: number;
  children: AgentNode[];
}

/**
 * Card geometry.
 *
 * The heights are fixed and the text clamps into them, so the layout is
 * arithmetic and never a measurement — no `ResizeObserver`, no second render
 * pass, no cards jumping as a font loads. They are sized for the *worst* case
 * each kind can hold (a two-line summary plus a two-line problem at 12/16),
 * because a card that outgrows its box is clipped: the panel still has the
 * whole text, but the canvas would be quietly hiding the end of a warning.
 */
export const NODE_WIDTH = 268;
const COLUMN_GAP = 74;
const ROW_GAP = 24;
const CANVAS_PAD = 18;
const PORT_ROW_HEIGHT = 26;
const ADD_SLOT_HEIGHT = 56;

/** The tool name rule, as `AgentToolSerializer.validate_name` enforces it. */
const TOOL_NAME = /^\p{L}[\p{L}\p{N}_]*$/u;

/** The `{holes}` an author left in a tool's URL template. */
function placeholders(url: string): string[] {
  return [...url.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

/**
 * What is wrong with one tool, in the words of the failure it will actually
 * produce.
 *
 * Every line here names a refusal that already exists on the backend — a URL
 * `_run_http` calls unconfigured, a hole `_fill_url` will not fill, a name
 * `validate_name` answers 400 to. Saying it on the card is the only difference:
 * without it the first two are discovered by a customer, in a trace, as
 * «Ma'lumot olinmadi».
 */
export function toolProblem(tool: AgentTool): string | undefined {
  const name = tool.name.trim();
  if (!name) return "Nomi yozilmagan — agent bu vositani chaqira olmaydi";
  if (!TOOL_NAME.test(name)) return "Nomi harfdan boshlanib, faqat harf, raqam va _ dan iborat bo'lsin";

  if (tool.kind === "save" && !(tool.config.variable ?? "").trim()) {
    return "O'zgaruvchi nomi yozilmagan — saqlash ishlamaydi";
  }

  if (tool.kind === "http") {
    const url = (tool.config.url ?? "").trim();
    if (!/^https?:\/\/.+/.test(url) || url === "https://") return "Manzil yozilmagan — so'rov yuborilmaydi";
    const params = tool.config.params ?? [];
    const declared = new Set(params.map((param) => param.name.trim()).filter(Boolean));
    const unfilled = placeholders(url).filter((hole) => !declared.has(hole));
    if (unfilled.length) return `Manzildagi {${unfilled[0]}} uchun parametr yo'q — so'rov yuborilmaydi`;
    if (params.some((param) => !param.name.trim())) return "Bir parametrning nomi bo'sh — u e'tiborga olinmaydi";
    const emptyEnum = params.find((param) => param.type === "enum" && !(param.enum ?? []).length);
    if (emptyEnum) return `«${emptyEnum.name}» ro'yxati bo'sh — agent hech qanday qiymat bera olmaydi`;
  }

  return undefined;
}

/**
 * The name collisions one save cannot satisfy.
 *
 * `_write_tools` refuses these with a 400 and it is right to: the name is what
 * the model calls and what the trace is read by, and which of two rows keeps it
 * is a question only the author can answer. Refused *after* a save today, which
 * means the author finds out by losing a press of the button — so the canvas
 * marks both cards instead.
 *
 * Lowercased before comparing, because `validate_name` lowercases before
 * storing: «Saqla» and «saqla» are the same collision.
 */
export function duplicateToolNames(tools: AgentTool[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of tools) {
    const name = tool.name.trim().toLowerCase();
    if (!name) continue;
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return duplicates;
}

/** One tool's destination, as the card prints it: the author's half of the contract. */
function toolSummary(tool: AgentTool): string {
  if (tool.kind === "http") return (tool.config.url ?? "").trim() || "Manzil yozilmagan";
  if (tool.kind === "save") {
    const variable = (tool.config.variable ?? "").trim();
    return variable ? `{${variable}} ga yoziladi` : "O'zgaruvchi tanlanmagan";
  }
  return "Turni tugatadi va «Operatorga» chiqishiga o'tadi";
}

/** The first line of a longer text, trimmed for a card. */
function firstLine(text: string): string {
  const line = text.trim().split("\n").find((row) => row.trim()) ?? "";
  return line.trim();
}

export interface AgentGraphContext {
  /** What the picked model is called, for the limits card. */
  modelLabel?: string;
  /** Tokens spent today against the budget — read off the trace by the API. */
  usage?: { tokensToday: number; budget: number };
  /** How many traced turns took each exit. Absent on a new agent. */
  outcomes?: Record<AgentOutcome, number>;
}

/**
 * The whole graph, as a spine of nodes with their branches hanging off them.
 *
 * Pure: same draft in, same tree out, no state and nothing stored. That is what
 * makes the canvas and the payload incapable of disagreeing.
 */
export function buildAgentGraph(draft: AgentDraft, context: AgentGraphContext = {}): AgentNode[] {
  const tools = draft.tools;
  const duplicates = duplicateToolNames(tools);
  const enabledCount = tools.filter((tool) => tool.enabled).length;

  const instructionText = draft.instructions.trim();
  const persona: AgentNode = {
    id: "persona",
    kind: "persona",
    title: draft.name.trim() || "Nomsiz agent",
    icon: "user-circle",
    // The «AI agent» block's own violet: this card is that block's other end.
    color: "#8f7fe8",
    summary: draft.persona.trim() || "Bir qatorlik izoh yo'q — o'zingiz uchun yozib qo'ying",
    problem: draft.name.trim() ? undefined : "Nom yozilmaguncha saqlab bo'lmaydi",
    badge: draft.enabled ? undefined : "O'chirilgan",
    height: 104,
    children: [],
  };

  const knowledge: AgentNode = {
    id: "knowledge",
    kind: "knowledge",
    title: "Bilim (RAG)",
    icon: "database",
    color: "#8f9aa3",
    // Said plainly rather than drawn as a working card with an empty list. A
    // card that promises something the product does not have is the most
    // expensive kind of card there is.
    summary: "Hali yo'q. Bugun agent biladigan narsa — ko'rsatmadagi matn va HTTP vositasi olib kelgan javob.",
    pending: true,
    badge: "Hali yo'q",
    height: 92,
    children: [],
  };

  const instructions: AgentNode = {
    id: "instructions",
    kind: "instructions",
    title: "Ko'rsatma",
    icon: "file-text",
    color: "#b5abfc",
    summary: instructionText
      ? firstLine(instructionText)
      : "Yozilmagan — modelga «(ko'rsatma yozilmagan)» beriladi",
    problem: instructionText ? undefined : "Ko'rsatmasiz agent nima qilishini bilmaydi",
    badge: instructionText ? `${instructionText.length} belgi` : undefined,
    height: 104,
    children: [knowledge],
  };

  const toolNodes: AgentNode[] = tools.map((tool, index) => {
    const meta = TOOL_KIND_META[tool.kind];
    const duplicate = duplicates.has(tool.name.trim().toLowerCase());
    return {
      id: `tool:${index}`,
      kind: "tool",
      title: tool.name.trim() || meta.label,
      icon: meta.icon,
      color: meta.color,
      summary: toolSummary(tool),
      problem: duplicate
        ? `«${tool.name.trim()}» nomi ikki marta ishlatilgan — saqlab bo'lmaydi`
        : toolProblem(tool),
      badge: tool.enabled ? undefined : "O'chirilgan",
      toolIndex: index,
      height: 116,
      children: [],
    };
  });

  const toolsHub: AgentNode = {
    id: "tools",
    kind: "tools",
    title: "Vositalar",
    icon: "puzzle-piece",
    color: "#5fc4b0",
    summary: tools.length
      ? `${enabledCount} ta yoqilgan${tools.length > enabledCount ? `, ${tools.length - enabledCount} ta o'chirilgan` : ""} — qaysi birini chaqirishni model o'zi hal qiladi`
      : "Vosita yo'q — agent faqat ko'rsatmasi asosida gapiradi",
    height: 92,
    children: toolNodes,
  };

  const budget = draft.dailyTokenBudget;
  const limits: AgentNode = {
    id: "limits",
    kind: "limits",
    title: "Chegaralar",
    icon: "timer",
    color: "#d2a75f",
    summary: [
      context.modelLabel || draft.model || "Model tanlanmagan",
      `${draft.maxTurns} qadam`,
      budget ? `kuniga ${budget.toLocaleString("uz-UZ")} token` : "kunlik chegara yo'q",
    ].join(" · "),
    // Uncapped is a decision an owner makes, not a state to drift into — the
    // same sentence `DEFAULT_DAILY_TOKEN_BUDGET` is written down for.
    problem: budget ? undefined : "Kunlik byudjet yo'q — bitta mijoz cheksiz sarflay oladi",
    badge: context.usage
      ? `Bugun ${context.usage.tokensToday.toLocaleString("uz-UZ")}${context.usage.budget ? ` / ${context.usage.budget.toLocaleString("uz-UZ")}` : ""}`
      : undefined,
    height: 104,
    children: [],
  };

  const failurePort: AgentOutcome = draft.escalateOnFailure ? "handoff" : "unclear";
  const ports: AgentNodePort[] = AGENT_OUTCOMES.map((outcome) => ({
    id: outcome,
    label: AGENT_OUTCOME_LABEL[outcome],
    color: AGENT_OUTCOME_COLOR[outcome],
    count: context.outcomes?.[outcome],
    carriesFailures: outcome === failurePort,
  }));

  const outputs: AgentNode = {
    id: "outputs",
    kind: "outputs",
    title: "Chiqishlar",
    icon: "git-branch",
    color: "#b3c47a",
    summary: draft.escalateOnFailure
      ? "Xatolik va javobsizlik — «Operatorga»"
      : "Xatolik va javobsizlik — «Tushunmadi»",
    ports,
    height: 78 + ports.length * PORT_ROW_HEIGHT,
    children: [],
  };

  return [persona, instructions, toolsHub, limits, outputs];
}

/** A node with the place it is drawn. */
export interface PlacedAgentNode extends AgentNode {
  x: number;
  y: number;
}

/** One connector, already routed. */
export interface AgentLink {
  id: string;
  path: string;
  /** A branch line is quieter than the spine: it says "belongs to", not "then". */
  branch: boolean;
}

/**
 * Where the «+ Vosita» card goes — the end of the tool column.
 *
 * Part of the layout rather than something the canvas positions itself,
 * because it is the one place on the graph where a node can be *added*, and
 * that spot has to be the next place the eye already is: under the last tool,
 * on the same rail. A hub with no children and no slot under it reads as a
 * dead end, which is exactly what an agent with no tools is not.
 */
export interface AgentAddSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The connector into it, from the hub it belongs to. */
  path: string;
}

export interface AgentLayout {
  nodes: PlacedAgentNode[];
  links: AgentLink[];
  addSlot: AgentAddSlot | null;
  width: number;
  height: number;
}

/**
 * Where every card goes.
 *
 * The spine runs down the left in a single column and each node's branches sit
 * to its right, level with it. Top to bottom rather than the flow canvas's left
 * to right, because this graph is a short spine with wide shoulders — laid out
 * the other way it would be five columns deep and mostly empty, and because
 * reading it downwards is the same movement as reading the list a phone gets.
 */
export function layoutAgentGraph(spine: AgentNode[]): AgentLayout {
  const nodes: PlacedAgentNode[] = [];
  const links: AgentLink[] = [];
  const branchX = CANVAS_PAD + NODE_WIDTH + COLUMN_GAP;
  let addSlot: AgentAddSlot | null = null;
  let hasBranches = false;
  let y = CANVAS_PAD;
  let previousSpine: PlacedAgentNode | null = null;

  /** The curve from a hub's right edge into a card sitting in the branch column. */
  const branchPath = (parent: PlacedAgentNode, targetY: number, targetHeight: number): string => {
    const x1 = CANVAS_PAD + NODE_WIDTH;
    const y1 = parent.y + parent.height / 2;
    const y2 = targetY + targetHeight / 2;
    const reach = Math.max(28, (branchX - x1) * 0.55);
    return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${branchX - reach} ${y2}, ${branchX} ${y2}`;
  };

  for (const node of spine) {
    const placed: PlacedAgentNode = { ...node, x: CANVAS_PAD, y };
    nodes.push(placed);

    if (previousSpine) {
      // Straight down the middle: both cards are the same width in the same
      // column, so a curve here would be decoration pretending to be routing.
      const x = CANVAS_PAD + NODE_WIDTH / 2;
      links.push({
        id: `${previousSpine.id}->${placed.id}`,
        path: `M ${x} ${previousSpine.y + previousSpine.height} L ${x} ${placed.y}`,
        branch: false,
      });
    }
    previousSpine = placed;

    let childY = y;
    for (const child of node.children) {
      hasBranches = true;
      nodes.push({ ...child, x: branchX, y: childY });
      links.push({
        id: `${placed.id}->${child.id}`,
        path: branchPath(placed, childY, child.height),
        branch: true,
      });
      childY += child.height + ROW_GAP;
    }

    if (node.kind === "tools") {
      hasBranches = true;
      addSlot = {
        x: branchX,
        y: childY,
        width: NODE_WIDTH,
        height: ADD_SLOT_HEIGHT,
        path: branchPath(placed, childY, ADD_SLOT_HEIGHT),
      };
      childY += ADD_SLOT_HEIGHT + ROW_GAP;
    }

    const bottom = Math.max(y + node.height, childY > y ? childY - ROW_GAP : 0);
    y = bottom + ROW_GAP;
  }

  return {
    nodes,
    links,
    addSlot,
    width: (hasBranches ? branchX + NODE_WIDTH : CANVAS_PAD + NODE_WIDTH) + CANVAS_PAD,
    height: y - ROW_GAP + CANVAS_PAD,
  };
}

/** Every problem on the canvas, so the action bar can say how many are left. */
export function graphProblems(spine: AgentNode[]): string[] {
  const walk = (nodes: AgentNode[]): string[] =>
    nodes.flatMap((node) => [...(node.problem ? [node.problem] : []), ...walk(node.children)]);
  return walk(spine);
}
