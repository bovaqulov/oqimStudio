import type { FlowEdge, FlowNode } from "@/features/flows";
import { retitleForType } from "../node-registry";

/**
 * Reading a stored graph.
 *
 * Graphs live in the backend, and one written months ago was written under an
 * older block schema. Rather than migrating the database and hoping every row
 * was reachable, each graph is upgraded as it is opened — the editor is the
 * only thing that has to understand both shapes, and it is the only thing that
 * does.
 */
interface StoredGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A node shape saved before "chips" (plain-text quick replies) was replaced by typed "buttons". */
interface LegacyFlowNode extends FlowNode {
  chips?: string[];
}

/** Upgrades a node saved under an older schema so flows already in a user's browser keep working. */
function migrateNode(node: LegacyFlowNode): FlowNode {
  const { chips, ...rest } = node;
  let migrated: FlowNode = rest;

  // "chips" (plain-text quick replies) became typed "buttons".
  if (chips?.length && !migrated.buttons) {
    migrated = {
      ...migrated,
      buttons: chips.map((label, index) => ({ id: `b${index}`, label, kind: "callback" })),
    };
  }

  // A message block's "media" attachment became the broader "contentKind" picker.
  if (migrated.type === "message" && !migrated.contentKind) {
    migrated = { ...migrated, contentKind: migrated.media ?? "text" };
  }

  // Charging for something was a content kind of Xabar, then a block type of
  // its own, and is now neither: «Invoys / To'lov» has been removed from the
  // product. A graph still carrying the old content kind keeps its blocks — the
  // conversion has nowhere to land — so the kind is dropped and what is left is
  // an ordinary Xabar rather than a block the vocabulary would refuse.
  if (migrated.type === "message" && migrated.contentKind === "invoice") {
    const { contentKind: _contentKind, invoice: _invoice, ...rest } = migrated;
    migrated = rest;
  }

  // The Handler that answered /start became a block type of its own. Only a
  // block that answers *nothing else* is converted — a mixed one still holds a
  // command or a keyword the author typed, and that is not this migration's to
  // throw away.
  if (migrated.type === "trigger" && migrated.dmsTrigger?.kinds?.join() === "start") {
    const { dmsTrigger: _dmsTrigger, priority: _priority, ...rest } = migrated;
    migrated = { ...rest, type: "start" };
  }

  return migrated;
}

export function migrateGraph(nodes: FlowNode[], edges: FlowEdge[]): StoredGraph {
  const migrated = nodes.map(migrateNode);
  // An invoice block published "paid"/"cancelled"; both are gone with the type,
  // so an edge still leaving one is moved to the exit every other block has.
  const converted = new Set(
    nodes.filter((node) => (node.type as string) === "invoice").map((node) => node.id),
  );
  return {
    nodes: migrated,
    edges: edges.map((edge) =>
      converted.has(edge.from) && (edge.port === "paid" || edge.port === "cancelled")
        ? { ...edge, port: "out" }
        : edge,
    ),
  };
}
