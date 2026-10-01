import type { BotLanguage } from "@/features/bots/types";
import type { FlowEdge, FlowNode, NodeType } from "@/features/flows";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import {
  acceptsIncomingEdge,
  backRowReachesTelegram,
  getNodeDefinition,
  getNodePorts,
  hasBackRow,
  type NodePortKind,
} from "../node-registry";
import { contentIssues, LANGUAGE_VARIABLE, summarizeContent } from "./message-content";
import { triggerIssues } from "./trigger";
import { ANSWER_SLOTS, collectedVariables, parseFilters, VARIABLE_PATTERN } from "./variables";

/*
 * What is wrong with the graph, said before it goes live.
 *
 * A flow can be perfectly well-formed and still do nothing: a block nothing
 * routes into never runs, a message with no text sends nothing, a button wired
 * to no block answers a tap with silence. None of that stops a save — the
 * canvas is a draft until the author says otherwise — so this reports rather
 * than refuses, and the editor shows it next to the publish control where a
 * decision is actually being made.
 */

export type GraphFindingKind =
  /** Nothing routes into the block, so it can never run. */
  | "unreachable"
  /** The block would send an empty or incomplete message. */
  | "emptyContent"
  /** A named branch leaves the block and lands nowhere. */
  | "danglingPort"
  /** The block draws a keyboard row Telegram will not put under the message. */
  | "unsentRow"
  /** A placeholder that is routinely empty, with nothing said about that case. */
  | "bareVariable"
  /** Two lines leave one exit, and the runtime can only walk one of them. */
  | "forkedPort"
  /** The Handler's own condition is blank, so it claims more or less than it says. */
  | "openTrigger"
  /** A placeholder spelled a hair away from a name the flow actually writes. */
  | "misspeltVariable"
  /**
   * An expression calls a function the bot's script library does not declare.
   * Not produced here — the graph alone cannot know it. See `GraphWarnings`.
   */
  | "missingFunction";

export interface GraphFinding {
  /** Stable for the same problem on the same block — the list keys on it. */
  id: string;
  kind: GraphFindingKind;
  nodeId: string;
  /** What is wrong, in the author's language. */
  message: string;
  /** The block's own one-liner, so the panel names it the way the card does. */
  summary: string;
}

/**
 * Blocks whose body *is* the work: an empty one produces nothing at run time.
 * Everywhere else `text` is a label the canvas reads back — a blank one is a
 * naming choice, not a fault — and the message-shaped blocks are covered by
 * [[contentIssues]] instead, which knows what each content kind needs.
 */
// «Savol» is here for a reason the other three are not: an empty body on a
// Shart or an HTTP block is a card with no name, while an empty question is a
// bot that stops and waits without ever having said what it is waiting for.
const BODY_REQUIRED_TYPES: NodeType[] = ["ai", "condition", "http", "question"];

/**
 * Placeholders whose value Telegram genuinely often does not send.
 *
 * A surname and a username are optional on a Telegram account, so
 * `{{user.last_name}}` is empty for a large share of real customers — and an
 * empty substitution leaves the hole the author never wrote: "Salom, Aziz !",
 * "Sizning @ hisobingiz". `{{user.first_name}}` is not here because Telegram
 * always sends it; warning about it would be noise, and a warning panel that
 * cries wolf is a panel nobody opens.
 *
 * The fix is one filter — `{{user.last_name | default: ""}}` says the author
 * thought about it — so the finding names it rather than just objecting.
 */
const OFTEN_EMPTY: Record<string, string> = {
  "user.last_name": "Familiya",
  "user.username": "Username",
};

/**
 * A placeholder naming a variable nobody writes, where the name it *nearly*
 * spells is one this flow does write.
 *
 * `{{mijoz_ismi}}` typed as `{{mijoz_isim}}` is not an error anywhere: the
 * runtime substitutes an empty string, the message goes out with a hole in it,
 * and the only sign is a customer being greeted as "Salom !". Nothing in the
 * editor could say so, which is the half of the naming problem the audit found
 * that a rename does not fix.
 *
 * Deliberately narrow. A flow variable can also come from a script hook — see
 * the «Kod» guide — so an unknown name is not by itself a fault, and warning on
 * every one of them would fill the panel with names the author meant. A name
 * one or two keystrokes off something the flow demonstrably saves is a typo
 * with an answer attached, and that is the only case reported.
 */
const MAX_TYPO_DISTANCE = 2;

/** Levenshtein, bounded — only the "is this within two keystrokes" question is asked of it. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_TYPO_DISTANCE) return MAX_TYPO_DISTANCE + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/**
 * The name `path` looks like a slip of, or null when it looks like itself.
 *
 * Only names without a dot are considered on either side: `user.first_name` and
 * `webapp.<savol>` are namespaces, one closed and one this build cannot
 * enumerate, and a near-miss inside them is not a thing to guess at.
 */
function nearestKnownName(path: string, known: Set<string>): string | null {
  if (path.includes(".") || known.has(path)) return null;
  let best: string | null = null;
  let bestDistance = MAX_TYPO_DISTANCE + 1;
  for (const candidate of known) {
    if (candidate.includes(".")) continue;
    const distance = editDistance(path.toLowerCase(), candidate.toLowerCase());
    if (distance > 0 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= MAX_TYPO_DISTANCE ? best : null;
}

/** Every `{{name}}` in `text`, filters stripped — the names, not the spellings. */
function placeholderNames(text: string): string[] {
  return [...text.matchAll(VARIABLE_PATTERN)].map((match) => match[1] ?? "").filter(Boolean);
}

/** The placeholders in `text` that name an often-empty value and do not handle it. */
function unguardedPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const [, name, filters] = match;
    if (!name || !(name in OFTEN_EMPTY)) continue;
    // Read rather than searched for. `/\|\s*default\b/` also finds the word
    // inside somebody else's argument — `{{user.username | qisqartir: "default"}}`
    // — and calls a placeholder guarded because a quoted string mentions the
    // filter that would have guarded it.
    if (parseFilters(filters ?? "").some((filter) => filter.name === "default")) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** How the panel names the block — the same line its card shows. */
function nodeSummary(node: FlowNode, main: BotLanguage): string {
  const definition = getNodeDefinition(node.type);
  return (
    definition.hasContent ? summarizeContent(node, main) : resolveText(node.text, main, main)
  ).trim();
}

/** Every block an update can arrive at, walked from the blocks a flow opens on. */
function reachableIds(nodes: FlowNode[], edges: FlowEdge[]): Set<string> {
  const seen = new Set<string>();
  const queue = nodes.filter((node) => !acceptsIncomingEdge(node.type)).map((node) => node.id);
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    // One exit, one destination — the same edge `Flow.edge()` picks, which is
    // the first on the port and nothing after it. Following every edge instead
    // called a block reachable that the bot can never arrive at, so a graph
    // with a forked exit reported no warning at all while Simple mode was
    // listing the very same block under "Ulanmagan bloklar".
    const taken = new Set<string>();
    for (const edge of edges) {
      if (edge.from !== id || taken.has(edge.port)) continue;
      taken.add(edge.port);
      if (!seen.has(edge.to)) queue.push(edge.to);
    }
  }
  return seen;
}

/**
 * `main` is the bot's own language. The findings name blocks and buttons, and
 * a warning list is read outside any one field — so it says what the bot would
 * send by default rather than following the switch a text field happens to be
 * showing.
 */
export function validateGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  main: BotLanguage = DEFAULT_LANGUAGE,
): GraphFinding[] {
  const findings: GraphFinding[] = [];
  // A flow with no entry block at all would report every block as unreachable.
  // That flow has one problem and it is not this one — `applyEntryRule` gives
  // every flow its entry block, so this only guards the moment before it does.
  const hasEntry = nodes.some((node) => !acceptsIncomingEdge(node.type));
  const reachable = hasEntry ? reachableIds(nodes, edges) : null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  /*
   * Every dot-free name this flow can be expected to hold: the four ready-made
   * answer slots, the language a «Til» block writes, and whatever the blocks on
   * this canvas actually save. What a near-miss is measured against.
   */
  const knownNames = new Set<string>([
    ...ANSWER_SLOTS.map((slot) => slot.key),
    LANGUAGE_VARIABLE,
    ...Object.keys(collectedVariables(nodes)),
  ]);

  for (const node of nodes) {
    const summary = nodeSummary(node, main);
    const definition = getNodeDefinition(node.type);

    if (reachable && !reachable.has(node.id)) {
      findings.push({
        id: `${node.id}:unreachable`,
        kind: "unreachable",
        nodeId: node.id,
        summary,
        message: "Bu blokka hech qaysi yo'l olib bormaydi — u hech qachon ishlamaydi.",
      });
    }

    if (definition.hasContent) {
      contentIssues(node, main).forEach((issue, index) => {
        findings.push({
          id: `${node.id}:content:${index}`,
          kind: "emptyContent",
          nodeId: node.id,
          summary,
          message: issue,
        });
      });
    } else if (BODY_REQUIRED_TYPES.includes(node.type) && !resolveText(node.text, main, main).trim()) {
      findings.push({
        id: `${node.id}:body`,
        kind: "emptyContent",
        nodeId: node.id,
        summary,
        message: `«${definition.bodyFieldLabel ?? "Matn"}» to'ldirilmagan.`,
      });
    }

    // A row the card draws and `sendMediaGroup` cannot carry. Said here rather
    // than left to the strike-through on the card, because the block this
    // happens to is usually one the author converted to an album a while ago:
    // the row and the branch off it were drawn while the block was still a
    // text message, and neither the canvas nor the test chat has offered that
    // exit since. Nothing publishes the exit any more — see
    // [[backRowReachesTelegram]] — but the row and any edge already on it stay
    // where the author can see them, so this is the only place that says why.
    if (hasBackRow(node) && !backRowReachesTelegram(node)) {
      const wired = edges.some((edge) => edge.from === node.id && edge.port === "back");
      findings.push({
        id: `${node.id}:back-unsent`,
        kind: "unsentRow",
        nodeId: node.id,
        summary,
        message:
          "«Orqaga» qatori albom bilan yuborilmaydi — Telegram sendMediaGroup ostiga klaviatura qo'ymaydi. " +
          (wired ? "Undan ketayotgan bog'lanish hech qachon yurmaydi. " : "") +
          "Qatorni o'chiring yoki blok nima yuborishini o'zgartiring.",
      });
    }

    for (const name of unguardedPlaceholders(resolveText(node.text, main, main))) {
      findings.push({
        id: `${node.id}:bare:${name}`,
        kind: "bareVariable",
        nodeId: node.id,
        summary,
        message: `«${OFTEN_EMPTY[name]}» ko'pincha bo'sh bo'ladi — Telegram uni har doim bermaydi. «{{${name} | default: "…"}}» yozing.`,
      });
    }

    // A name one keystroke away from one the flow saves. Reported per block
    // rather than once per flow, because the fix is in this block's text.
    for (const found of new Set(placeholderNames(resolveText(node.text, main, main)))) {
      const meant = nearestKnownName(found, knownNames);
      if (!meant) continue;
      findings.push({
        id: `${node.id}:typo:${found}`,
        kind: "misspeltVariable",
        nodeId: node.id,
        summary,
        message: `«{{${found}}}» — bunday o'zgaruvchi saqlanmaydi va xabarda bo'sh joy qoladi. «{{${meant}}}» bo'lishi kerakmi?`,
      });
    }

    // The block's own "out" is left alone: nothing after it means the flow ends
    // there, which is how flows end. A *named* exit is a promise — a button
    // that answers nothing, a "Bekor" that leads nowhere — and an unwired one
    // is a hole the author cannot see on the canvas.
    //
    // A button with no label yet is named by its place in the keyboard. Every
    // such finding used to read «Tugma» tugmasi hech qayerga ulanmagan», so a
    // block with three unnamed buttons produced three identical rows and the
    // panel could not say which of them it meant — the one thing a list of
    // problems has to be able to do.
    const buttonOrdinals = new Map<string, number>();
    for (const port of getNodePorts(node, main)) {
      if (port.kind === "button") buttonOrdinals.set(port.id, buttonOrdinals.size + 1);
    }
    const exitName = (port: { id: string; label: string; kind: NodePortKind }) =>
      port.kind === "button"
        ? port.label
          ? `«${port.label}» tugmasi`
          : `${buttonOrdinals.get(port.id) ?? 1}-tugma (nomsiz)`
        : `«${port.label || "Chiqish"}» chiqishi`;

    for (const port of getNodePorts(node, main)) {
      if (port.kind === "out") continue;
      if (edges.some((edge) => edge.from === node.id && edge.port === port.id)) continue;
      findings.push({
        id: `${node.id}:port:${port.id}`,
        kind: "danglingPort",
        nodeId: node.id,
        summary,
        message: `${exitName(port)} hech qayerga ulanmagan.`,
      });
    }

    // What fires this block, where the answer is "more than the author wrote".
    // A Handler is the one block whose own settings can be blank and still
    // behave — badly — so the card cannot show the problem the way an empty
    // message body shows on a message.
    triggerIssues(node).forEach((issue, index) => {
      findings.push({
        id: `${node.id}:trigger:${index}`,
        kind: "openTrigger",
        nodeId: node.id,
        summary,
        message: issue,
      });
    });

    // An exit leads to one block, and a graph can still hold one that leads to
    // two: `connectPort` stops a second being drawn from here on, but flows
    // saved before it, and graphs arriving through import or the AI builder,
    // are not healed by that. The runtime walks the first edge on the port and
    // never sees the rest — so the canvas draws a branch nobody receives, and
    // which one that is depends on the order the edges sit in the stored
    // array, which is not a thing the author can see. Named here because the
    // fix is theirs to make: delete the line, or move it to its own exit.
    for (const port of getNodePorts(node, main)) {
      const wired = edges.filter((edge) => edge.from === node.id && edge.port === port.id);
      if (wired.length < 2) continue;
      const kept = byId.get(wired[0]!.to);
      const keptName = kept ? kept.title || getNodeDefinition(kept.type).kindLabel : "birinchisi";
      findings.push({
        id: `${node.id}:port:${port.id}:forked`,
        kind: "forkedPort",
        nodeId: node.id,
        summary,
        message:
          `${exitName(port)} ${wired.length} ta blokka ulangan — bot faqat «${keptName}» ga boradi, ` +
          `qolgani hech qachon ishlamaydi.`,
      });
    }
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Simple mode                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The same graph, read as a recipe.
 *
 * Simple mode draws no canvas: it lists the steps in the order the bot runs
 * them, with branches indented under the step that opens them. That reading
 * only exists for graphs shaped like a list — a loop, a step two paths arrive
 * at, or branching nested deeper than the indentation can carry has no honest
 * place in it. So the walk reports what it could not draw instead of drawing
 * it wrong, and the view offers Pro. Nothing here rewrites the graph; it is a
 * second *reading* of the one the canvas shows.
 *
 * It lives beside [[validateGraph]] and shares its idea of an entry block so
 * the two can never disagree about where a flow starts.
 */

/** How many levels of indentation a list can carry before it stops reading as one. */
const MAX_BRANCH_DEPTH = 2;

/**
 * Why Simple mode cannot draw this graph faithfully.
 *
 * Two paths arriving at one step is *not* on this list, and used to be. The
 * list draws that case correctly: the second path ends at the step the first
 * one already printed and says "«X» blokiga qaytadi", which is exactly what
 * the bot does. Reporting it sent the commonest shape a support bot has —
 * two menu buttons that lead to the same answer — off to Pro with a banner
 * saying the list could not show it, while the list was showing it.
 */
export type SimpleBlocker =
  /** A path returns to a step already listed above it. */
  | "loop"
  /** Branching nested deeper than the list can indent. */
  | "deepBranch";

/** One named exit of a step, with whatever runs under it. */
export interface SimpleBranch {
  /** Port id on the owning step — what an insert under this branch wires to. */
  port: string;
  label: string;
  kind: NodePortKind;
  row: SimpleRow;
}

export interface SimpleStep {
  nodeId: string;
  /** Every named exit, wired or not — an empty one is a hole the author can fill here. */
  branches: SimpleBranch[];
  /** Branches this step carries that the list does not draw, because they sit too deep. */
  hiddenBranches: number;
}

/** Steps that run one after another, and the exit that feeds the first of them. */
export interface SimpleRow {
  /** `{block, port}` the row hangs off; `null` for blocks nothing routes into. */
  head: { nodeId: string; port: string } | null;
  steps: SimpleStep[];
  /** The row's last exit returns to a step listed elsewhere — drawn as a return, never followed. */
  endsAt: string | null;
}

export interface SimpleSection {
  /** The entry block this section opens with; `null` for blocks no path reaches. */
  entryId: string | null;
  row: SimpleRow;
}

export interface SimpleOutline {
  /** Entry sections first, then whatever nothing routes into — nothing is left out. */
  sections: SimpleSection[];
  blockers: SimpleBlocker[];
}

/**
 * Reads the graph as an ordered list of steps.
 *
 * "Next" is the block's own `out` exit and nothing else: a named exit — a
 * button, "Ha"/"Yo'q", "To'landi" — is a branch, drawn indented under the step
 * that owns it. That one rule is what makes the list order the flow order, and
 * what makes reordering a matter of rewiring `out` edges alone.
 */
export function buildSimpleOutline(
  nodes: FlowNode[],
  edges: FlowEdge[],
  // Names the branches the list draws — the bot's own language, for the same
  // reason [[validateGraph]] uses it: an outline is not one field's view.
  main: BotLanguage = DEFAULT_LANGUAGE,
): SimpleOutline {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const blockers = new Set<SimpleBlocker>();
  const placed = new Set<string>();

  function walkRow(
    head: { nodeId: string; port: string } | null,
    startId: string | undefined,
    depth: number,
    path: string[],
  ): SimpleRow {
    const steps: SimpleStep[] = [];
    const walked = [...path];
    let cursor = startId;
    let endsAt: string | null = null;

    while (cursor) {
      const node = byId.get(cursor);
      if (!node) break;
      // Already listed somewhere: following it would print the same steps
      // twice, or forever. The row says where it goes and stops there — which
      // is an honest reading when the step is merely shared by two paths, and
      // only a problem when the path is returning into itself.
      if (placed.has(cursor)) {
        if (walked.includes(cursor)) blockers.add("loop");
        endsAt = cursor;
        break;
      }
      placed.add(cursor);
      walked.push(cursor);

      const named = getNodePorts(node, main).filter((port) => port.kind !== "out");
      const branches: SimpleBranch[] = [];
      let hiddenBranches = 0;
      if (named.length) {
        if (depth >= MAX_BRANCH_DEPTH) {
          hiddenBranches = named.length;
          blockers.add("deepBranch");
        } else {
          for (const port of named) {
            const edge = edges.find((candidate) => candidate.from === node.id && candidate.port === port.id);
            branches.push({
              port: port.id,
              label: port.label || "Tugma",
              kind: port.kind,
              row: walkRow({ nodeId: node.id, port: port.id }, edge?.to, depth + 1, walked),
            });
          }
        }
      }

      steps.push({ nodeId: node.id, branches, hiddenBranches });
      cursor = edges.find((edge) => edge.from === node.id && edge.port === "out")?.to;
    }

    return { head, steps, endsAt };
  }

  const sections: SimpleSection[] = [];
  for (const node of nodes) {
    if (acceptsIncomingEdge(node.type) || placed.has(node.id)) continue;
    placed.add(node.id);
    const entryOut = edges.find((edge) => edge.from === node.id && edge.port === "out");
    sections.push({
      entryId: node.id,
      row: walkRow({ nodeId: node.id, port: "out" }, entryOut?.to, 0, [node.id]),
    });
  }

  // Whatever no entry reaches is still the author's work: it gets a section of
  // its own rather than disappearing from the only view they have.
  //
  // Which block *heads* that section is decided by the edges, never by where
  // the block happens to sit in the stored array. Taking the array's first
  // unplaced node instead is how a chain "A → B" stored as [B, A] came out
  // listed as B, then A — the step before printed under the step after it,
  // which is the one thing this whole view exists to get right.
  const unplacedHasIncoming = (id: string) =>
    edges.some((edge) => edge.to === id && byId.has(edge.from) && !placed.has(edge.from));

  let guard = nodes.length + 1;
  while (guard-- > 0) {
    const remaining = nodes.filter((node) => !placed.has(node.id));
    if (!remaining.length) break;
    // A head is a block nothing else still-unlisted points at. When every one
    // of them is pointed at, the leftovers are a closed cycle with no head to
    // find — that is already reported as a blocker, and the array's order is
    // then as good an entry as any.
    const head = remaining.find((node) => !unplacedHasIncoming(node.id)) ?? remaining[0]!;
    sections.push({ entryId: null, row: walkRow(null, head.id, 0, []) });
  }

  return { sections, blockers: [...blockers] };
}

/** The row `nodeId` is listed in — what a reorder moves it within. */
export function findSimpleRow(outline: SimpleOutline, nodeId: string): SimpleRow | null {
  function search(row: SimpleRow): SimpleRow | null {
    if (row.steps.some((step) => step.nodeId === nodeId)) return row;
    for (const step of row.steps) {
      for (const branch of step.branches) {
        const found = search(branch.row);
        if (found) return found;
      }
    }
    return null;
  }
  for (const section of outline.sections) {
    const found = search(section.row);
    if (found) return found;
  }
  return null;
}
