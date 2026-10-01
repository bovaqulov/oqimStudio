/**
 * Pure graph arithmetic the editor store leans on: ids, grid snapping, free
 * slots for a dropped block, and the running sequence number for titles.
 *
 * Nothing in here touches the store — every function is (input) -> output, so
 * they can be read, tested and reused without standing up an editor.
 */

import type { FlowEdge, FlowNode, ModuleKey, NodeType } from "@/features/flows";
import { autoTitleFor, createNodeDefaults, getNodeDefinition, nodeHeight, nodeWidth } from "../node-registry";

export const GRID_STEP = 8;
export const HISTORY_LIMIT = 60;
export const PATCH_THROTTLE_MS = 800;
/** Long enough to swallow a burst of typing, short enough that "Saqlandi" follows the last keystroke. */
export const AUTOSAVE_DEBOUNCE_MS = 700;
/** Horizontal gap left between a block and the branch block created off one of its ports. */
export const BRANCH_GAP_X = 120;

let edgeSeq = 0;

/**
 * A fresh edge id. Unique within one batch as well as between them — moving a
 * step rewires a whole row in a single set, and `Date.now()` alone hands every
 * one of those edges the same id.
 */
export function newEdgeId(): string {
  edgeSeq += 1;
  return `e${Date.now().toString(36)}${edgeSeq.toString(36)}`;
}

/**
 * Points an exit at a block, replacing whatever it pointed at before.
 *
 * One exit leads to one block, because one block is all the runtime can
 * follow: `Flow.edge()` in `apps/flows/models.py` scans the stored edges,
 * returns the first one matching the port and stops. A second edge on the same
 * port is therefore not a second branch — it is a line the canvas draws and
 * the bot never walks, and *which* of the two runs is decided by the order
 * they happen to sit in the array, which nothing on screen shows.
 *
 * Simple mode has always worked this way and says so where it does the same
 * thing; the canvas did not, so a graph could be built whose two views
 * disagreed about what it contained — Pro drew a branch that Simple listed
 * under "Ulanmagan bloklar" and the customer never saw at all.
 *
 * Re-pointing an exit at the block it already leads to changes nothing, and is
 * reported as having replaced nothing: it is the same edge, not a new one.
 *
 * Returns the displaced edge as well, because the caller is the only one that
 * can say so out loud — an author who did not notice the exit was already
 * wired has just silently lost a connection otherwise.
 */
export function connectPort(
  edges: FlowEdge[],
  from: string,
  port: string,
  to: string,
): { edges: FlowEdge[]; replaced: FlowEdge | null } {
  const occupied = edges.find((edge) => edge.from === from && edge.port === port) ?? null;
  if (occupied?.to === to) return { edges, replaced: null };
  return {
    edges: [...edges.filter((edge) => edge !== occupied), { id: newEdgeId(), from, port, to }],
    replaced: occupied,
  };
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_STEP) * GRID_STEP;
}

export function createNode(id: string, type: NodeType, x: number, y: number, moduleKey: ModuleKey | null): FlowNode {
  const defaults = createNodeDefaults(type, moduleKey);
  return {
    id,
    type,
    x,
    y,
    channel: "tg",
    scopes: ["private"],
    title: defaults.title,
    text: defaults.text,
    ...(defaults.minutes !== undefined ? { minutes: defaults.minutes } : {}),
    ...(defaults.buttons !== undefined ? { buttons: defaults.buttons } : {}),
    ...(defaults.dmsTrigger !== undefined ? { dmsTrigger: defaults.dmsTrigger } : {}),
    ...(defaults.business !== undefined ? { business: defaults.business } : {}),
    ...(defaults.ai !== undefined ? { ai: defaults.ai } : {}),
    ...(defaults.language !== undefined ? { language: defaults.language } : {}),
    ...(defaults.tableWrite !== undefined ? { tableWrite: defaults.tableWrite } : {}),
    ...(defaults.tableRead !== undefined ? { tableRead: defaults.tableRead } : {}),
    // A «Savol» arrives already saving somewhere. Every line above is one
    // field spelled out, which is the shape that lets a default be added to
    // `createNodeDefaults` and quietly never reach a node — the block was
    // added from the palette, looked right in the inspector, and saved
    // without either field, so the answer it collected went nowhere.
    ...(defaults.saveAnswerAs !== undefined ? { saveAnswerAs: defaults.saveAnswerAs } : {}),
    ...(defaults.answerType !== undefined ? { answerType: defaults.answerType } : {}),
  };
}

/**
 * Slides a freshly branched block downward until it stops overlapping the
 * cards already there — five buttons wired one after another would otherwise
 * stack their blocks on the same spot.
 *
 * Down, not sideways, because the flow runs rightward: a branch lands in the
 * column after the block that opened it, and the column is where its siblings
 * belong. The sideways twin this file used to carry went with the change —
 * pushing a branch further right would have walked it into the column its own
 * children are laid out in.
 */
export function freeSlotY(nodes: FlowNode[], x: number, y: number, height: number): number {
  const MARGIN = 12;
  let candidate = y;
  for (let guard = 0; guard < 40; guard += 1) {
    const clash = nodes.some(
      (n) =>
        Math.abs(n.x - x) < nodeWidth(n) &&
        candidate < n.y + nodeHeight(n) + MARGIN &&
        n.y < candidate + height + MARGIN,
    );
    if (!clash) return candidate;
    candidate = snapToGrid(candidate + 24);
  }
  return candidate;
}

export function computeNextSeq(nodes: FlowNode[]): number {
  const highest = nodes.reduce((max, node) => {
    const match = /^n(\d+)$/.exec(node.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return highest + 1;
}

/**
 * What the autosave indicator in the top bar is showing:
 * `idle` — opened, nothing changed yet; `pending` — edits waiting for the
 * debounced write; `saved` — on disk as of `lastSavedAt`; `error` — the
 * browser refused the write.
 */
