import type { BotLanguage } from "@/features/bots/types";
import type { FlowEdge, FlowNode } from "@/features/flows";
import type { SimpleRow } from "../../lib/validate-graph";
import { buttonIdFromPort } from "../../lib/buttons";
import { acceptsIncomingEdge, getNodePorts, hasOutPort, type NodePort } from "../../node-registry";

/**
 * Simple mode reads a flow the way the customer lives it: one screen of chat
 * at a time.
 *
 * A screen is the run of messages that follow one exit — the entry's `out`,
 * or a button the customer tapped — until the path ends or comes back to
 * something already on the way. A button does not indent what it leads to
 * under itself, as the old list did; it *opens* it, the way tapping it in
 * Telegram opens the next part of the conversation. So no graph is too deep to
 * show: depth is a back arrow, not an indentation the page runs out of.
 *
 * Every row here is a `SimpleRow` with no branches filled in, so the store's
 * list edits (`spliceSimpleStep`, `reorderSimpleStep`) apply to it unchanged.
 */

/** One step down: the exit that was followed, and what to call it in the header. */
export interface ScreenHop {
  nodeId: string;
  port: string;
}

/** A section of the first screen: an entry and the chat it opens with. */
export interface EntrySection {
  entry: FlowNode;
  row: SimpleRow;
}

function outTarget(edges: FlowEdge[], nodeId: string, port: string): string | undefined {
  return edges.find((edge) => edge.from === nodeId && edge.port === port)?.to;
}

/**
 * The steps that run one after another from `head`, following `out` only.
 *
 * Stops at a step already seen on this screen or on any screen above it and
 * records it as `endsAt` — the chat says "goes back to «X»" there rather than
 * printing that part of the conversation again, or forever.
 */
export function walkRow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  head: ScreenHop | null,
  startId: string | undefined,
  above: ReadonlySet<string>,
): SimpleRow {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const steps: SimpleRow["steps"] = [];
  let cursor = startId;
  let endsAt: string | null = null;
  while (cursor && byId.has(cursor)) {
    if (seen.has(cursor) || above.has(cursor)) {
      endsAt = cursor;
      break;
    }
    seen.add(cursor);
    steps.push({ nodeId: cursor, branches: [], hiddenBranches: 0 });
    cursor = outTarget(edges, cursor, "out");
  }
  return { head, steps, endsAt };
}

/** Every exit on a block other than `out` — buttons, Ha/Yo'q, To'landi, Orqaga. */
export function namedPorts(node: FlowNode, main: BotLanguage): NodePort[] {
  return getNodePorts(node, main).filter((port) => port.kind !== "out");
}

/** Exits that are not one of the block's own keyboard buttons — drawn as chips under it. */
export function chipPorts(node: FlowNode, main: BotLanguage): NodePort[] {
  return namedPorts(node, main).filter((port) => buttonIdFromPort(port.id) === null);
}

/** The first screen: each entry of the flow, with the chat it starts. */
export function entrySections(nodes: FlowNode[], edges: FlowEdge[]): EntrySection[] {
  return nodes
    .filter((node) => !acceptsIncomingEdge(node.type))
    .map((entry) => ({
      entry,
      row: walkRow(nodes, edges, { nodeId: entry.id, port: "out" }, outTarget(edges, entry.id, "out"), new Set([entry.id])),
    }));
}

/**
 * Blocks no entry reaches by any path, grouped into the chains they form.
 *
 * Still the author's work, so still shown — a flow whose middle was cut loose
 * by a delete must not look like it lost those messages.
 */
export function looseRows(nodes: FlowNode[], edges: FlowEdge[]): SimpleRow[] {
  const reached = new Set<string>();
  const queue = nodes.filter((node) => !acceptsIncomingEdge(node.type)).map((node) => node.id);
  while (queue.length) {
    const id = queue.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of edges) if (edge.from === id) queue.push(edge.to);
  }

  const rows: SimpleRow[] = [];
  const placed = new Set(reached);
  let guard = nodes.length + 1;
  while (guard-- > 0) {
    const remaining = nodes.filter((node) => !placed.has(node.id));
    if (!remaining.length) break;
    // A chain's head is the block nothing else still loose points at; a closed
    // cycle has none, and then any of its blocks is as good a start as another.
    const head =
      remaining.find((node) => !edges.some((edge) => edge.to === node.id && !placed.has(edge.from))) ??
      (remaining[0] as FlowNode);
    const row = walkRow(nodes, edges, null, head.id, placed);
    for (const step of row.steps) placed.add(step.nodeId);
    if (!row.steps.length) placed.add(head.id);
    else rows.push(row);
  }
  return rows;
}

/** A screen opened by following one hop from the screen above it. */
export interface OpenedScreen {
  hops: ScreenHop[];
  row: SimpleRow;
}

/**
 * Follows the path of hops the author tapped through and returns the deepest
 * screen that is still there.
 *
 * Read, never stored: a hop whose block was deleted or whose button was
 * removed simply ends the path early, so the view falls back to the nearest
 * screen that still exists instead of showing one that does not.
 */
export function openScreen(
  nodes: FlowNode[],
  edges: FlowEdge[],
  path: ScreenHop[],
  main: BotLanguage,
): OpenedScreen | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const above = new Set<string>();
  // Everything on the first screen is "above" the first hop.
  for (const section of entrySections(nodes, edges)) {
    above.add(section.entry.id);
    for (const step of section.row.steps) above.add(step.nodeId);
  }

  const hops: ScreenHop[] = [];
  let row: SimpleRow | null = null;
  for (const hop of path) {
    const node = byId.get(hop.nodeId);
    if (!node || !namedPorts(node, main).some((port) => port.id === hop.port)) break;
    if (!above.has(hop.nodeId)) break;
    row = walkRow(nodes, edges, hop, outTarget(edges, hop.nodeId, hop.port), above);
    hops.push(hop);
    for (const step of row.steps) above.add(step.nodeId);
  }
  return row ? { hops, row } : null;
}

/** How many steps an exit leads to before the path ends or returns — the count on a button. */
export function branchSize(nodes: FlowNode[], edges: FlowEdge[], nodeId: string, port: string): number {
  const target = outTarget(edges, nodeId, port);
  if (!target) return 0;
  return walkRow(nodes, edges, null, target, new Set([nodeId])).steps.length || 1;
}

/**
 * Whether the next step in line actually runs after this one.
 *
 * Not the same as having an `out` port. A message with buttons that branch
 * parks the run until one is tapped (`engine/runner.py`, `_handle_message`),
 * so its `out` is never walked: a step appended under a menu is a step no
 * customer ever reaches. Its continuation is its buttons, and the chat says so
 * instead of offering a place to write something that will never be sent.
 */
export function continuesInLine(node: FlowNode, main: BotLanguage): boolean {
  // A message parks on its «Orqaga» row as well as on its buttons; a question
  // does not — its answer is what moves it on, through `out`.
  return (
    hasOutPort(node) &&
    !namedPorts(node, main).some(
      (port) => buttonIdFromPort(port.id) !== null || (port.kind === "back" && node.type !== "question"),
    )
  );
}
