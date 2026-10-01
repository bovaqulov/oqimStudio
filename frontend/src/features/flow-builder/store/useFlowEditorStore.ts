import { create } from "zustand";
import { askConfirm } from "@/components/ui/confirm-store";
import { showToast } from "@/components/ui/toast-store";
import { NO_PLAN_LIMITS } from "@/features/billing/editor-limits";
import type { BotLanguages } from "@/features/bots/types";
import type { FlowEdge, FlowLayoutMode, FlowNode, FlowRecord, ModuleKey, NodeType } from "@/features/flows";
import type { StatusLabel } from "@/components/ui/types";
import {
  acceptsIncomingEdge,
  applyEntryRule,
  autoTitleFor,
  carriedRowPorts,
  createNodeDefaults,
  getNodeDefinition,
  hasOutPort,
  isFixedNodeType,
  getNodePorts,
  nodeHeight,
  nodeInputDy,
  nodeWidth,
  pruneUnsupportedButtons,
} from "../node-registry";
import { autoLayoutNodes } from "../lib/auto-layout";
import { MAX_DELETE_DELAY } from "../lib/transitions";
import { dockWidth, paletteWidth, panelInset } from "../lib/layout";
import { buttonIdFromPort, nodeButtons } from "../lib/buttons";
import { DEFAULT_LANGUAGE, resolveText } from "@/features/flows/localized-text";
import { portAnchor } from "../lib/edge-routing";
import { migrateGraph } from "../lib/persistence";
import { buildSimpleOutline, findSimpleRow, validateGraph } from "../lib/validate-graph";
import { saveFlowGraphAction, setFlowLayoutModeAction, setFlowLiveAction } from "@/features/flows/graph-actions";
import type { DragState, HistoryEntry, PendingConnection, Point } from "../types";
import {
  AUTOSAVE_DEBOUNCE_MS,
  BRANCH_GAP_X,
  GRID_STEP,
  HISTORY_LIMIT,
  PATCH_THROTTLE_MS,
  computeNextSeq,
  connectPort,
  createNode,
  freeSlotY,
  newEdgeId,
  snapToGrid,
} from "./graph-helpers";
import type { FlowEditorState, SaveStatus } from "./editor-state";

export type { FlowEditorState, SaveStatus } from "./editor-state";

let lastSnapshotAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useFlowEditorStore = create<FlowEditorState>()((set, get) => {
  /** Sends the whole graph, so it runs once per burst of edits rather than once per keystroke. */
  async function writeNow(): Promise<boolean> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const state = get();
    if (!state.flowId) return false;
    const { flowId, nodes, edges, name, description } = state;

    // Refusing to save is the safe answer here. A canvas that is empty without
    // a single edit behind it did not lose its blocks — it never received
    // them, and writing that over the stored flow would destroy it.
    if (nodes.length === 0 && state.loadedNodeCount > 0 && state.past.length === 0) {
      set({
        readOnly: true,
        saveStatus: "error",
        saveError: "Grafik yuklanmadi — saqlash to'xtatildi. Sahifani yangilang.",
      });
      return false;
    }

    // The editor stays interactive while the save is in flight, and the
    // indicator tells the truth when it lands. A failed save leaves the canvas
    // as it is — the work is not lost, and the reason is kept so the top bar
    // can say what went wrong instead of turning a dot red.
    try {
      const result = await saveFlowGraphAction(flowId, nodes, edges, name, description);
      if (get().flowId !== flowId) return result.ok;
      set(
        result.ok
          ? {
              saveStatus: "saved",
              saveError: null,
              lastSavedAt: Date.now(),
              // Replaced wholesale, never merged: a function the author has
              // just written into the library must clear its own warning, and
              // a list that only ever grew would keep saying otherwise.
              expressionWarnings: result.expressionWarnings ?? [],
            }
          : { saveStatus: "error", saveError: result.message ?? "Saqlab bo'lmadi." },
      );
      return result.ok;
    } catch {
      if (get().flowId === flowId) {
        set({ saveStatus: "error", saveError: "Server javob bermadi — ulanishni tekshiring." });
      }
      return false;
    }
  }

  /**
   * Autosave. Every mutation calls this; the writes themselves are coalesced
   * behind a short debounce, which is what makes "Saqlanmoqda…" a real state
   * and not a decoration. Anything that could lose that window — closing the
   * tab, leaving the editor, opening another flow — flushes it first.
   */
  function persistCurrent() {
    if (!get().flowId) return;
    set({ saveStatus: "pending" });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void writeNow(), AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * The name a step gets when it is opened from a button.
   *
   * A block reached by tapping "Narxlar" *is* the answer to "Narxlar", and the
   * author has already typed that word once. Left to the generic default every
   * such block arrives called "Xabar", so a menu with five buttons produces
   * five identically-named cards and the graph stops saying which branch is
   * which — exactly the thing the card's name is there to answer.
   *
   * Empty for a plain exit, and empty for a button with no label yet: a blank
   * title falls back to the block kind, which is better than a card named "".
   */
  function titleFromPort(from: FlowNode, port: string): string {
    const buttonId = buttonIdFromPort(port);
    if (!buttonId) return "";
    const button = nodeButtons(from).find((candidate) => candidate.id === buttonId);
    if (!button) return "";
    // The bot's own language, the one the canvas is read in — not whichever
    // tab the Inspector happens to have open.
    const label = resolveText(button.label, get().botLanguages?.main ?? DEFAULT_LANGUAGE).trim();
    return uniqueTitle(label);
  }

  /**
   * The same name, but not twice.
   *
   * A branch is named after the button that opens it, which is right the first
   * time and wrong the second: a menu button leading to a question and then to
   * a thank-you produced three cards all called «Shifokorga yozilish», and the
   * graph stopped saying which one a line went to — which is the one job a
   * card's name has. Numbered from the second one, so the branch that was
   * always called that keeps its name.
   */
  function uniqueTitle(base: string): string {
    if (!base) return "";
    const taken = new Set(get().nodes.map((node) => node.title));
    if (!taken.has(base)) return base;
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base} ${index}`;
      if (!taken.has(candidate)) return candidate;
    }
    return base;
  }

  function pushHistory(throttle: boolean) {
    const now = Date.now();
    if (throttle && now - lastSnapshotAt < PATCH_THROTTLE_MS) return;
    lastSnapshotAt = now;
    const state = get();
    const past = [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-HISTORY_LIMIT);
    set({ past, future: [] });
  }

  return {
    flowId: null,
    botId: null,
    projectId: null,
    moduleKey: null,
    layoutMode: "simple",
    isMain: false,
    paymentProviders: [],
    tables: [],
    name: "",
    description: "",
    status: { label: "Faol", tone: "success" },
    nodes: [],
    edges: [],
    selectedIds: [],
    primarySelectedId: null,
    selectedEdgeId: null,
    expandedNodeId: null,
    pending: null,
    mouse: { x: 0, y: 0 },
    pan: { x: 20, y: 10 },
    zoom: 0.9,
    drag: null,
    live: true,
    isNarrowViewport: false,
    paletteCollapsed: false,
    testChatOpen: false,
    scriptOpen: false,
    testChatStart: { nodeId: "", nonce: 0 },
    past: [],
    future: [],
    nextSeq: 1,
    botIdentity: { name: "Bot", avatarEmoji: "🤖" },
    botLanguages: null,
    planLimits: NO_PLAN_LIMITS,
    saveStatus: "idle",
    saveError: null,
    expressionWarnings: [],
    loadedNodeCount: 0,
    readOnly: false,
    lastSavedAt: null,

    initialize: (flow, context) => {
      // Whatever the previous flow still owed storage is written under *its*
      // id, before this one takes the store over.
      if (saveTimer) writeNow();
      // The saved graph is the graph: it comes from the server, migrated on the
      // way in for the fields that have been renamed since it was written.
      const stored = migrateGraph(flow.nodes, flow.edges);
      // A graph built before its module gained a rule would otherwise open in a
      // state the editor has no controls for — keyboard rows it cannot edit, or
      // a second Handler the palette can no longer add — so both rules are
      // applied to what is loaded rather than only to what is edited from here on.
      const pruned = pruneUnsupportedButtons(stored.nodes, stored.edges, flow.moduleKey);
      const entry = applyEntryRule(pruned.nodes, pruned.edges, {
        moduleKey: flow.moduleKey,
        isMain: flow.isMain ?? false,
      });
      const { nodes, edges } = entry;
      lastSnapshotAt = 0;
      set({
        flowId: flow.id,
        botId: flow.botId,
        projectId: flow.projectId,
        moduleKey: flow.moduleKey,
        // A flow written before the setting existed opens the way a new one
        // does — the simple list — which is also what the backend defaults to.
        layoutMode: flow.layoutMode ?? "simple",
        isMain: flow.isMain ?? false,
        paymentProviders: context?.paymentProviders ?? [],
        tables: context?.tables ?? [],
        botIdentity: context?.botIdentity ?? { name: "Bot", avatarEmoji: "🤖" },
        botLanguages: context?.botLanguages ?? null,
        // Nothing locked when the page did not say — an editor that guessed at
        // a plan would be inventing refusals, which is worse than missing one.
        planLimits: context?.planLimits ?? NO_PLAN_LIMITS,
        name: flow.name,
        description: flow.description,
        status: flow.status,
        nodes,
        edges,
        selectedIds: [],
        primarySelectedId: null,
        selectedEdgeId: null,
        expandedNodeId: null,
        pending: null,
        mouse: { x: 0, y: 0 },
        pan: { x: 20, y: 10 },
        zoom: 0.9,
        drag: null,
        testChatOpen: false,
        // Closed on every load, and it has to be: the panel holds one flow's
        // script, and leaving it open across a load would show the file of the
        // flow that was on screen a moment ago over the one that is now.
        scriptOpen: false,
        // Block ids restart at `n1` in every flow, so a start asked for in the
        // last one would silently name a different block here.
        testChatStart: { nodeId: "", nonce: 0 },
        live: flow.status.tone === "success",
        past: [],
        future: [],
        nextSeq: computeNextSeq(nodes),
        saveStatus: "idle",
        saveError: null,
        // Another flow's missing functions are not this one's. Cleared rather
        // than kept until the first save, which would put a warning naming a
        // block that is no longer on screen at the top of the panel.
        expressionWarnings: [],
        loadedNodeCount: nodes.length,
        readOnly: false,
        lastSavedAt: null,
      });
      // Blocks the rule took away were the author's, so it is said out loud —
      // and written back, so what opens next time is the graph they were just
      // shown rather than this same cleanup over and over.
      if (entry.removed) {
        showToast(`${entry.removed} ta ortiqcha handler olib tashlandi — oqimda bitta handler bo'ladi`);
        persistCurrent();
      }
    },

    // Both write. Neither did, which is the whole of the «Nomsiz oqim» bug:
    // the store held the new name, the autosave sent only the graph, and the
    // next load read the old one back out of the database.
    setName: (name) => {
      set({ name });
      persistCurrent();
    },
    setDescription: (description) => {
      set({ description });
      persistCurrent();
    },
    setNarrow: (narrow) => set({ isNarrowViewport: narrow }),
    // Nothing to convert and nothing to save first: the two modes are two
    // readings of one graph, and whatever is owed to storage is owed either
    // way. The choice is meant to outlive the tab — `layoutMode` is a stored
    // field on the flow — but the PATCH that writes it back is not wired yet,
    // so for now it lasts as long as the editor is open.
    // The expanded block goes with it: Simple mode expands a card in place and
    // Pro mode opens the same state as a dialog, so carrying it across would
    // answer a click in one view with a modal in the other.
    setLayoutMode: (layoutMode) => {
      // Clearing the expansion matters: an inline card in Simple mode and a
      // dialog in Pro are the same `expandedNodeId`, and switching would
      // otherwise open one as the other.
      set({ layoutMode, expandedNodeId: null });
      const flowId = get().flowId;
      // A view preference, remembered for next time. Deliberately not awaited
      // and deliberately not surfaced: a failed write must not stand between
      // somebody and the editor they asked for.
      if (flowId) void setFlowLayoutModeAction(flowId, layoutMode);
    },
    togglePalette: () => set((state) => ({ paletteCollapsed: !state.paletteCollapsed })),
    toggleTestChat: () => set((state) => ({ testChatOpen: !state.testChatOpen })),
    closeTestChat: () => set({ testChatOpen: false }),
    // Opening the script flushes whatever the canvas has not written yet. The
    // panel's expression inventory is read from the *stored* graph, so a block
    // renamed a second ago would otherwise be listed under its old name — and
    // the author would be looking at a list that disagrees with the canvas
    // behind it for no reason they could see.
    toggleScript: () => {
      const state = get();
      // Opening is the moment to refuse, not saving. A plan that does not run
      // scripts is a plan whose author must not spend an afternoon writing
      // hooks that «Yoqish» then turns down — which is `check_graph_allows`
      // for the AI block, one item earlier, all over again.
      //
      // Closing is never refused: whatever is on screen has to be closable,
      // including a panel opened before the plan changed under it.
      if (!state.scriptOpen && state.planLimits.script) {
        showToast(state.planLimits.script);
        return;
      }
      if (!state.scriptOpen) get().flushSave();
      set({ scriptOpen: !state.scriptOpen });
    },
    closeScript: () => set({ scriptOpen: false }),
    openTestChat: (nodeId = "") =>
      set((state) => ({
        testChatOpen: true,
        testChatStart: { nodeId, nonce: state.testChatStart.nonce + 1 },
      })),
    // Publishing is a server decision, not a local one: the plan is checked
    // when a flow is switched *on* (saving is never refused — deleting the
    // block that breaks the plan is itself a save). The switch moves first so
    // the click feels immediate, and puts itself back if the answer is no.
    toggleLive: async () => {
      const state = get();
      const live = !state.live;
      const flowId = state.flowId;

      /*
       * Going live is asked about; going quiet is not.
       *
       * The warnings panel has always known that a flow has a button wired to
       * nothing or a block no path reaches, and publishing walked straight past
       * it — so a clinic flow went live with two of three specialists leading
       * nowhere and nothing between the author and that but a badge they had
       * not opened. The list still does not *block* anything: a half-built flow
       * is a normal thing to have, and the answer is theirs.
       */
      if (live) {
        const findings = validateGraph(state.nodes, state.edges, state.botLanguages?.main);
        if (findings.length > 0) {
          const first = findings[0]!;
          const rest = findings.length - 1;
          const ok = await askConfirm({
            title: "Oqimda tugallanmagan joylar bor",
            message:
              `${findings.length} ta ogohlantirish: ${first.message}` +
              (rest > 0 ? ` Yana ${rest} ta.` : "") +
              " Baribir ishga tushirilsinmi?",
            confirmText: "Ishga tushirish",
            destructive: false,
          });
          if (!ok) return;
        }
      }

      set({ live });
      if (!flowId) return;

      // The backend reads the *stored* graph to decide, so anything the
      // author has just drawn has to be on disk before it is asked.
      await writeNow();
      const result = await setFlowLiveAction(flowId, live);
      if (get().flowId !== flowId) return;
      if (!result.ok) {
        set({ live: !live });
        showToast(result.message ?? "Holatni o'zgartirib bo'lmadi");
        return;
      }
      showToast(live ? "Oqim ishga tushdi" : "Oqim to'xtatildi");
    },
    // ⌘S does what autosave would have done anyway, just without the wait —
    // the toast is the acknowledgement someone pressing it is asking for.
    save: async () => {
      const blocks = get().nodes.length;
      const ok = await writeNow();
      showToast(ok ? `Oqim saqlandi · ${blocks} blok` : (get().saveError ?? "Saqlab bo'lmadi"));
    },
    saveQuietly: () => writeNow(),
    flushSave: () => {
      if (saveTimer) void writeNow();
    },

    select: (id, additive) => {
      // Blocks and edges share one Delete key, so picking either one drops the other.
      if (!id) {
        set({ selectedIds: [], primarySelectedId: null, selectedEdgeId: null });
        return;
      }
      const state = get();
      if (additive) {
        const has = state.selectedIds.includes(id);
        const selectedIds = has ? state.selectedIds.filter((x) => x !== id) : [...state.selectedIds, id];
        set({
          selectedIds,
          primarySelectedId: has ? (selectedIds[selectedIds.length - 1] ?? null) : id,
          selectedEdgeId: null,
        });
      } else {
        set({ selectedIds: [id], primarySelectedId: id, selectedEdgeId: null });
      }
    },
    selectAll: () => {
      const ids = get().nodes.map((n) => n.id);
      set({ selectedIds: ids, primarySelectedId: ids[ids.length - 1] ?? null, selectedEdgeId: null });
      showToast(`${ids.length} blok tanlandi`);
    },
    // Clearing `pending` matters: the edge swallows the mousedown that would
    // otherwise reach the canvas and cancel a half-drawn connection, which
    // would leave the dashed preview trailing the cursor with nothing to end it.
    selectEdge: (edgeId) =>
      set({ selectedEdgeId: edgeId, selectedIds: [], primarySelectedId: null, pending: null }),

    expandNode: (id) => set({ expandedNodeId: id, selectedIds: [id], primarySelectedId: id }),
    collapseNode: () => set({ expandedNodeId: null }),

    addNode: (type) => {
      const state = get();
      // The palette no longer offers the entry blocks, but the digit shortcuts
      // read the same list — so the one place that creates blocks says no to
      // them once, rather than every caller remembering to.
      if (isFixedNodeType(type)) {
        showToast(`«${getNodeDefinition(type).kindLabel}» oqimda bitta bo'ladi — u allaqachon shu yerda`);
        return;
      }
      // The same answer the palette row is already showing, said again for
      // whoever pressed a number key instead of reading it. Refused here and
      // not on save, because a block that can be drawn and cannot be switched
      // on is the whole complaint: the flow gets built around it first.
      const locked = state.planLimits.blocks[type];
      if (locked) {
        showToast(locked);
        return;
      }
      pushHistory(false);
      const id = `n${state.nextSeq}`;
      const x = snapToGrid((-state.pan.x + 320) / state.zoom);
      const wanted = snapToGrid((-state.pan.y + 180) / state.zoom);
      const draft = createNode(id, type, x, wanted, state.moduleKey);
      // A new block drops into the first free slot on its column instead of
      // stacking on whatever is already sitting there.
      const node = { ...draft, y: freeSlotY(state.nodes, x, wanted, nodeHeight(draft)) };
      set({ nodes: [...state.nodes, node], selectedIds: [id], primarySelectedId: id, nextSeq: state.nextSeq + 1 });
      persistCurrent();
      showToast(`${getNodeDefinition(type).kindLabel} bloki qo'shildi`);
    },

    addConnectedNode: (fromNodeId, port, type) => {
      const state = get();
      const from = state.nodes.find((n) => n.id === fromNodeId);
      if (!from) return;
      // "Answer this button with…" reaches the same block types the palette
      // does, so it has to reach the same refusal — otherwise the one door the
      // lock does not cover is the one an author uses most.
      const locked = state.planLimits.blocks[type];
      if (locked) {
        showToast(locked);
        return;
      }
      pushHistory(false);
      const id = `n${state.nextSeq}`;
      const x = snapToGrid(from.x + nodeWidth(from) + BRANCH_GAP_X);
      const named = titleFromPort(from, port);
      const draft = createNode(id, type, x, 0, state.moduleKey);
      if (named) draft.title = named;
      // Line the new block's *input* up with the port it answers, rather than
      // its middle: the two anchors then sit at the same height and the edge
      // between them is drawn dead straight. Then push it clear of whatever
      // already sits in that column.
      const anchor = portAnchor(from, port);
      const height = nodeHeight(draft);
      const wanted = snapToGrid(anchor.y - nodeInputDy(draft));
      const node = { ...draft, y: freeSlotY(state.nodes, x, wanted, height) };
      // The exit may already lead somewhere: dragging from a port that is
      // wired looks exactly like dragging from one that is not, since an `out`
      // dot is drawn filled either way.
      const { edges, replaced } = connectPort(state.edges, fromNodeId, port, id);
      set({
        nodes: [...state.nodes, node],
        edges,
        selectedIds: [id],
        primarySelectedId: id,
        nextSeq: state.nextSeq + 1,
        pending: null,
      });
      persistCurrent();
      showToast(
        replaced
          ? `${getNodeDefinition(type).kindLabel} bloki ulandi — avvalgi bog'lanish uzildi`
          : `${getNodeDefinition(type).kindLabel} bloki ulandi`,
      );
    },

    /**
     * Puts a new step into the list at `at` — the exit it should run after.
     * Whatever that exit already led to now runs after the new step instead, so
     * a step added halfway down the list lands halfway down the conversation
     * rather than at the end of it.
     *
     * It is placed on the canvas the same way the "answer this button with…"
     * shortcut places one: beside the exit it hangs off, slid clear of
     * whatever is already in that column. Simple mode draws no coordinates,
     * but Pro mode reads the same graph and must not open on a pile.
     */
    linkSimpleStep: (at, toNodeId) => {
      const state = get();
      if (at.nodeId === toNodeId) {
        // A block wired to itself is a conversation that never moves on, and
        // the canvas draws it as a loop under the card nobody meant to make.
        showToast("Qadamni o'ziga ulab bo'lmaydi");
        return;
      }
      if (!state.nodes.some((node) => node.id === toNodeId)) return;
      pushHistory(false);
      // One edge per exit, like every other way of wiring one: the branch is
      // being pointed somewhere new, not given a second destination.
      const { edges } = connectPort(state.edges, at.nodeId, at.port, toNodeId);
      set({ edges });
      persistCurrent();
    },

    spliceSimpleStep: (type, at, patch) => {
      const state = get();
      const from = state.nodes.find((n) => n.id === at.nodeId);
      if (!from) return;
      if (isFixedNodeType(type)) {
        showToast(`«${getNodeDefinition(type).kindLabel}» oqimda bitta bo'ladi — u allaqachon shu yerda`);
        return;
      }
      pushHistory(false);
      const id = `n${state.nextSeq}`;
      const x = snapToGrid(from.x + nodeWidth(from) + BRANCH_GAP_X);
      const named = titleFromPort(from, at.port);
      const draft = {
        ...createNode(id, type, x, 0, state.moduleKey),
        // Under the button's name, unless the caller named it itself — a patch
        // carries a decision somebody made, and a default must not beat one.
        ...(named ? { title: named } : {}),
        ...patch,
      };
      const anchor = portAnchor(from, at.port);
      const height = nodeHeight(draft);
      const wanted = snapToGrid(anchor.y - nodeInputDy(draft));
      const node = { ...draft, y: freeSlotY(state.nodes, x, wanted, height) };

      const { edges: rewired, replaced: occupied } = connectPort(state.edges, at.nodeId, at.port, id);
      const edges = [...rewired];
      // Only where the new step has an exit to hand the rest of the row on
      // through. «Tugatish» has none, so whatever followed this exit stays
      // where it is and shows up under "Ulanmagan qadamlar" — a state the
      // author can see and undo, unlike an edge leaving a port the block never
      // published, which nothing would ever walk.
      if (occupied && hasOutPort(node)) edges.push({ id: newEdgeId(), from: id, port: "out", to: occupied.to });

      set({
        nodes: [...state.nodes, node],
        edges,
        selectedIds: [id],
        primarySelectedId: id,
        // Opened straight away: a step with nothing in it is not a step yet,
        // and the field to type into is the whole reason it was added.
        expandedNodeId: id,
        nextSeq: state.nextSeq + 1,
      });
      persistCurrent();
      showToast(`${getNodeDefinition(type).kindLabel} qadami qo'shildi`);
    },

    /**
     * Moves a step within its own row and rewires the row to match, so the
     * order on screen stays the order the bot runs.
     *
     * Only `out` edges are touched, and only inside the row: a branch keeps
     * whatever hangs off it, and a row that ends by returning to a step above
     * still returns to it afterwards.
     */
    reorderSimpleStep: (nodeId, toIndex, within) => {
      const state = get();
      const row =
        within ?? findSimpleRow(buildSimpleOutline(state.nodes, state.edges, state.botLanguages?.main), nodeId);
      if (!row) return;
      const ordered = row.steps.map((step) => step.nodeId);
      const fromIndex = ordered.indexOf(nodeId);
      const target = Math.max(0, Math.min(ordered.length - 1, toIndex));
      if (fromIndex < 0 || fromIndex === target) return;
      // A step with no `out` exit closes the row it sits in: a Shart continues
      // out of its branches, a Tugatish does not continue at all. Moving a card
      // below one — or moving that one up — would wire the step after it out of
      // a port the block does not have, and the list would then be showing an
      // order the bot cannot run.
      const closes = ordered.findIndex((id) => {
        const step = state.nodes.find((n) => n.id === id);
        return !!step && !hasOutPort(step);
      });
      if (closes >= 0 && (fromIndex === closes || target >= closes)) {
        showToast("Bu qadam oqimni yakunlaydi — undan keyin qadam turolmaydi");
        return;
      }
      // A row that loops back into itself has no "after the last step" to
      // rewire to: moving a card would quietly shrink the loop onto whichever
      // step ended up last. The list already says this flow needs Pro to be
      // read — it must not rewrite it on the way.
      if (row.endsAt && ordered.includes(row.endsAt)) {
        showToast("Bu qadamlar halqa hosil qilgan — tartibini Pro rejimda o'zgartiring");
        return;
      }
      ordered.splice(target, 0, ordered.splice(fromIndex, 1)[0] as string);

      // The canvas positions belong to the slot, not to the step. Moving a card
      // up the list therefore moves it up the canvas too, instead of leaving
      // Pro mode to open on a graph whose edges cross for no visible reason.
      const slots = row.steps.map((step) => {
        const node = state.nodes.find((n) => n.id === step.nodeId);
        return { x: node?.x ?? 0, y: node?.y ?? 0 };
      });
      const moved = new Map(ordered.map((id, index) => [id, slots[index] as Point]));

      const inRow = new Set(ordered);
      const edges = state.edges.filter(
        (edge) =>
          !(inRow.has(edge.from) && edge.port === "out") &&
          !(row.head && edge.from === row.head.nodeId && edge.port === row.head.port),
      );
      if (row.head) edges.push({ id: newEdgeId(), from: row.head.nodeId, port: row.head.port, to: ordered[0] as string });
      for (let index = 0; index < ordered.length - 1; index += 1) {
        edges.push({ id: newEdgeId(), from: ordered[index] as string, port: "out", to: ordered[index + 1] as string });
      }
      if (row.endsAt) {
        edges.push({ id: newEdgeId(), from: ordered[ordered.length - 1] as string, port: "out", to: row.endsAt });
      }

      pushHistory(false);
      set({
        nodes: state.nodes.map((node) => (moved.has(node.id) ? { ...node, ...(moved.get(node.id) as Point) } : node)),
        edges,
      });
      persistCurrent();
    },

    /**
     * Takes a step out of the list and closes the gap: what ran before it now
     * runs what came after it.
     *
     * Blocks that hung off its branches are not deleted with it — they lose
     * the step that reached them and show up under "unconnected", which is a
     * state the author can see and undo, unlike a silent cascade.
     */
    removeSimpleStep: (nodeId) => {
      const state = get();
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (isFixedNodeType(node.type)) {
        showToast(`«${getNodeDefinition(node.type).kindLabel}» blokini o'chirib bo'lmaydi — u oqimning kirish nuqtasi`);
        return;
      }
      pushHistory(false);
      const incoming = state.edges.find((edge) => edge.to === nodeId && edge.from !== nodeId);
      const next = state.edges.find((edge) => edge.from === nodeId && edge.port === "out" && edge.to !== nodeId);
      const edges = state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
      if (incoming && next) edges.push({ id: newEdgeId(), from: incoming.from, port: incoming.port, to: next.to });

      set({
        nodes: state.nodes.filter((n) => n.id !== nodeId),
        edges,
        selectedIds: [],
        primarySelectedId: null,
        selectedEdgeId: null,
        expandedNodeId: state.expandedNodeId === nodeId ? null : state.expandedNodeId,
      });
      persistCurrent();
      // A destructive click needs a way back that does not assume the reader
      // knows Ctrl+Z. `pushHistory` above already stored the graph as it was,
      // so undo is exactly the right button to put behind this.
      showToast(`«${node.title || getNodeDefinition(node.type).kindLabel}» o'chirildi`, {
        tone: "danger",
        action: { label: "Bekor qilish", run: () => get().undo() },
      });
    },

    autoLayout: () => {
      const state = get();
      if (state.nodes.length < 2) return;
      const nodes = autoLayoutNodes(state.nodes, state.edges);
      const moved = nodes.some((node, index) => {
        const before = state.nodes[index]!;
        return node.x !== before.x || node.y !== before.y;
      });
      if (!moved) {
        showToast("Bloklar allaqachon tartibda");
        return;
      }
      pushHistory(false);
      set({ nodes });
      persistCurrent();
      showToast("Bloklar tartiblandi");
    },

    deleteSelected: () => {
      const state = get();
      const ids = state.selectedIds.length ? state.selectedIds : state.primarySelectedId ? [state.primarySelectedId] : [];
      // No block picked out but an edge is — Delete removes the link instead.
      if (!ids.length) {
        if (state.selectedEdgeId) get().deleteEdge(state.selectedEdgeId);
        return;
      }
      // A block the flow owns survives the selection it was caught in: the
      // entry block is what the flow runs on, and a multi-select drag must not
      // take it out along with the four blocks the author actually meant.
      const selected = ids
        .map((id) => state.nodes.find((n) => n.id === id))
        .filter((node): node is FlowNode => !!node);
      if (!selected.length) return;
      const owned = selected.filter((node) => isFixedNodeType(node.type));
      const removable = selected.filter((node) => !isFixedNodeType(node.type)).map((node) => node.id);
      if (!removable.length) {
        showToast(
          `«${getNodeDefinition(owned[0]!.type).kindLabel}» blokini o'chirib bo'lmaydi — u oqimning kirish nuqtasi`,
        );
        return;
      }
      pushHistory(false);
      const nodes = state.nodes.filter((n) => !removable.includes(n.id));
      const edges = state.edges.filter((e) => !removable.includes(e.from) && !removable.includes(e.to));
      set({
        nodes,
        edges,
        selectedIds: [],
        primarySelectedId: null,
        selectedEdgeId: null,
        expandedNodeId: state.expandedNodeId && removable.includes(state.expandedNodeId) ? null : state.expandedNodeId,
      });
      persistCurrent();
      // Same offer as the Simple list's delete: the Pro canvas reaches this
      // through the Delete key, where a mis-aimed press is even easier.
      showToast(`${removable.length} blok o'chirildi`, {
        tone: "danger",
        action: { label: "Bekor qilish", run: () => get().undo() },
      });
    },

    /**
     * Drops the blocks that have just been handed to a flow of their own — see
     * `lib/extract-flow.ts` for which blocks those are. Called *after* the new
     * flow exists, never before: a create that failed must not take a branch
     * of the graph with it. Undo puts them back, and the new flow is then a
     * copy the author can delete.
     */
    applyExtraction: (movedIds) => {
      const state = get();
      const moved = new Set(movedIds);
      if (!moved.size) return;
      pushHistory(false);
      set({
        nodes: state.nodes.filter((n) => !moved.has(n.id)),
        edges: state.edges.filter((e) => !moved.has(e.from) && !moved.has(e.to)),
        selectedIds: [],
        primarySelectedId: null,
        selectedEdgeId: null,
        expandedNodeId: state.expandedNodeId && moved.has(state.expandedNodeId) ? null : state.expandedNodeId,
      });
      persistCurrent();
    },

    duplicateSelected: () => {
      const state = get();
      const source = state.nodes.find((n) => n.id === state.primarySelectedId);
      if (!source) return;
      // One entry point per flow — a copy of it would be a block no update can
      // ever reach, sitting next to the one that answers them all.
      if (isFixedNodeType(source.type)) {
        showToast(`«${getNodeDefinition(source.type).kindLabel}» bloki nusxalanmaydi — oqimda u bitta bo'ladi`);
        return;
      }
      pushHistory(false);
      const id = `n${state.nextSeq}`;
      const nodes = [...state.nodes, { ...source, id, x: source.x + 32, y: source.y + 32 }];
      set({ nodes, selectedIds: [id], primarySelectedId: id, nextSeq: state.nextSeq + 1 });
      persistCurrent();
    },

    patchNode: (id, patch) => {
      pushHistory(true);
      const state = get();
      const nodes = state.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, ...patch };
        // A list of blocks all called "Xabar" says nothing about the flow it
        // describes. When the author has not named a block themselves, its name
        // follows the first words of what it actually says — and the moment they
        // type a name of their own, `autoTitleFor` stops touching it.
        return patch.text !== undefined && patch.title === undefined
          ? { ...next, title: autoTitleFor(next.type, n.title, next.text as string, (n.text as string) ?? "") }
          : next;
      });
      const updated = nodes.find((n) => n.id === id);
      // Deleting a button — or switching it to a kind Telegram never answers —
      // takes its port away with it, so the branch that hung off that port has
      // to go too. The back row is pruned on the same rule for the same reason:
      // switching it off publishes no "back" port, and a branch leaving a port
      // the block no longer has is one no walker will ever follow.
      // "out"/"yes"/"no" always exist and are never pruned.
      //
      // What counts as "no longer has" is the block's own rows and not the
      // published list, which are two different things on a block that goes out
      // as an album: `sendMediaGroup` takes no keyboard, so nothing is
      // published — but every row is still stored and picking a different
      // content kind brings all of them back. Pruning on the published list
      // meant that choosing «Albom» in the content panel silently deleted every
      // branch the author had wired, with one undo step covering both the choice
      // and the loss. See [[carriedRowPorts]].
      const livePorts = new Set(
        updated ? [...getNodePorts(updated).map((port) => port.id), ...carriedRowPorts(updated)] : [],
      );
      const prunable = (port: string) => Boolean(buttonIdFromPort(port)) || port === "back";
      let edges = state.edges.filter(
        (edge) => edge.from !== id || !prunable(edge.port) || livePorts.has(edge.port),
      );

      // Switching «Orqaga» on wires it back to the message this one was
      // reached from. Left unwired, the row is drawn on the customer's screen
      // and a tap on it does nothing at all (`runner._continue_from` keeps the
      // run parked), which reads as a broken button; and "back" has one
      // obvious meaning the author would otherwise have to go and draw by
      // hand. A button on a menu is preferred over a plain `out`, because a
      // menu is what people go back *to*. An entry block is never a target —
      // it sends nothing that could be shown again.
      const before = state.nodes.find((n) => n.id === id);
      const switchedOn = before?.back === undefined && patch.back !== undefined && livePorts.has("back");
      if (switchedOn && !edges.some((edge) => edge.from === id && edge.port === "back")) {
        const incoming = edges.filter((edge) => {
          const source = nodes.find((n) => n.id === edge.from);
          return edge.to === id && edge.from !== id && !!source && acceptsIncomingEdge(source.type);
        });
        const previous = incoming.find((edge) => buttonIdFromPort(edge.port)) ?? incoming[0];
        if (previous) {
          edges = connectPort(edges, id, "back", previous.from).edges;
          const target = nodes.find((n) => n.id === previous.from);
          showToast(`«Orqaga» → «${target?.title || getNodeDefinition(target?.type ?? "message").kindLabel}» ga qaytaradi`);
        }
      }
      set({ nodes, edges });
      persistCurrent();
    },

    nudgeSelected: (dx, dy) => {
      const state = get();
      const ids = state.selectedIds.length ? state.selectedIds : state.primarySelectedId ? [state.primarySelectedId] : [];
      if (!ids.length) return;
      pushHistory(true);
      const nodes = state.nodes.map((n) => (ids.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
      set({ nodes });
      persistCurrent();
    },

    startNodeInteraction: (nodeId, additive, clientX, clientY) => {
      const state = get();
      if (state.pending) {
        get().completeConnection(nodeId);
        return;
      }
      const previousSelection = state.selectedIds;
      const dragIds = additive
        ? [...previousSelection, nodeId]
        : previousSelection.includes(nodeId)
          ? previousSelection
          : [nodeId];

      get().select(nodeId, additive);
      set({ pending: null });

      pushHistory(false);
      const origin: Record<string, Point> = {};
      get().nodes.forEach((n) => {
        if (dragIds.includes(n.id)) origin[n.id] = { x: n.x, y: n.y };
      });
      set({ drag: { kind: "nodes", nodeIds: dragIds, originPositions: origin, startX: clientX, startY: clientY } });
    },

    beginPanDrag: (clientX, clientY) => {
      set({
        selectedIds: [],
        primarySelectedId: null,
        pending: null,
        drag: { kind: "pan", startX: clientX, startY: clientY, originPan: get().pan },
      });
    },

    updateDrag: (clientX, clientY) => {
      const state = get();
      const drag = state.drag;
      if (!drag) return;
      if (drag.kind === "pan") {
        set({ pan: { x: drag.originPan.x + (clientX - drag.startX), y: drag.originPan.y + (clientY - drag.startY) } });
        return;
      }
      const dx = (clientX - drag.startX) / state.zoom;
      const dy = (clientY - drag.startY) / state.zoom;
      const nodes = state.nodes.map((n) => {
        const origin = drag.originPositions[n.id];
        return origin ? { ...n, x: snapToGrid(origin.x + dx), y: snapToGrid(origin.y + dy) } : n;
      });
      set({ nodes });
    },

    endDrag: () => {
      const wasNodeDrag = get().drag?.kind === "nodes";
      set({ drag: null });
      if (wasNodeDrag) persistCurrent();
    },

    startConnection: (fromNodeId, port) => {
      const fromNode = get().nodes.find((n) => n.id === fromNodeId);
      if (!fromNode) return;
      const anchor = portAnchor(fromNode, port);
      set({ drag: null, pending: { fromNodeId, port }, mouse: { x: anchor.x, y: anchor.y } });
    },
    updatePendingMouse: (x, y) => set({ mouse: { x, y } }),
    completeConnection: (toNodeId) => {
      const state = get();
      const pending = state.pending;
      if (!pending) return;
      // An entry block is where a flow starts — Telegram hands it its update,
      // nothing inside the flow can. The refusal is said out loud rather than
      // swallowed, and the half-drawn edge is left alive so the next click can
      // land it on a block that does take one.
      const target = state.nodes.find((node) => node.id === toNodeId);
      if (target && !acceptsIncomingEdge(target.type)) {
        showToast(`${getNodeDefinition(target.type).kindLabel} oqimni boshlaydi — unga bog'lanish kelmaydi`);
        return;
      }
      // Self-loops are allowed — a node's own input is a valid drop target
      // for its own output port; only an exact duplicate edge is rejected
      // below.
      pushHistory(false);
      // One exit, one destination — see [[connectPort]]. Dragging a second line
      // off a port that already has one used to add it: the canvas then drew a
      // branch Simple mode listed as unconnected and the runtime never walked,
      // with no warning anywhere, because which of the two ran was decided by
      // their order in the stored array.
      const { edges, replaced } = connectPort(state.edges, pending.fromNodeId, pending.port, toNodeId);
      set({ edges, pending: null });
      persistCurrent();
      if (replaced) {
        const previous = state.nodes.find((node) => node.id === replaced.to);
        const name = previous?.title || (previous ? getNodeDefinition(previous.type).kindLabel : "avvalgi blok");
        showToast(`Bu chiqish ko'chirildi — «${name}» bilan bog'lanish uzildi`);
      }
    },
    cancelConnection: () => set({ pending: null }),
    setEdgeTransition: (edgeId, transition) => {
      pushHistory(true);
      // `undefined` is a value here, not an absence: it clears the line's own
      // setting so the target block's default takes over again. Spreading a
      // patch would have kept the old one, which is why the field is assigned
      // rather than merged.
      const edges = get().edges.map((edge) => (edge.id === edgeId ? { ...edge, transition } : edge));
      set({ edges });
      persistCurrent();
    },

    setEdgeDeleteDelay: (edgeId, seconds) => {
      pushHistory(true);
      // Clamped here as well as in the runtime: a number input accepts a typed
      // "-5" and an author who sees it stick will believe it means something.
      const clamped = Math.max(0, Math.min(Math.round(seconds) || 0, MAX_DELETE_DELAY));
      const edges = get().edges.map((edge) =>
        edge.id === edgeId ? { ...edge, deleteAfterSeconds: clamped || undefined } : edge,
      );
      set({ edges });
      persistCurrent();
    },

    deleteEdge: (edgeId) => {
      pushHistory(false);
      const edges = get().edges.filter((e) => e.id !== edgeId);
      set({ edges, selectedEdgeId: null });
      persistCurrent();
      showToast("Bog'lanish o'chirildi");
    },

    zoomBy: (delta) =>
      set((state) => ({ zoom: Math.min(1.6, Math.max(0.4, Math.round((state.zoom + delta) * 100) / 100)) })),
    setZoom: (zoom) => set({ zoom: Math.min(1.6, Math.max(0.4, zoom)) }),
    fitView: ({ width, height }) => {
      const state = get();
      if (!state.nodes.length) {
        set({ zoom: 0.9, pan: { x: 20, y: 10 } });
        return;
      }
      const pad = 16;
      // The palette and the dock float over the canvas, so the graph is fitted
      // into what is left between them rather than into the whole element —
      // measured from the width the palette is actually drawn at, folded or not.
      const leftInset = panelInset(
        paletteWidth({ isNarrow: state.isNarrowViewport, collapsed: state.paletteCollapsed }),
      );
      // Room is kept for the dock even with nothing selected: it opens on the
      // first block anyone clicks, and a graph that had to move out of its way
      // then would be a jump nobody asked for. A narrow viewport is the
      // exception — there the dock covers the canvas whatever the fit does.
      const rightInset =
        state.isNarrowViewport && state.primarySelectedId === null
          ? 0
          : panelInset(dockWidth(state.isNarrowViewport));
      const availableWidth = Math.max(120, width - leftInset - rightInset);
      const xs = state.nodes.map((n) => n.x);
      const ys = state.nodes.map((n) => n.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...state.nodes.map((n) => n.x + nodeWidth(n)));
      const maxY = Math.max(...state.nodes.map((n) => n.y + nodeHeight(n)));
      const boundsWidth = Math.max(1, maxX - minX);
      const boundsHeight = Math.max(1, maxY - minY);
      const zoom = Math.max(
        0.25,
        Math.min(1.05, Math.min((availableWidth - pad * 2) / boundsWidth, (height - pad * 2) / boundsHeight)),
      );
      set({
        zoom,
        pan: {
          x: leftInset + (availableWidth - boundsWidth * zoom) / 2 - minX * zoom,
          y: (height - boundsHeight * zoom) / 2 - minY * zoom,
        },
      });
    },

    centerOn: ({ x, y }, { width, height }) => {
      const { zoom } = get();
      set({ pan: { x: width / 2 - x * zoom, y: height / 2 - y * zoom } });
    },

    focusNode: (id, viewport) => {
      const node = get().nodes.find((n) => n.id === id);
      if (!node) return;
      set({ selectedIds: [id], primarySelectedId: id, selectedEdgeId: null, pending: null });
      get().centerOn({ x: node.x + nodeWidth(node) / 2, y: node.y + nodeHeight(node) / 2 }, viewport);
    },

    undo: () => {
      const state = get();
      const past = [...state.past];
      const prev = past.pop();
      if (!prev) {
        showToast("Bekor qilish uchun amal yo'q");
        return;
      }
      const future = [{ nodes: state.nodes, edges: state.edges }, ...state.future].slice(0, HISTORY_LIMIT);
      lastSnapshotAt = 0;
      set({
        past,
        future,
        nodes: prev.nodes,
        edges: prev.edges,
        selectedIds: prev.nodes.map((n) => n.id).filter((id) => state.selectedIds.includes(id)),
      });
      persistCurrent();
      showToast("Bekor qilindi");
    },
    redo: () => {
      const state = get();
      const future = [...state.future];
      const next = future.shift();
      if (!next) {
        showToast("Qaytarish uchun amal yo'q");
        return;
      }
      const past = [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-HISTORY_LIMIT);
      lastSnapshotAt = 0;
      set({ past, future, nodes: next.nodes, edges: next.edges });
      persistCurrent();
      showToast("Qaytarildi");
    },
  };
});
