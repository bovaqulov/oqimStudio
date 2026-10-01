/**
 * The editor store's contract: every field a component may read and every
 * action it may call. Implementation lives in `useFlowEditorStore.ts`; a
 * screen that only needs to know *what* the editor can do reads this file and
 * stops.
 */

import type { EditorPlanLimits } from "@/features/billing/editor-limits";
import type { BotLanguages } from "@/features/bots/types";
import type {
  EdgeTransition,
  ExpressionWarning,
  FlowEdge,
  FlowLayoutMode,
  FlowNode,
  FlowRecord,
  ModuleKey,
  NodeType,
} from "@/features/flows";
import type { StatusLabel } from "@/components/ui/types";
import type {
  DragState,
  HistoryEntry,
  PaymentProviderOption,
  PendingConnection,
  Point,
  TableOption,
} from "../types";
import type { SimpleRow } from "../lib/validate-graph";

export type SaveStatus = "idle" | "pending" | "saved" | "error";

export interface FlowEditorState {
  flowId: string | null;
  /** Bot this flow belongs to — the invoice block links to its payment settings. */
  botId: string | null;
  /** Project the flow belongs to — what a flow split out of this one is created under. */
  projectId: string | null;
  moduleKey: ModuleKey | null;
  /**
   * Which of the two editors is on screen. A view setting and nothing else:
   * both modes read and write the same graph, so switching is free and never
   * converts, flattens or drops anything. See [[FlowLayoutMode]].
   */
  layoutMode: FlowLayoutMode;
  /** This is the `dms` module's main flow — the only flow that opens on /start rather than on a Handler. */
  isMain: boolean;
  /** Providers already connected to that bot; the invoice block picks from these. */
  paymentProviders: PaymentProviderOption[];
  /** Tables in this bot's workspace — what «Jadvalga yozish» may pick from. */
  tables: TableOption[];
  name: string;
  description: string;
  status: StatusLabel;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedIds: string[];
  primarySelectedId: string | null;
  /** Edge picked out on the canvas. Never set at the same time as a block selection. */
  selectedEdgeId: string | null;
  /** Block currently open in the expanded editor modal, if any. */
  expandedNodeId: string | null;
  pending: PendingConnection | null;
  mouse: Point;
  pan: Point;
  zoom: number;
  drag: DragState | null;
  live: boolean;
  isNarrowViewport: boolean;
  /**
   * The palette is folded down to its icon rail. A preference, not a layout
   * fact — it survives opening another flow, the way the narrow-viewport rail
   * survives a resize.
   */
  paletteCollapsed: boolean;
  /** The simulator panel is open — it takes the right dock over the inspector. */
  testChatOpen: boolean;
  /**
   * The Script panel is open — the flow's own JavaScript, over everything.
   *
   * A boolean and nothing else: what is *in* the panel is two source files and
   * an inventory the backend answers with, none of which the canvas reads, so
   * keeping them here would put a second copy of a file in the same store that
   * autosaves a graph. The panel owns its own contents and loses them when it
   * closes, which is what makes closing it a question worth asking.
   */
  scriptOpen: boolean;
  /**
   * Which block the next test run opens on, and how many times one was asked
   * for. Two controls set it — the panel's own "Boshlanish" picker and the ▶ on
   * every block card — so it belongs beside `testChatOpen` rather than beside
   * either of them.
   *
   * `nonce` is what makes asking twice mean twice: pressing the same block's ▶
   * again is a request to run it again, and the panel keys its session on both
   * halves. An empty `nodeId` means "wherever this flow starts".
   */
  testChatStart: { nodeId: string; nonce: number };
  past: HistoryEntry[];
  future: HistoryEntry[];
  nextSeq: number;
  /** How the bot presents itself — what the preview's chat header shows. */
  botIdentity: { name: string; avatarEmoji: string };
  /**
   * The languages this flow's bot answers in, and which of them is its own.
   *
   * `null` for a bot that has none configured, which is every bot saved before
   * the setting existed: the text fields then show no language switch at all
   * and every string stays the one string it has always been.
   */
  botLanguages: BotLanguages | null;
  /**
   * What the workspace's plan refuses, as sentences the server wrote.
   *
   * On the store rather than read where it is needed, because the two places
   * that need it are a palette row and a toolbar button and neither may reach
   * a repository. The page reads it once and it travels with the flow, which
   * also means the lock and the graph can never be a render apart.
   */
  planLimits: EditorPlanLimits;
  saveStatus: SaveStatus;
  /** Why the last write was refused — shown next to the indicator, not just a colour. */
  saveError: string | null;
  /**
   * Functions an expression calls that the bot's library does not declare,
   * as of the last save. Kept on the editor rather than derived from the graph
   * because only the backend holds both halves — this flow's text and that
   * bot's library.
   */
  expressionWarnings: ExpressionWarning[];
  /**
   * How many blocks the flow was opened with.
   *
   * The one thing that separates "the author deleted everything" from "the
   * graph never arrived": an empty canvas with edits behind it is a decision,
   * an empty canvas with none is a failed load — and autosaving that would
   * replace a working flow with nothing.
   */
  loadedNodeCount: number;
  /** Set when the graph did not load. Editing and saving are both off. */
  readOnly: boolean;
  /** When the last successful write landed — `null` until the first one. */
  lastSavedAt: number | null;

  initialize: (
    flow: FlowRecord,
    context?: {
      paymentProviders?: PaymentProviderOption[];
      tables?: TableOption[];
      botIdentity?: { name: string; avatarEmoji: string };
      botLanguages?: BotLanguages;
      planLimits?: EditorPlanLimits;
    },
  ) => void;
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setNarrow: (narrow: boolean) => void;
  setLayoutMode: (mode: FlowLayoutMode) => void;
  togglePalette: () => void;
  toggleLive: () => Promise<void>;
  toggleTestChat: () => void;
  closeTestChat: () => void;
  toggleScript: () => void;
  closeScript: () => void;
  /**
   * Opens the test chat at one block — what a card's ▶ does, and what the
   * panel's own start picker does with the panel already open.
   *
   * Opening is only ever a step towards showing the run: pressing ▶ on a second
   * card while the chat is open has to move the run, not close the panel that
   * would show it, which is why this is not `toggleTestChat` with an argument.
   */
  openTestChat: (nodeId?: string) => void;
  /** ⌘S: writes and says so. The toast is what a keypress is owed. */
  save: () => Promise<void>;
  /**
   * The same write with nothing said about it — for a save somebody did not
   * ask for but that has to happen anyway.
   *
   * The test chat is the caller: it writes the canvas before starting a run,
   * because the runtime reads what is stored, and it was doing that through
   * `save`. So pressing «Sinash» raised «Oqim saqlandi · 4 blok» over the panel
   * that was opening underneath it, on top of «Runtime javobini kutmoqda…» —
   * two announcements about one press, one of which is about something the
   * reader never did.
   */
  saveQuietly: () => Promise<boolean>;
  /** Writes a pending autosave out immediately — for leaving the page or hiding the tab. */
  flushSave: () => void;

  select: (id: string | null, additive: boolean) => void;
  selectAll: () => void;
  /** Picks out an edge (or clears the pick with `null`) so Delete can act on it. */
  selectEdge: (edgeId: string | null) => void;
  expandNode: (id: string) => void;
  collapseNode: () => void;

  addNode: (type: NodeType) => void;
  /** Creates a block already wired to `port` — the "answer this button with…" shortcut. */
  addConnectedNode: (fromNodeId: string, port: string, type: NodeType) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  /** Removes the blocks a split has just moved into another flow. */
  applyExtraction: (movedIds: string[]) => void;
  /** Re-flows every block into left-to-right columns by its distance from a trigger. */
  autoLayout: () => void;
  /**
   * Simple mode's three graph edits, all expressed as list moves. They rewire
   * `out` edges and nothing else, because `out` is what the list order means —
   * a named exit is a branch and keeps whatever it is wired to.
   */
  spliceSimpleStep: (type: NodeType, at: { nodeId: string; port: string }, patch?: Partial<FlowNode>) => void;
  /**
   * Wires an exit to a block that already exists — the "back to an earlier
   * step" a menu needs, which Simple mode could read off a graph but never
   * write into one.
   */
  linkSimpleStep: (at: { nodeId: string; port: string }, toNodeId: string) => void;
  /**
   * `within` is the row the step is being moved in, when the caller already
   * has it — the chat view walks its own screens, which need not be the rows
   * the outline would find.
   */
  reorderSimpleStep: (nodeId: string, toIndex: number, within?: SimpleRow) => void;
  removeSimpleStep: (nodeId: string) => void;
  patchNode: (id: string, patch: Partial<FlowNode>) => void;
  nudgeSelected: (dx: number, dy: number) => void;

  startNodeInteraction: (nodeId: string, additive: boolean, clientX: number, clientY: number) => void;
  beginPanDrag: (clientX: number, clientY: number) => void;
  updateDrag: (clientX: number, clientY: number) => void;
  endDrag: () => void;

  startConnection: (fromNodeId: string, port: string) => void;
  updatePendingMouse: (x: number, y: number) => void;
  completeConnection: (toNodeId: string) => void;
  cancelConnection: () => void;
  /** Sets — or with `undefined`, clears — what an edge does to the message on screen. */
  setEdgeTransition: (edgeId: string, transition: EdgeTransition | undefined) => void;
  /** Seconds to hold a `delete` transition back for; 0 removes the old message first. */
  setEdgeDeleteDelay: (edgeId: string, seconds: number) => void;
  deleteEdge: (edgeId: string) => void;

  zoomBy: (delta: number) => void;
  setZoom: (zoom: number) => void;
  fitView: (viewport: { width: number; height: number }) => void;
  /** Puts a graph-space point in the middle of the visible canvas — the minimap's click target. */
  centerOn: (point: Point, viewport: { width: number; height: number }) => void;
  /** Selects a block and brings it into view. What the block search hands over. */
  focusNode: (id: string, viewport: { width: number; height: number }) => void;

  undo: () => void;
  redo: () => void;
}
