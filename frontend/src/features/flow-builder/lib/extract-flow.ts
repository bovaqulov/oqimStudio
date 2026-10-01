import type { FlowEdge, FlowNode } from "@/features/flows";
import { getNodeDefinition } from "../node-registry";

/**
 * Splitting one entry block and its own blocks out into a flow of their own.
 *
 * A flow grows by accretion — a second command, a third — until one canvas
 * holds four unrelated conversations. Moving one of them out is a graph
 * question rather than a copy: which blocks belong to *that* entry alone, and
 * what happens to the branches that leave them.
 *
 * Blocks another entry also reaches are the whole difficulty. They stay where
 * they are — moving a shared "Xush kelibsiz" would silently break every other
 * handler pointing at it — and the branch that reached them is redrawn as a
 * jump back into the flow they stayed in, landing on that same block.
 */

/** Where the moved blocks land on the new canvas — the same corner a starter graph opens in. */
const ORIGIN_X = 300;
const ORIGIN_Y = 40;

export interface KeptTarget {
  id: string;
  title: string;
}

export interface FlowExtraction {
  /** The new flow's graph: the moved blocks, plus one jump block per cut branch. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Ids the source flow drops — the moved blocks only, never the jump blocks. */
  movedIds: string[];
  /** Blocks that stayed behind because something else needs them too. */
  kept: KeptTarget[];
}

/** Everything `from` can reach along the edges, itself included. */
function reachableFrom(from: string, edges: FlowEdge[], exists: (id: string) => boolean): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.from !== current || seen.has(edge.to) || !exists(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

/** The first free `nNN` id, so a jump block cannot land on a moved block's id. */
function nextSeq(nodes: FlowNode[]): number {
  return (
    nodes.reduce((highest, node) => {
      const match = /^n(\d+)$/.exec(node.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1
  );
}

/**
 * What moving `entryId` into its own flow would take with it — computed, not
 * applied, so the panel can show the answer before anything is created and the
 * editor can drop the blocks only once the new flow really exists.
 *
 * Returns `null` for an id that is not in the graph.
 */
export function planFlowExtraction(
  nodes: FlowNode[],
  edges: FlowEdge[],
  entryId: string,
  source: { flowId: string; flowName: string },
): FlowExtraction | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const entry = byId.get(entryId);
  if (!entry) return null;

  const moving = reachableFrom(entryId, edges, (id) => byId.has(id));

  /*
   * A block something outside this set also points at belongs to both halves,
   * so it stays. Dropping one can strand the blocks that hung off it — they
   * are now reached from outside too — which is why this settles rather than
   * runs once.
   */
  for (let pass = 0; pass < nodes.length; pass += 1) {
    const shared = [...moving].filter(
      (id) =>
        id !== entryId &&
        edges.some((edge) => edge.to === id && !moving.has(edge.from) && byId.has(edge.from)),
    );
    if (!shared.length) break;
    for (const id of shared) moving.delete(id);
  }

  const movedNodes = nodes.filter((node) => moving.has(node.id));
  // The shape of the branch is worth keeping; where it sat on the old canvas is not.
  const dx = ORIGIN_X - Math.min(...movedNodes.map((node) => node.x));
  const dy = ORIGIN_Y - Math.min(...movedNodes.map((node) => node.y));

  const kept: KeptTarget[] = [];
  const linkByTarget = new Map<string, string>();
  let seq = nextSeq(movedNodes);

  const linkNodes: FlowNode[] = [];
  for (const edge of edges) {
    if (!moving.has(edge.from) || moving.has(edge.to) || linkByTarget.has(edge.to)) continue;
    const target = byId.get(edge.to);
    if (!target) continue;

    const id = `n${seq}`;
    seq += 1;
    kept.push({ id: target.id, title: target.title });
    linkByTarget.set(target.id, id);
    // Placed where the block it stands in for used to be, and pointed at that
    // very block rather than at the flow's beginning — the branch keeps both
    // its shape and its destination.
    linkNodes.push({
      id,
      type: "flowlink",
      x: target.x + dx,
      y: target.y + dy,
      title: getNodeDefinition("flowlink").defaultTitle,
      text: `${source.flowName} · ${target.title}`,
      target: source.flowId,
      targetNodeId: target.id,
      channel: entry.channel,
      scopes: [...entry.scopes],
    });
  }

  const movedEdges = edges
    .filter((edge) => moving.has(edge.from) && (moving.has(edge.to) || linkByTarget.has(edge.to)))
    .map((edge) => (moving.has(edge.to) ? edge : { ...edge, to: linkByTarget.get(edge.to)! }));

  return {
    nodes: [...movedNodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })), ...linkNodes],
    edges: movedEdges,
    movedIds: [...moving],
    kept,
  };
}
