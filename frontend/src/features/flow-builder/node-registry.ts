import type { IconName } from "@/components/ui/Icon";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowButton, FlowEdge, FlowNode, ModuleKey, NodeType } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { buttonIdFromPort, buttonPortId, isRoutableButton, effectiveButtonMode, nodeButtons } from "./lib/buttons";
import { createAiConfig } from "./lib/ai";
import {
  RATING_VARIABLE,
  SUBSCRIPTION_CHECK_LABEL,
  SUBSCRIPTION_RETRY_TEXT,
  createLanguageOptions,
} from "./lib/message-content";
import { stripMarkdown } from "./lib/markdown";
import { createBusinessTrigger, DEFAULT_DMS_KINDS } from "./lib/trigger";

import {
  NODE_TYPE_DEFINITIONS,
} from "./node-definitions";

export * from "./node-definitions";

/**
 * Default numbered palette order — flowlink has its own dedicated palette
 * button instead of a number.
 *
 * The Handler is not here: a flow arrives with the one it is allowed to have
 * (see [[applyEntryRule]]), so a palette row that adds a second one would only
 * offer a block the editor takes straight back.
 */
const DEFAULT_NODE_TYPES: NodeType[] = [
  "message",
  /*
   * Second, right under «Xabar», because it is the other half of the same
   * sentence: a bot says something and then asks something. Buried, it is not
   * findable — the block was reached for as «Kutish» (which is a pause in
   * minutes) and as «Ma'lumotni saqlash → Javobni saqlash» (which saves the
   * message that already arrived), and both of those were the wrong block for
   * the most common thing a bot does.
   */
  "question",
  "condition",
  "delay",
  "tag",
  /*
   * No «Ma'lumot yozish» / «Ma'lumot o'qish» here.
   *
   * The two table blocks still exist — `node-definitions` describes them, the
   * runtime walks them (`engine/runner._handle_tablerow`, `_handle_tableread`),
   * and a flow that already has one keeps working, opens in the inspector and
   * saves. They are only no longer *offered*: this list is what the palette
   * shows, what the digit keys index and what a block may be converted into,
   * and it decides nothing about what is valid.
   *
   * Taking them out is why that distinction is worth stating. A palette entry
   * removed is a feature withdrawn from new flows; a node type removed would
   * be a flow already using it that no longer opens.
   */
  "language",
  "followup",
  "ai",
  "http",
  // Last, and after every block that does something: it is read as the full
  // stop at the bottom of the list rather than as one more thing a step can be.
  //
  // Tenth now, so it is the one block with no number key — `1`…`9` index this
  // array. That is the right one to lose: a flow is ended far more often by
  // wiring nothing than by adding this block, and the palette row is a click.
  "end",
];

/**
 * Per-module palette contents — the blocks an author adds, which is to say
 * everything except the flow's own entry block (see [[applyEntryRule]]).
 *
 * `dms`/`business`/`webapp` open on a Handler and so list none of the entry
 * blocks at all; what differs between them is only which config panel the
 * Inspector renders inside that Handler (see `hasTriggerConfig` +
 * `Inspector.tsx`, branched on the flow's `moduleKey`: `BusinessTriggerField`
 * for `business`, `DmsTriggerField` for `dms`).
 *
 * `groups`/`channels`/`webapp` are `comingSoon` in `features/bots/modules.ts`
 * right now — unreachable from the UI — but their block sets stay defined here
 * so a module can be un-flagged later without rebuilding this part:
 *  - groups: adds `new_chat_members`/`left_chat_member` (delivered on
 *    `message`) and `chat_join_request` for approval-gated groups.
 *  - channels: only `channel_post`/`edited_channel_post` and
 *    `chat_join_request` exist — there's no per-user reply to capture, so
 *    `tag` (a contact-scoped block) is left out.
 * Modules not listed fall back to `DEFAULT_NODE_TYPES`.
 */
const MODULE_NODE_TYPES: Partial<Record<ModuleKey, NodeType[]>> = {
  groups: [
    "groupjoin",
    "groupleave",
    "joinrequest",
    "message",
    "question",
    "condition",
    "delay",
    "tag",
    "followup",
      "ai",
    "http",
    "end",
  ],
  // Ending a conversation is not a module's business — every flow finishes,
  // whatever surface it answers on — so the block is in every set.
  channels: ["channelpost", "joinrequest", "message", "condition", "delay", "ai", "http", "end"],
};

/** Numbered palette order for a given module (1…9 shortcuts follow this order). */
export function getPaletteNodeTypes(moduleKey: ModuleKey | null): NodeType[] {
  return (moduleKey && MODULE_NODE_TYPES[moduleKey]) || DEFAULT_NODE_TYPES;
}

/**
 * Which modules configure their Handler through `DmsTriggerConfig` — the
 * message-level filters: a command, a keyword, a content type, a button press.
 *
 * `business` is the exception with a shape of its own (`BusinessTriggerConfig`,
 * which adds the working-hours window), and `groups`/`channels` have no Handler
 * block at all — their entries are the dedicated event blocks. `webapp` belongs
 * here: a mini-app flow is opened by a command, by `web_app_data` or by a
 * successful payment, all of which are kinds of this config.
 */
export function usesDmsTrigger(moduleKey: ModuleKey | null): boolean {
  return moduleKey === "dms" || moduleKey === "webapp";
}

/**
 * Blocks whose keyboard a module cannot deliver, and why.
 *
 * A block type is one thing across the app — what a module changes is what
 * Telegram will accept for it. `business` is the case that has one: a reply
 * sent over a `business_connection_id` arrives as the account owner's *own*
 * message, and a message from a user carries no keyboard, so `sendMessage`
 * takes no `reply_markup` there. Xabar therefore has no buttons at all in that
 * module — no editor in the inspector, no rows on the card, no per-button
 * branches. Modules not listed keep every keyboard their block types allow.
 */
const MODULE_BUTTONLESS: Partial<Record<ModuleKey, { types: NodeType[]; reason: string }>> = {
  business: {
    types: ["message"],
    reason:
      "Biznes akkaunt nomidan yuborilgan xabar tugmalarni qo'llab-quvvatlamaydi — business_connection_id bilan reply_markup jo'natilmaydi.",
  },
};

/** Why this block has no keyboard in this module, in the user's language — `null` when it has one. */
export function buttonsUnsupportedReason(type: NodeType, moduleKey: ModuleKey | null): string | null {
  const rule = moduleKey ? MODULE_BUTTONLESS[moduleKey] : undefined;
  return rule?.types.includes(type) ? rule.reason : null;
}

/**
 * Whether a block carries a keyboard here: its own capability, minus the
 * module's rule. The one question the inspector, the new-block defaults and
 * the load-time cleanup all ask.
 */
export function nodeSupportsButtons(type: NodeType, moduleKey: ModuleKey | null): boolean {
  return NODE_TYPE_DEFINITIONS[type].hasButtons && !buttonsUnsupportedReason(type, moduleKey);
}

/**
 * The graph with keyboards the module cannot send stripped off, together with
 * the branches that hung off their buttons. Runs when a flow is loaded, so a
 * graph saved before its module gained the rule can never paint rows the
 * inspector has no editor for. Both arrays come back untouched when there is
 * nothing to drop.
 */
export function pruneUnsupportedButtons(
  nodes: FlowNode[],
  edges: FlowEdge[],
  moduleKey: ModuleKey | null,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const cleared = new Set<string>();
  const nextNodes = nodes.map((node) => {
    if (node.buttons === undefined || nodeSupportsButtons(node.type, moduleKey)) return node;
    cleared.add(node.id);
    const next = { ...node };
    delete next.buttons;
    delete next.buttonMode;
    return next;
  });
  if (!cleared.size) return { nodes, edges };
  // Only button ports go — "out"/"yes"/"no" belong to the block itself and survive.
  return {
    nodes: nextNodes,
    edges: edges.filter((edge) => !cleared.has(edge.from) || !buttonIdFromPort(edge.port)),
  };
}

/** The first free `nNN` id in a graph. */
function nextNodeId(nodes: FlowNode[]): string {
  const highest = nodes.reduce((max, node) => {
    const match = /^n(\d+)$/.exec(node.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `n${highest + 1}`;
}

/** The blocks a flow owns as its entry point — at most one of these survives per flow. */
const OWNED_ENTRY_TYPES: NodeType[] = ["start", "trigger"];

/**
 * The block a flow of this module opens on, or `null` where the module owns
 * none.
 *
 * `dms` is the one that splits: its main flow is the module's entry point and
 * opens on `/start`, while every other flow of that module opens on a Handler
 * with a condition of its own. `groups`/`channels` are the `null` case — their
 * entries are the dedicated event blocks (`groupjoin`, `channelpost`, …),
 * which are still ordinary palette blocks, so this rule leaves them alone.
 */
function entryTypeOf(context: { moduleKey: ModuleKey | null; isMain: boolean }): NodeType | null {
  if (context.moduleKey === "dms") return context.isMain ? "start" : "trigger";
  return context.moduleKey === "business" || context.moduleKey === "webapp" ? "trigger" : null;
}

/**
 * The same node with any claim on `/start` taken off it: a `/start` block
 * becomes an ordinary Handler waiting for a command name, and a Handler whose
 * config still lists the `start` kind loses that one kind.
 *
 * Whatever hangs off the block is the author's work, so nothing else about it
 * changes — including its name, once they have typed one. Returns the node
 * itself when there is nothing to take.
 */
/** How many words of the body a generated title borrows. */
const AUTO_TITLE_WORDS = 5;
/** Past this it stops being a name and starts being the text again. */
const AUTO_TITLE_MAX = 38;

/** The first few words of `body`, or the type's default when it has none. */
function nameFromBody(type: NodeType, body: string): string {
  const fallback = NODE_TYPE_DEFINITIONS[type].defaultTitle;
  const words = stripMarkdown(body ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return fallback;

  // Words, not characters: cutting at a character count lands mid-word and the
  // name reads as a typo. A single word longer than the budget is the one case
  // with nothing to cut back to, so that one is cut where it stands.
  const taken: string[] = [];
  for (const word of words.slice(0, AUTO_TITLE_WORDS)) {
    const grown = taken.length ? `${taken.join(" ")} ${word}` : word;
    if (taken.length && grown.length > AUTO_TITLE_MAX) break;
    taken.push(word);
  }
  let name = taken.join(" ");
  if (name.length > AUTO_TITLE_MAX) name = `${name.slice(0, AUTO_TITLE_MAX).trimEnd()}…`;
  else if (taken.length < words.length) name = `${name}…`;
  return name;
}

/**
 * The name a block carries when the author has not given it one.
 *
 * "Xabar", "Xabar", "Xabar" down a list tells a reader nothing about their own
 * flow — the first few words of what the block actually says do. A title the
 * author typed is never touched; this only ever replaces the default the
 * editor supplied or a name it generated itself on an earlier keystroke.
 *
 * That last clause is the whole reason `previousBody` exists. Without it the
 * test for "did the author name this?" was "is the title still the default?",
 * which the first typed character already fails: typing "Message" into an empty
 * Xabar renamed the block to "M" and then read "M" as a name the author chose
 * and left it there for good. Comparing against the name this function *would
 * have produced* from the body before the edit tells the two apart — a title
 * that matches is one of ours and keeps following the text, and one that does
 * not is the author's and is never touched again.
 */
export function autoTitleFor(type: NodeType, title: string, body: string, previousBody = ""): string {
  const fallback = NODE_TYPE_DEFINITIONS[type].defaultTitle;
  const current = (title ?? "").trim();

  // A block with no body field of its own — an invoice is built from its
  // product fields — has nothing to borrow that is not a generated summary,
  // and a card reading "Mahsulot nomi ki…" names the warning, not the block.
  // A title already taken from one of those summaries is this function's to
  // undo, so a block that was misnamed before gets its own name back the next
  // time its fields are touched; anything else is the author's and stays.
  if (NODE_TYPE_DEFINITIONS[type].bodyFieldLabel === null) {
    const generated = !current || current === nameFromBody(type, previousBody) || current === nameFromBody(type, body);
    return generated ? fallback : current;
  }

  const ours =
    !current ||
    current === fallback ||
    current.startsWith(fallback) ||
    current === nameFromBody(type, previousBody);
  if (!ours) return title;

  return nameFromBody(type, body);
}

/**
 * The title a block should carry once its type has changed.
 *
 * A name the author typed is theirs and survives; a name the editor supplied
 * follows the type, because a block that sends an invoice while its card still
 * reads "Xabar" is a card that lies about what runs. An empty title is treated
 * as unnamed rather than kept as a blank.
 */
export function retitleForType(title: string, from: NodeType, to: NodeType): string {
  const trimmed = (title ?? "").trim();
  const named = trimmed && trimmed !== NODE_TYPE_DEFINITIONS[from].defaultTitle;
  return named ? title : NODE_TYPE_DEFINITIONS[to].defaultTitle;
}

function withoutStartClaim(node: FlowNode): FlowNode {
  if (node.type === "start") {
    const handler = NODE_TYPE_DEFINITIONS.trigger;
    const named = node.title !== NODE_TYPE_DEFINITIONS.start.defaultTitle;
    return {
      ...node,
      type: "trigger",
      title: named ? node.title : handler.defaultTitle,
      text: handler.defaultText,
      dmsTrigger: { kinds: [...DEFAULT_DMS_KINDS] },
    };
  }
  const kinds = node.dmsTrigger?.kinds;
  if (node.type !== "trigger" || !kinds?.includes("start")) return node;
  const kept = kinds.filter((kind) => kind !== "start");
  return { ...node, dmsTrigger: { ...node.dmsTrigger, kinds: kept.length ? kept : [...DEFAULT_DMS_KINDS] } };
}

/**
 * How far left of the graph a supplied entry block lands — a card's width plus
 * the gap "Tartiblash" leaves between two columns, so the block it is dropped
 * beside does not have to move for it.
 */
const ENTRY_LEAD_X = 320;

/** The entry block a flow opens with when it arrived without one, on its module's defaults. */
function createEntryNode(type: NodeType, moduleKey: ModuleKey | null, nodes: FlowNode[]): FlowNode {
  const defaults = createNodeDefaults(type, moduleKey);
  return {
    id: nextNodeId(nodes),
    type,
    // Left of the graph rather than on top of it — the flow runs rightward, so
    // that is where it reads as the thing that comes first — and unwired: which
    // block the flow should answer with is the author's call, not a guess made
    // here.
    x: nodes.length ? Math.min(...nodes.map((node) => node.x)) - ENTRY_LEAD_X : 300,
    y: nodes.length ? Math.min(...nodes.map((node) => node.y)) : 40,
    title: defaults.title,
    text: defaults.text,
    channel: "tg",
    scopes: ["private"],
    ...(defaults.dmsTrigger ? { dmsTrigger: defaults.dmsTrigger } : {}),
    ...(defaults.business ? { business: defaults.business } : {}),
  };
}

export interface EntryRuleResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Entry blocks dropped because the flow already had the one it may have. */
  removed: number;
  /** The flow opened without an entry block and was given one back. */
  added: boolean;
}

/**
 * One entry block per flow, applied to a whole graph.
 *
 * A flow answers one thing: the main `dms` flow answers `/start`, and every
 * other flow answers the condition on its single Handler. That is what makes a
 * flow nameable — "the one that runs on «narx»" — and it is why the entry block
 * arrives with the flow instead of being added: there is nowhere in the editor
 * to make a second one, and no way to take the only one away.
 *
 * Enforced on load rather than only through the editor's controls, because a
 * graph can arrive from somewhere those controls never saw it — a save from
 * before the rule existed, a branch split out of another flow, a copy edited by
 * hand. A graph carrying several Handlers keeps the first one and loses the
 * rest; what hung off those stays on the canvas, unwired, for the author to
 * rewire or delete. A graph carrying none gets one back, since a flow with no
 * entry point answers nothing at all.
 */
export function applyEntryRule(
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: { moduleKey: ModuleKey | null; isMain: boolean },
): EntryRuleResult {
  const entryType = entryTypeOf(context);
  if (!entryType) return { nodes, edges, removed: 0, added: false };

  // `/start` belongs to the main flow and to nothing else, so anywhere the
  // entry is a Handler the block (and the kind) is demoted first — and then
  // takes its chances with every other Handler in the graph below.
  const claimed = entryType === "trigger" ? nodes.map(withoutStartClaim) : nodes;
  let nextNodes = claimed.some((node, index) => node !== nodes[index]) ? claimed : nodes;
  let nextEdges = edges;

  const keeper = nextNodes.find((node) => node.type === entryType);
  const dropped = new Set(
    nextNodes.filter((node) => node !== keeper && OWNED_ENTRY_TYPES.includes(node.type)).map((node) => node.id),
  );
  if (dropped.size) {
    nextNodes = nextNodes.filter((node) => !dropped.has(node.id));
    nextEdges = nextEdges.filter((edge) => !dropped.has(edge.from) && !dropped.has(edge.to));
  }

  if (keeper) return { nodes: nextNodes, edges: nextEdges, removed: dropped.size, added: false };
  return {
    nodes: [createEntryNode(entryType, context.moduleKey, nextNodes), ...nextNodes],
    edges: nextEdges,
    removed: dropped.size,
    added: true,
  };
}


/**
 * Blocks that can only open a flow — an edge may leave them but never arrive.
 * A Handler answers an update Telegram delivered; nothing earlier in the flow
 * can hand it one, so it stays out of the "connect a block to this button"
 * picker, carries no input dot on the canvas, and refuses a dropped
 * connection.
 */
const ENTRY_NODE_TYPES: NodeType[] = ["start", "trigger", "groupjoin", "groupleave", "joinrequest", "channelpost"];

/** Whether the flow owns this block — see `NodeTypeDefinition.fixed`. */
export function isFixedNodeType(type: NodeType): boolean {
  return NODE_TYPE_DEFINITIONS[type].fixed === true;
}

/** Whether an edge may land on this block at all — false for the entry blocks above. */
export function acceptsIncomingEdge(type: NodeType): boolean {
  return !ENTRY_NODE_TYPES.includes(type);
}

/** Block types a new branch can land on, in palette order (`flowlink` closes the list). */
export function getConnectableNodeTypes(moduleKey: ModuleKey | null): NodeType[] {
  return [...getPaletteNodeTypes(moduleKey).filter((type) => !ENTRY_NODE_TYPES.includes(type)), "flowlink"];
}

/**
 * The two rows a fresh menu lands with.
 *
 * An empty keyboard is the one state this block may not be in (see
 * [[MENU_MIN_BUTTONS]]), and a menu whose first job is "now add a button"
 * hides the very thing it was added to surface. The labels are placeholders
 * the author types over, like every other block's default text.
 */
function createMenuButtons(): FlowButton[] {
  const stamp = Date.now();
  return ["Xizmatlar", "Biz haqimizda"].map((label, index) => ({
    id: `b${stamp}${index}${Math.round(Math.random() * 1000)}`,
    label,
    kind: "callback" as const,
  }));
}

export function createNodeDefaults(
  type: NodeType,
  moduleKey: ModuleKey | null,
): Pick<
  FlowNode,
  | "title"
  | "text"
  | "minutes"
  | "buttons"
  | "dmsTrigger"
  | "business"
  | "ai"
  | "language"
  | "tableWrite"
  | "tableRead"
  | "saveAnswerAs"
  | "answerType"
> {
  const definition = NODE_TYPE_DEFINITIONS[type];
  const trigger = definition.hasTriggerConfig;
  return {
    title: definition.defaultTitle,
    text: definition.defaultText,
    minutes: definition.hasDelay ? (definition.defaultMinutes ?? 30) : undefined,
    // No keyboard field at all where the module cannot send one, so the card
    // geometry and the preview read the same "no buttons" off the node itself.
    buttons: nodeSupportsButtons(type, moduleKey) ? [] : undefined,
    language: definition.hasLanguage ? { options: createLanguageOptions() } : undefined,
    // A Handler lands already listening to its module's default signal, so a
    // fresh block says what fires it instead of sitting there unconfigured.
    dmsTrigger: trigger && usesDmsTrigger(moduleKey) ? { kinds: [...DEFAULT_DMS_KINDS] } : undefined,
    business: trigger && moduleKey === "business" ? createBusinessTrigger() : undefined,
    // An AI block lands on a usable model and a real fallback rather than on nothing.
    ai: definition.hasAiConfig ? createAiConfig() : undefined,
    // Empty, and empty on purpose: which table it writes to is the one thing
    // only the author knows, and a guessed handle would be a block that looks
    // configured and writes into nothing. `validateGraph` says so on the card.
    tableWrite: definition.hasTableWrite ? { handle: "", values: {} } : undefined,
    // `qator` rather than an empty prefix: the block is useful the moment a
    // table is picked, and `{{qator.narx}}` is what the author will type.
    tableRead: definition.hasTableRead ? { handle: "", column: "", value: "", into: "qator" } : undefined,
    // A question lands already saving somewhere, unlike every other field on
    // this list. The name it lands on is a guess and the chips beside it make
    // changing it one click — but a block added and wired without noticing the
    // field asks the customer for something and then throws it away, which is
    // the one failure this block exists to end.
    saveAnswerAs: definition.hasSaveAnswer ? (definition.defaultSaveAnswerAs ?? "") : undefined,
    answerType: definition.hasAnswerType ? "text" : undefined,
  };
}
