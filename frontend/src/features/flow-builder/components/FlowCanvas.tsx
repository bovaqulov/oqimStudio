"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { getNodeDefinition, getPaletteNodeTypes } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";
import { FlowContextMenu, type ContextTarget } from "./FlowContextMenu";
import { FlowGraph } from "./FlowGraph";
import { FlowMinimap } from "./FlowMinimap";
import { ZoomToolbar } from "./ZoomToolbar";

/**
 * How far the pointer travels before a press on a port counts as a drag rather
 * than a click. Small enough that a deliberate drag is never mistaken for a
 * click; large enough that the hand-shake in a click is never mistaken for a
 * drag onto the card the port belongs to.
 */
const DRAG_SLOP = 5;

export function FlowCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const zoom = useFlowEditorStore((s) => s.zoom);
  const pan = useFlowEditorStore((s) => s.pan);
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  const firstBlockLabel = getNodeDefinition(getPaletteNodeTypes(moduleKey)[0] ?? "message").paletteLabel;
  const beginPanDrag = useFlowEditorStore((s) => s.beginPanDrag);
  const updateDrag = useFlowEditorStore((s) => s.updateDrag);
  const endDrag = useFlowEditorStore((s) => s.endDrag);
  const updatePendingMouse = useFlowEditorStore((s) => s.updatePendingMouse);
  const cancelConnection = useFlowEditorStore((s) => s.cancelConnection);
  const zoomBy = useFlowEditorStore((s) => s.zoomBy);
  const select = useFlowEditorStore((s) => s.select);

  /*
   * Where the pending connection was picked up, and whether it has been
   * dragged since.
   *
   * A port starts a connection on `mousedown` and a card lands it on
   * `mousedown` too — click, then click. That is a real way to wire a graph and
   * it stays, but it is not the way anybody tries first: a dot with a line
   * hanging off it asks to be dragged onto the block it should reach, and doing
   * that produced the preview line, the release did nothing, and the next click
   * anywhere on the canvas ran `cancelConnection`. The edge was never made and
   * nothing said why — the canvas read as view-only.
   *
   * Kept in a ref rather than in the store because it is about this gesture and
   * not about the graph: nothing renders from it, and putting it in the store
   * would re-render every card on every mouse move.
   */
  const gesture = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);

  // Global listeners: dragging (nodes or pan) and the pending-connection preview
  // both need to keep tracking the mouse even once it leaves the canvas element.
  useEffect(() => {
    function onMove(event: MouseEvent) {
      const state = useFlowEditorStore.getState();
      const canvas = canvasRef.current;
      if (canvas && state.pending) {
        const rect = canvas.getBoundingClientRect();
        updatePendingMouse((event.clientX - rect.left - state.pan.x) / state.zoom, (event.clientY - rect.top - state.pan.y) / state.zoom);
      }
      if (state.drag) updateDrag(event.clientX, event.clientY);

      // A new pending connection is recognised by the port it left, so a second
      // drag from the same port after a cancel starts its own gesture.
      if (!state.pending) {
        gesture.current = null;
      } else {
        const key = `${state.pending.fromNodeId}:${state.pending.port}`;
        const current = gesture.current;
        if (!current || current.key !== key) {
          gesture.current = { key, x: event.clientX, y: event.clientY, moved: false };
        } else if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) > DRAG_SLOP) {
          current.moved = true;
        }
      }
    }

    function onUp(event: MouseEvent) {
      const state = useFlowEditorStore.getState();
      // Only a gesture that actually moved lands here. Without that a plain
      // click on a port — press and release without travelling — would find the
      // source card under the pointer and wire the block to itself.
      if (state.pending && gesture.current?.moved) {
        const target = event.target as HTMLElement | null;
        const card = target?.closest?.("[data-node-id]");
        const nodeId = card instanceof HTMLElement ? card.dataset.nodeId : undefined;
        if (nodeId) {
          gesture.current = null;
          state.completeConnection(nodeId);
        }
      }
      endDrag();
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateDrag, endDrag, updatePendingMouse]);

  return (
    <div
      ref={canvasRef}
      data-flow-canvas
      /*
       * Focusable, and focused on the way down, so that a bare keystroke can
       * ask whether the canvas is the thing being typed at. It was not asking:
       * the shortcuts listened on `window` and fired wherever the reader had
       * clicked last, so "1" pressed after dismissing a menu dropped a block
       * onto a canvas nobody was looking at — and autosave wrote it.
       *
       * `-1` rather than `0`: this is not a stop on the tab order, it is a
       * region that answers the keyboard once it has been clicked into.
       */
      tabIndex={-1}
      className="absolute inset-0 cursor-default overflow-hidden bg-bg outline-none"
      /* Capture, because a card stops the event before it reaches the canvas:
         clicking a block would otherwise leave the canvas unfocused and every
         bare-key shortcut dead on exactly the block they are meant to act on. */
      onMouseDownCapture={() => canvasRef.current?.focus({ preventScroll: true })}
      /*
       * The browser's own menu is not an answer here.
       *
       * A right-click on a block used to open «Back · Reload · Save As… ·
       * Inspect» — a menu about the document, on top of an editor, while the
       * pointer was on the thing the reader wanted to act on. What the block
       * under the pointer is decides what the menu says, so the target is
       * worked out from the DOM: a card carries its id, and so does an edge.
       */
      onContextMenu={(event) => {
        event.preventDefault();
        const el = event.target as HTMLElement;
        const card = el.closest<HTMLElement>("[data-node-id]");
        const edge = el.closest<HTMLElement>("[data-edge-id]");
        // Right-clicking a block selects it first: every action in the menu
        // acts on the selection, and a menu that acted on something other than
        // what it was opened on would be worse than no menu.
        if (card?.dataset.nodeId) select(card.dataset.nodeId, false);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId: card?.dataset.nodeId ?? null,
          edgeId: edge?.dataset.edgeId ?? null,
        });
      }}
      onMouseDown={(event) => {
        select(null, false);
        cancelConnection();
        beginPanDrag(event.clientX, event.clientY);
      }}
      onWheel={(event) => zoomBy(event.deltaY > 0 ? -0.08 : 0.08)}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage: "radial-gradient(var(--color-neutral-800) 1px, transparent 1px)",
          backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div
        className="absolute top-0 left-0"
        style={{ transformOrigin: "0 0", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <FlowGraph nodes={nodes} />
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-800/50 text-neutral-600">
            <Icon name="flow-arrow" size={20} />
          </span>
          <div className="text-[14px] font-medium text-neutral-300">Kanvas hozircha bo&apos;sh</div>
          <div className="max-w-[260px] text-[12px] leading-relaxed text-neutral-600">
            Chapdagi palitradan birinchi blokni qo&apos;shing — {firstBlockLabel} bilan boshlash odatiy yo&apos;l.
          </div>
        </div>
      )}

      <ZoomToolbar canvasRef={canvasRef} />
      <FlowMinimap canvasRef={canvasRef} />
      {menu && <FlowContextMenu target={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
