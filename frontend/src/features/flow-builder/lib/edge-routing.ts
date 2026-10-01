import type { FlowNode } from "@/features/flows";
import type { NodePort } from "../node-registry";
import { getNodePorts, nodeHeight, nodeInputDy, nodeWidth, suppressedBackPort } from "../node-registry";

export interface Point {
  x: number;
  y: number;
}

/** Shortest reach of a control point, so even a tiny hop still reads as a curve. */
const MIN_REACH = 34;
/**
 * Reach of a backward edge — one that has to travel back across the canvas —
 * as a fraction of how far back it goes, and the ceiling that keeps a long
 * return from ballooning past the graph. Blocks are laid out left to right, so
 * the case this pair is tuned for is a "back to the main menu" link.
 */
const BACKWARD_REACH_RATIO = 0.38;
const BACKWARD_REACH_MAX = 130;
/** Vertical bow given to a backward edge whose ports sit on the same row. */
const LEVEL_BOW = 80;
/**
 * How far from the output port an edge's chip sits. A long run labelled at its
 * midpoint puts the text in open canvas, equidistant from both cards and
 * belonging to neither; anchoring the chip near the port it leaves keeps it
 * readable as "this exit goes there".
 */
const LABEL_LEAD = 78;

/**
 * Where an edge leaves a card: the right edge, at the port's own offset down
 * it. Every port lives on that edge now — see [[NodePort]] — so this no longer
 * has a side to branch on, and neither does the routing below.
 */
/**
 * The port an edge names, as far as this block still knows it.
 *
 * `getNodePorts` first, because that is what the card drew and what the backend
 * publishes. Then the back row of a block that carries one and cannot send it:
 * an album takes no keyboard, so nothing publishes that exit any more, but the
 * row is still on the card and an edge saved while it was an exit is still on
 * the canvas. Anchoring it anywhere but its own row would move the author's
 * line onto a dot that means something else — see [[suppressedBackPort]].
 */
function anchorPort(node: FlowNode, portId: string): NodePort | undefined {
  const found = getNodePorts(node).find((port) => port.id === portId);
  if (found) return found;
  const suppressed = suppressedBackPort(node);
  return suppressed?.id === portId ? suppressed : undefined;
}

/** Which edge of the card a port's line actually leaves by — see [[portAnchor]]. */
export function portSide(node: FlowNode, portId: string, towards?: Point | null): "left" | "right" {
  const port = anchorPort(node, portId);
  if (port?.side === "left") return "left";
  if (port?.kind === "button" && towards && towards.x < node.x) return "left";
  return "right";
}

export function portAnchor(node: FlowNode, portId: string, towards?: Point | null): Point {
  const ports = getNodePorts(node);
  const port = anchorPort(node, portId) ?? ports[0];
  // The back row's exit always leaves the left edge — an exit meaning "back"
  // drawn as a forward arrow is a picture of the opposite of what it does.
  if (port?.side === "left") return { x: node.x, y: node.y + port.offset };
  /*
   * A keyboard row leaves by whichever side its target is on. Both sides carry
   * a dot and both are exits; this picks the one that makes the shorter line.
   * Without it a row wired to a block behind it — the common "back to the
   * menu" shape — sent its edge out of the right edge and looped the whole
   * card before turning round, crossing everything in between.
   *
   * The comparison is against the card's own left edge, not its centre: a
   * target that merely overlaps the card is still ahead of it, and switching
   * sides for that draws a line that doubles back on itself.
   */
  if (port?.kind === "button" && towards && towards.x < node.x) {
    return { x: node.x, y: node.y + port.offset };
  }
  // A block can publish no exit at all — «Tugatish» — and a graph written by
  // something other than this editor (a template, an older save, the API) can
  // still carry an edge leaving one. Falling back to the block's own input
  // height draws that stale edge where it can be seen and deleted; reading
  // `ports[0]` unconditionally threw, and one bad edge took the whole canvas
  // down with it.
  return { x: node.x + nodeWidth(node), y: node.y + (port?.offset ?? nodeInputDy(node)) };
}

/** Where an edge lands: the left edge of the target, level with its body. */
export function targetInPoint(node: FlowNode): Point {
  return { x: node.x, y: node.y + nodeInputDy(node) };
}

export interface RoutedEdge {
  path: string;
  /**
   * The one spot an edge puts anything of its own: its branch chip, or the
   * remove control that takes the chip's place while the edge is selected. A
   * short way along the curve rather than at its middle — see LABEL_LEAD.
   */
  labelX: number;
  labelY: number;
}

/** The point at parameter `t` on a cubic Bézier. */
function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

/**
 * Walks forward along the curve until the chip clears the output port by
 * LABEL_LEAD, and never past the midpoint — a short hop has no room for the
 * lead, so it keeps labelling itself in the middle as before.
 */
function labelPoint(p0: Point, c1: Point, c2: Point, p3: Point): Point {
  for (let step = 1; step < 16; step += 1) {
    const point = cubicAt(p0, c1, c2, p3, step / 32);
    if (Math.hypot(point.x - p0.x, point.y - p0.y) >= LABEL_LEAD) return point;
  }
  return cubicAt(p0, c1, c2, p3, 0.5);
}

/**
 * One cubic Bézier per edge. Every curve leaves its source horizontally and
 * enters its target horizontally, from the left, which is what makes a
 * connection read as the same smooth step across into the next card regardless
 * of where the two sit.
 *
 * Curves are deliberately not routed around other cards: nodes paint above
 * this layer, so a curve that passes a card simply runs behind it — the same
 * convention every node editor uses, and far calmer to look at than the
 * detour lanes an obstacle search produces.
 */
function curve(p0: Point, c1: Point, c2: Point, p3: Point): RoutedEdge {
  const label = labelPoint(p0, c1, c2, p3);
  return {
    path: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
    labelX: label.x,
    labelY: label.y,
  };
}

/** How far a control point reaches out of its port, along the port's own axis. */
function reach(gap: number): number {
  if (gap >= 0) return Math.max(gap * 0.5, MIN_REACH);
  // Halving a negative gap would pull the controls inward and kink the curve,
  // so a backward edge reaches outward instead — capped, or a long return would
  // swing far wider than the graph it belongs to.
  return Math.min(BACKWARD_REACH_MAX, Math.max(MIN_REACH, BACKWARD_REACH_RATIO * -gap));
}

/**
 * A node wired back into itself leaves its own right edge and re-enters its
 * own left edge, so horizontal controls alone would collapse into a line drawn
 * straight back through the card. Dropping both controls below it turns the
 * edge into a round loop under the block.
 */
function selfLoop(node: FlowNode, start: Point, end: Point): RoutedEdge {
  const drop = nodeHeight(node) / 2 + 62;
  const lead = 84;
  return curve(start, { x: start.x + lead, y: start.y + drop }, { x: end.x - lead, y: end.y + drop }, end);
}

export function routeEdge(
  start: Point,
  end: Point,
  selfNode: FlowNode | null,
  /**
   * Which way the edge leaves its port. "left" for a row that exits the card's
   * left edge — without it the curve reached *right* out of a left-hand dot
   * and swung back across the card before heading where it was going.
   */
  startSide: "left" | "right" = "right",
): RoutedEdge {
  if (selfNode) return selfLoop(selfNode, start, end);

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // A backward edge between ports on the same row would otherwise be drawn as
  // a straight line running through both cards; bow it downward instead,
  // easing the bow out as the two ports drift apart vertically.
  const bow = dx < 0 ? Math.max(0, LEVEL_BOW - Math.abs(dy)) : 0;
  // Each end reaches along its *own* axis. The target is always entered from
  // its left, so its control always sits to the left of it; the source's
  // control follows the side it actually left by, which is the whole point of
  // a left-hand exit — the line should start off in the direction it means.
  const out = reach(startSide === "left" ? -Math.abs(dx) || dx : dx);
  const from = startSide === "left" ? start.x - out : start.x + out;
  return curve(start, { x: from, y: start.y + bow }, { x: end.x - reach(dx), y: end.y + bow }, end);
}
