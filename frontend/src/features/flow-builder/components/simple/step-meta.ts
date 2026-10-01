import type { IconName } from "@/components/ui/Icon";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowNode, NodeType } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { stripMarkdown } from "../../lib/markdown";
import { summarizeContent } from "../../lib/message-content";
import { triggerCardSummary } from "../../lib/trigger";
import { getNodeDefinition, type NodeTypeDefinition } from "../../node-registry";
import {
  ANSWER_SLOTS,
  EXPRESSION_PATTERN,
  EXPRESSION_PLACEHOLDER,
  toVariableLabel,
  VARIABLE_GROUPS,
  VARIABLE_PATTERN,
} from "../../lib/variables";

/**
 * The registry as Simple mode has to read it: by the time a block type is
 * named in `NodeType` it can still be missing from the registry — the two land
 * in separate changes — and the add sheet offers a type it may not have yet.
 * Everything here goes through this rather than through `getNodeDefinition`
 * directly, so a missing type is a card that says so instead of a crash.
 */
export function nodeDefinitionOrNull(type: NodeType): NodeTypeDefinition | null {
  return (getNodeDefinition(type) as NodeTypeDefinition | undefined) ?? null;
}

/**
 * The one line the collapsed card reads back — the same sentence its canvas
 * card shows. `main` is the bot's own language: a collapsed step is read as
 * part of the list, not as one field, so it says what the bot sends by default.
 */
export function stepSummary(node: FlowNode, main: BotLanguage = DEFAULT_LANGUAGE): string {
  const body = resolveText(node.text, main, main);
  const definition = nodeDefinitionOrNull(node.type);
  if (!definition) return body.trim();
  if (definition.hasTriggerConfig) return triggerCardSummary(node);
  return stripMarkdown(definition.hasContent ? summarizeContent(node, main) : body).trim();
}

/** One card in the "+ Blok qo'shish" sheet. */
export interface AddChoice {
  key: string;
  label: string;
  /** What this step does, said the way somebody who has never built a bot would say it. */
  hint: string;
  icon: IconName;
  /** The block it creates — `null` opens the full block list instead. */
  type: NodeType | null;
  /** Set on the new block over its defaults, where the card is narrower than the type. */
  patch?: Partial<FlowNode>;
}

/**
 * The things a step can be, in the order somebody building a conversation
 * reaches for them. Not the palette: the palette lists every block type, this
 * lists the answers to "what happens next" — which is why "Rasm/Fayl" is a
 * Xabar with its content kind already chosen, and why everything rarer than
 * these sits behind "Ko'proq" rather than beside them.
 *
 * «Savol berish» is second because asking is the second thing every bot does,
 * and because leaving it out of this list is what sent an author looking for it
 * under «Kutish» — a pause measured in minutes — and then under «Ma'lumotni
 * saqlash», which stores the message that has *already* arrived. Neither waits
 * for an answer. A list of first choices that omits the second-commonest one is
 * not a shorter list, it is a list that teaches the wrong block.
 */
export const ADD_CHOICES: AddChoice[] = [
  { key: "message", label: "Xabar", hint: "Mijozga matn yuborish", icon: "chat-teardrop-text", type: "message" },
  {
    key: "question",
    label: "Savol berish",
    hint: "So'rash va javobni kutib saqlash",
    icon: "question",
    type: "question",
  },
  {
    key: "media",
    label: "Rasm/Fayl",
    hint: "Rasm, video yoki hujjat yuborish",
    icon: "image",
    type: "message",
    patch: { contentKind: "photo" },
  },
  { key: "condition", label: "Shart", hint: "Shartga qarab yo'lni ajratish", icon: "git-branch", type: "condition" },
  // The hint names blocks «Barcha bloklar» actually lists. It used to promise
  // "to'lov" as well, and there has been no payment block to add since the
  // invoice one was withdrawn — a card advertising something the list behind it
  // does not have costs a reader the trip to find that out.
  { key: "more", label: "Ko'proq", hint: "Kutish, teg, AI, HTTP…", icon: "dots-three", type: null },
];


/**
 * Every variable path this build knows a human name for, flattened once.
 *
 * `{{message.text}}` is the runtime's spelling of "whatever they just typed".
 * It belongs in a field where an author is composing a message and can be shown
 * what it will become; it does not belong in a list somebody is reading to find
 * out what their bot says.
 */
const VARIABLE_LABELS: Record<string, string> = {
  "message.text": "mijoz javobi",
  tag: "belgi",
  ...Object.fromEntries(ANSWER_SLOTS.map((slot) => [slot.key, slot.label.toLowerCase()])),
  ...Object.fromEntries(
    VARIABLE_GROUPS.flatMap((group) => group.items.map((item) => [item.path, item.label.toLowerCase()])),
  ),
};

/** A variable path in the reader's words — `mijoz_ismi` comes back as "mijoz ismi". */
export function variableLabel(path: string): string {
  return VARIABLE_LABELS[path] ?? toVariableLabel(path.split(".").pop() ?? path).toLowerCase();
}

/**
 * The one line a step shows in the list.
 *
 * The rule the audit set: a step's heading is *what it actually says* — the
 * message the customer receives — and what kind of block it is comes from the
 * icon beside it, not from a word repeated on every row. Two flows built the
 * same way used to read "Ismni so'rash" in one and "Savol / Javobni saqlash /
 * Javob xabari" in the other, because half the rows were showing an author's
 * title and half were showing a type name.
 *
 * Machine spellings are translated on the way out rather than printed:
 * `mijoz_ismi = {{message.text}}` becomes "Ism saqlanadi". The raw form is
 * still what the editing sheet shows, where it is being written and the author
 * is choosing it.
 */
export function stepHeadline(node: FlowNode, main: BotLanguage = DEFAULT_LANGUAGE): string {
  // A block that keeps structured fields is read from them, never from the
  // `text` mirror beside them. The two drift: a flow seeded before the fields
  // existed carries `text: "tag = narx_soradi"`, which is the runtime's own
  // spelling and reached the list as "Tag: narx_soradi".
  const tag = tagHeadline(node);
  if (tag) return tag;

  const summary = humanize(stepSummary(node, main));
  if (summary) return summary;
  const definition = nodeDefinitionOrNull(node.type);
  return node.title?.trim() || definition?.kindLabel || "Blok";
}

function humanize(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // `name = {{message.text}}` — a block whose whole job is to remember an answer.
  const stored = /^([a-z0-9_]+)\s*=\s*\{\{\s*message\.text\s*\}\}$/i.exec(trimmed);
  if (stored) return `${capitalize(variableLabel(stored[1]!))} saqlanadi`;

  // `name = value` — a tag or a fixed assignment.
  const assigned = /^([a-z0-9_]+)\s*=\s*(.+)$/i.exec(trimmed);
  if (assigned) return `${capitalize(variableLabel(assigned[1]!))}: ${expand(assigned[2]!)}`;

  return expand(trimmed);
}

/**
 * Placeholders left inside a sentence read as the thing they stand for.
 *
 * The runtime's own pattern, filter chain included — a step summary reading
 * «Salom {{ism | default: "mehmon"}}» was the braces the rest of this function
 * exists to remove. The filters themselves are dropped rather than described:
 * this is one line on a card in Simple mode, and what it owes the reader is the
 * *name*, not the rule for when the name is missing.
 */
function expand(text: string): string {
  // A computed value is a value, not a name: there is nothing to call it in
  // the reader's words, so the row says a value belongs here and stops. The
  // braces have to go either way — a step reading
  // «Jami: {{ money(cartTotal(savat)) }}» is the machine spelling this whole
  // function exists to keep off the list.
  return text
    .replace(EXPRESSION_PATTERN, EXPRESSION_PLACEHOLDER)
    .replace(VARIABLE_PATTERN, (_: string, path: string) => variableLabel(path));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}


/**
 * A "Ma'lumotni saqlash" block, said in the reader's words.
 *
 * Three shapes, because the block does three things: it attaches a label to
 * the person, it takes one away, or it remembers an answer. The variable name
 * is an identifier the author never typed — `toVariableName` derived it from
 * what they *did* type — so it is turned back into words here. That reversal
 * is lossy by design (the apostrophes in o'/g' were dropped on the way in), so
 * `narx_soradi` comes back as "narx soradi" and not "narx so'radi".
 */
function tagHeadline(node: FlowNode): string | null {
  if (node.type !== "tag" || !node.tagAction) return null;
  const name = node.tagName?.trim();
  if (!name) return null;
  const label = variableLabel(name);

  if (node.tagAction === "add") return `Belgi: ${label}`;
  if (node.tagAction === "remove") return `Belgi olinadi: ${label}`;

  const value = node.tagValue?.trim() ?? "";
  // The overwhelmingly common case, and the one worth a sentence of its own.
  if (!value || /^\{\{\s*message\.text\s*\}\}$/i.test(value)) return `${capitalize(label)} saqlanadi`;
  return `${capitalize(label)}: ${expand(value)}`;
}
