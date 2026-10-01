import type { FlowEdge, FlowNode } from "@/features/flows";

export interface Point {
  x: number;
  y: number;
}

export interface PendingConnection {
  fromNodeId: string;
  port: string;
}

export type DragState =
  | { kind: "pan"; startX: number; startY: number; originPan: Point }
  | { kind: "nodes"; nodeIds: string[]; originPositions: Record<string, Point>; startX: number; startY: number };

export interface HistoryEntry {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * A payment provider already connected to this flow's bot. Only connected ones
 * reach the editor: offering a provider that has no token would produce an
 * invoice that fails at send time.
 */
/**
 * A table this flow may write into — name, handle and the columns to fill.
 *
 * Carried into the editor the way payment providers are, and for the same
 * reason: it belongs to the *bot's workspace* and not to the graph, so the
 * canvas cannot derive it and a field that fetched it would fetch it once per
 * block on a canvas that may hold ten.
 */
export interface TableOption {
  id: string;
  name: string;
  handle: string;
  columns: { key: string; label: string }[];
}

export interface PaymentProviderOption {
  id: string;
  name: string;
  /** Currencies this provider accepts — the invoice's currency list narrows to these. */
  currencies: string[];
  /** Unset for Telegram Stars, which has no TEST/LIVE pair. */
  mode?: "test" | "live";
}
