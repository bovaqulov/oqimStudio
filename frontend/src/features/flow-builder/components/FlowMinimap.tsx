"use client";

import { useEffect, useState, type RefObject } from "react";
import { Icon } from "@/components/ui/Icon";
import { dockWidth, PANEL_GUTTER, panelInset } from "../lib/layout";
import { getNodeDefinition, nodeHeight, nodeWidth } from "../node-registry";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

const MAP_WIDTH = 168;
const MAP_HEIGHT = 112;
const MAP_PAD = 8;
/** Below this many blocks the graph fits on screen anyway and the map is only clutter. */
const MIN_NODES = 4;

/**
 * Overview of the whole graph, with the visible area drawn on top. A large flow
 * scrolls past the edges of the canvas and the panned-away parts stop existing
 * for the reader — the map is how they stay locatable, and clicking one moves
 * the view there.
 */
export function FlowMinimap({ canvasRef }: { canvasRef: RefObject<HTMLDivElement | null> }) {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const pan = useFlowEditorStore((s) => s.pan);
  const zoom = useFlowEditorStore((s) => s.zoom);
  const selectedIds = useFlowEditorStore((s) => s.selectedIds);
  const centerOn = useFlowEditorStore((s) => s.centerOn);
  /*
   * Out from under the inspector.
   *
   * Both are pinned to the same corner — `right-[14px] bottom-[14px]` here, and
   * the dock runs the full height of the canvas at the same inset — so the
   * moment a block was selected the map was behind 296px of opaque panel. Which
   * is exactly when it is wanted: a selection is how you get lost in a large
   * graph, and the map is how you find your way back.
   *
   * The width comes from `lib/layout`, the one copy `fitView` and the panels
   * themselves already read, so a dock that changes width cannot leave the map
   * measuring against the old number.
   */
  const primarySelectedId = useFlowEditorStore((s) => s.primarySelectedId);
  const selectedEdgeId = useFlowEditorStore((s) => s.selectedEdgeId);
  const isNarrow = useFlowEditorStore((s) => s.isNarrowViewport);
  const docked = primarySelectedId !== null || selectedEdgeId !== null;
  const [collapsed, setCollapsed] = useState(false);
  // The canvas size is read through an observer rather than off the ref during
  // render: the viewport rectangle has to follow a resized window anyway, and a
  // ref read at render time is not a value React can keep in step.
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvasRef]);

  if (nodes.length < MIN_NODES) return null;

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + nodeWidth(n)));
  const maxY = Math.max(...nodes.map((n) => n.y + nodeHeight(n)));
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const scale = Math.min((MAP_WIDTH - MAP_PAD * 2) / graphWidth, (MAP_HEIGHT - MAP_PAD * 2) / graphHeight);

  // The visible area expressed in graph coordinates, then mapped onto the minimap.
  const viewport = canvasSize
    ? {
        x: -pan.x / zoom,
        y: -pan.y / zoom,
        width: canvasSize.width / zoom,
        height: canvasSize.height / zoom,
      }
    : null;

  function toMap(x: number, y: number) {
    return { left: MAP_PAD + (x - minX) * scale, top: MAP_PAD + (y - minY) * scale };
  }

  return (
    <div
      style={{ right: docked ? panelInset(dockWidth(isNarrow)) : PANEL_GUTTER }}
      className="absolute bottom-[14px] z-[8] overflow-hidden rounded-[12px] bg-overlay/92 shadow-md backdrop-blur-lg transition-[right] duration-200 motion-reduce:transition-none"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex-1 text-[9.5px] tracking-[.1em] text-neutral-700 uppercase">Xarita</span>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Xaritani ochish" : "Xaritani yig'ish"}
          className="flex h-4 w-4 cursor-pointer items-center justify-center rounded text-neutral-600 hover:text-neutral-200"
        >
          <Icon name={collapsed ? "caret-up" : "caret-down"} size={10} />
        </button>
      </div>

      {!collapsed && (
        <button
          type="button"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!canvasSize) return;
            // Where the click landed, translated back from map space to graph space.
            const graphX = minX + (event.clientX - bounds.left - MAP_PAD) / scale;
            const graphY = minY + (event.clientY - bounds.top - MAP_PAD) / scale;
            centerOn({ x: graphX, y: graphY }, canvasSize);
          }}
          title="Ko'rinishni shu joyga siljitish"
          className="relative block cursor-crosshair border-t border-neutral-900 bg-neutral-950/40"
          style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
        >
          {nodes.map((node) => {
            const position = toMap(node.x, node.y);
            const selected = selectedIds.includes(node.id);
            return (
              <span
                key={node.id}
                className="absolute rounded-[2px]"
                style={{
                  left: position.left,
                  top: position.top,
                  width: Math.max(3, nodeWidth(node) * scale),
                  height: Math.max(2, nodeHeight(node) * scale),
                  background: getNodeDefinition(node.type).color,
                  opacity: selected ? 1 : 0.6,
                  outline: selected ? "1px solid var(--color-accent-300)" : undefined,
                }}
              />
            );
          })}

          {viewport && (
            <span
              className="pointer-events-none absolute rounded-[3px] border border-accent-400/80 bg-accent-500/10"
              style={{
                left: toMap(viewport.x, viewport.y).left,
                top: toMap(viewport.x, viewport.y).top,
                width: Math.max(6, viewport.width * scale),
                height: Math.max(6, viewport.height * scale),
              }}
            />
          )}
        </button>
      )}
    </div>
  );
}
