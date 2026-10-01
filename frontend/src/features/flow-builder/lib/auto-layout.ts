import type { FlowEdge, FlowNode } from "@/features/flows";
import { nodeHeight, nodeWidth } from "../node-registry";

/**
 * Layered ("Sugiyama-lite") tidy-up for the canvas: every block is pushed into
 * the column matching its distance from a trigger, and columns are ordered so
 * that connected blocks sit beside one another. Enough to turn a hand-dragged
 * zigzag back into a readable left-to-right flow, without the weight of a real
 * layout engine.
 *
 * Columns, not rows, because an exit leaves a card's right edge and lands on
 * the next card's left one: a stacked layout would have every connection loop
 * back over the card it came from before it could reach the one below.
 */

/**
 * Gap between the widest card of one column and the left edge of the next.
 * Wide enough to hold what an edge draws in it — a "Yo'q" chip is ~40px across
 * and each end of the curve reaches ~34px out of its port — since cards paint
 * above the edge layer and would cover anything the gap can't fit.
 */
const RANK_GAP = 120;
/** Vertical breathing room between two cards sitting one above the other in a column. */
const SIBLING_GAP = 48;
const GRID_STEP = 8;
/** Barycenter sweeps. Past a handful the ordering stops changing on graphs this size. */
const ORDER_PASSES = 4;

function snap(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

function linkKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/**
 * Marks the edges that close a cycle — a "back to the main menu" link, which
 * every real flow has. Layering has to ignore those or the ranks never settle,
 * so they are found with a depth-first walk: an edge into a node still open on
 * the stack is a back edge.
 *
 * Which edge of a cycle gets picked depends on where the walk starts, and that
 * decides which block lands in the leftmost column — so `ids` arrives ordered
 * by position, letting the topmost block of a ring open it, the same one the
 * author already reads first.
 */
function findBackEdges(ids: string[], outgoing: Map<string, string[]>, roots: string[]): Set<string> {
  const back = new Set<string>();
  // 0 = unseen, 1 = on the current stack, 2 = finished.
  const state = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));

  function visit(id: string): void {
    state.set(id, 1);
    for (const next of outgoing.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === 1) back.add(linkKey(id, next));
      else if (seen === 0) visit(next);
    }
    state.set(id, 2);
  }

  for (const id of roots) if (state.get(id) === 0) visit(id);
  // Anything left over sits in a component with no entry block of its own.
  for (const id of ids) if (state.get(id) === 0) visit(id);
  return back;
}

/**
 * Longest-path layering: a block sits one column right of its furthest parent.
 * Relaxed iteratively rather than through a topological sort — the graph is
 * already known to be acyclic here, and the node counts are small.
 */
function assignRanks(ids: string[], forward: { from: string; to: string }[]): Map<string, number> {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const link of forward) {
      const want = rank.get(link.from)! + 1;
      if (want > rank.get(link.to)!) {
        rank.set(link.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

/**
 * Reorders `column` so each block sits level with the average position of the
 * neighbours it is wired to in `reference` — the standard barycenter heuristic
 * for untangling crossings. A block with no neighbour in that column holds its
 * current slot instead of collapsing to the top.
 */
function orderByBarycenter(column: string[], reference: string[], neighbours: Map<string, string[]>): void {
  const slot = new Map(reference.map((id, index) => [id, index]));
  const score = new Map<string, number>();

  column.forEach((id, index) => {
    const linked = (neighbours.get(id) ?? []).map((other) => slot.get(other)).filter((s) => s !== undefined);
    score.set(id, linked.length ? linked.reduce((sum, s) => sum + s, 0) / linked.length : index);
  });

  const original = new Map(column.map((id, index) => [id, index]));
  column.sort((a, b) => score.get(a)! - score.get(b)! || original.get(a)! - original.get(b)!);
}

/**
 * Returns the same blocks with fresh coordinates. The layout is anchored to the
 * graph's current top-left corner, so tidying up moves the shape without also
 * teleporting it out of the viewport.
 */
export function autoLayoutNodes(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length < 2) return nodes;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Every walk below reads blocks in this order, never in the order they were
  // created — so tidying the same picture twice gives the same answer. Blocks
  // of one rank end up stacked, so top-to-bottom is the reading order.
  const ids = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((node) => node.id);
  // A self-loop constrains nothing; a dangling edge would rank a ghost block.
  const links = edges.filter((edge) => edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to));

  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    const list = outgoing.get(link.from);
    if (list) list.push(link.to);
    else outgoing.set(link.from, [link.to]);
  }

  // Entry blocks first, topmost first — so the tidied graph keeps the reading
  // order the author already had in mind. A graph made only of rings has none,
  // and findBackEdges opens each of those from its own topmost block.
  const hasIncoming = new Set(links.map((link) => link.to));
  const roots = ids.filter((id) => !hasIncoming.has(id));

  const back = findBackEdges(ids, outgoing, roots);
  const forward = links
    .filter((link) => !back.has(linkKey(link.from, link.to)))
    .map((link) => ({ from: link.from, to: link.to }));

  const rank = assignRanks(ids, forward);

  /*
   * A parentless block is pulled up against its nearest child. Longest-path
   * layering drops every entry into column 0, so a Handler wired straight to
   * a block deep in the graph sat two columns behind it with a long edge
   * lancing across everything between — the author's read of it ("bu node
   * bitta buyoqda bo'lishi kerak") is the correct one: an entry with nothing
   * behind it belongs beside what it feeds. Only parentless blocks move, and
   * only rightward, so no edge is ever made to point backwards by this.
   */
  const hasParent = new Set(forward.map((link) => link.to));
  for (const id of ids) {
    if (hasParent.has(id)) continue;
    const kids = forward.filter((link) => link.from === id).map((link) => rank.get(link.to)!);
    if (!kids.length) continue;
    const beside = Math.min(...kids) - 1;
    if (beside > rank.get(id)!) rank.set(id, beside);
  }

  const columns: string[][] = [];
  for (const id of ids) (columns[rank.get(id)!] ??= []).push(id);
  // A rank is only reached through a chain that fills every rank before it, so
  // there are no gaps; the guard is here because a sparse array would break the
  // sweeps below in a way that is hard to see.
  for (let index = 0; index < columns.length; index += 1) columns[index] ??= [];

  /*
   * An edge that skips a column still has to get *through* it, and cards paint
   * above edges — so without this, a link two ranks long was drawn straight
   * under whatever block happened to sit in between ("tartiblash" left the
   * Anketa's line buried under «Xush kelibsiz»). Each skipped rank gets a
   * virtual stop: it takes part in the ordering sweeps, so the barycenter
   * pulls the line's endpoints level with a clear lane, and it occupies real
   * height in its column, so that lane actually exists between the cards. The
   * stops are dropped before placement — nothing is rendered at them; their
   * whole output is the corridor.
   */
  const virtual = new Set<string>();
  const spans: { from: string; to: string }[] = [];
  for (const link of forward) {
    const gap = rank.get(link.to)! - rank.get(link.from)!;
    if (gap <= 1) {
      spans.push(link);
      continue;
    }
    let previous = link.from;
    for (let step = 1; step < gap; step += 1) {
      const stop = `lane:${link.from}>${link.to}:${step}`;
      virtual.add(stop);
      columns[rank.get(link.from)! + step]!.push(stop);
      spans.push({ from: previous, to: stop });
      previous = stop;
    }
    spans.push({ from: previous, to: link.to });
  }

  // Parents and children restricted to the span edges — the ones the columns
  // were built from, so a back edge can't drag a block out of line.
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const link of spans) {
    const into = parents.get(link.to);
    if (into) into.push(link.from);
    else parents.set(link.to, [link.from]);

    const outOf = children.get(link.from);
    if (outOf) outOf.push(link.to);
    else children.set(link.from, [link.to]);
  }

  for (let pass = 0; pass < ORDER_PASSES; pass += 1) {
    for (let r = 1; r < columns.length; r += 1) orderByBarycenter(columns[r]!, columns[r - 1]!, parents);
    for (let r = columns.length - 2; r >= 0; r -= 1) orderByBarycenter(columns[r]!, columns[r + 1]!, children);
  }

  // What a lane stop is "tall": the corridor an edge needs between two cards.
  // Its share of the column is this plus the sibling gaps on either side.
  const LANE_HEIGHT = 24;
  const heightOf = (id: string) => (virtual.has(id) ? LANE_HEIGHT : nodeHeight(byId.get(id)!));

  const columnHeight = (column: string[]) =>
    column.reduce((sum, id) => sum + heightOf(id), 0) + Math.max(0, column.length - 1) * SIBLING_GAP;
  const tallest = Math.max(...columns.map(columnHeight));

  const originX = Math.min(...nodes.map((node) => node.x));
  const originY = Math.min(...nodes.map((node) => node.y));
  const placed = new Map<string, { x: number; y: number }>();

  let x = originX;
  for (const column of columns) {
    // Each column is centred against the tallest one, which keeps a lone block
    // level with the branches it feeds instead of pinning it to the top margin.
    let y = originY + (tallest - columnHeight(column)) / 2;
    for (const id of column) {
      // A lane stop holds its slot — the corridor — and places nothing in it.
      if (!virtual.has(id)) placed.set(id, { x: snap(x), y: snap(y) });
      y += heightOf(id) + SIBLING_GAP;
    }
    // A column may hold nothing but lanes; it still spaces its neighbours.
    x += Math.max(...column.map((id) => (virtual.has(id) ? 0 : nodeWidth(byId.get(id)!))), 0) + RANK_GAP;
  }

  return nodes.map((node) => {
    const position = placed.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}
