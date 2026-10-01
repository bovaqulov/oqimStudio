"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import type { BotLanguage } from "@/features/bots/types";
import type { FlowNode } from "@/features/flows";
import { resolveText } from "@/features/flows/localized-text";
import { buttonIdFromPort } from "../lib/buttons";
import {
  TRANSITION_DASH,
  TRANSITION_GLOW,
  TRANSITION_STROKE,
  isMarkedTransition,
  resolveTransition,
} from "../lib/transitions";
import { portAnchor, portSide, routeEdge, targetInPoint } from "../lib/edge-routing";
import { useBotMainLanguage } from "./Inspector/fields/TextLanguage";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

const STROKE = {
  yes: "#5f9c7c",
  no: "#a08b5c",
  button: "var(--color-accent-500)",
  plain: "var(--color-neutral-500)",
} as const;
const GLOW = {
  yes: "rgba(95,156,124,.12)",
  no: "rgba(160,139,92,.12)",
  button: "rgba(98,163,227,.16)",
  plain: "rgba(98,163,227,.12)",
} as const;
/** Longer button labels are cut on the edge chip — the card still shows them in full. */
const MAX_LABEL = 16;
/** Radius of the "remove this link" control, which replaces the chip while an edge is selected. */
const REMOVE_R = 9;
/** Half the height of the chip — and of the control that stands in for it. */
const LABEL_HALF_H = 9;
/** Clearance kept between a card's edge and anything the connection draws next to it. */
const CARD_CLEARANCE = 8;

function toneOf(port: string): keyof typeof STROKE {
  if (port === "yes") return "yes";
  if (port === "no") return "no";
  return buttonIdFromPort(port) ? "button" : "plain";
}

/**
 * What the chip on an edge says: the branch condition, or the button that opens
 * it. `main` is the bot's own language — a chip is drawn on the canvas, where
 * there is no field open and so no language chosen to read in.
 */
function edgeLabel(from: FlowNode, port: string, main: BotLanguage): string {
  if (port === "yes") return "Ha";
  if (port === "no") return "Yo'q";
  const buttonId = buttonIdFromPort(port);
  if (!buttonId) return "";
  const label = resolveText(from.buttons?.find((button) => button.id === buttonId)?.label, main, main);
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

export function FlowEdgesLayer({ nodes }: { nodes: FlowNode[] }) {
  const edges = useFlowEditorStore((s) => s.edges);
  const pending = useFlowEditorStore((s) => s.pending);
  const mouse = useFlowEditorStore((s) => s.mouse);
  const selectedEdgeId = useFlowEditorStore((s) => s.selectedEdgeId);
  const selectEdge = useFlowEditorStore((s) => s.selectEdge);
  const deleteEdge = useFlowEditorStore((s) => s.deleteEdge);
  const main = useBotMainLanguage();

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // The picked-out edge paints last, so its remove control sits above every
  // other edge's invisible hit area — a crossing edge would otherwise swallow
  // the click and select itself instead.
  const ordered = selectedEdgeId
    ? [...edges.filter((edge) => edge.id !== selectedEdgeId), ...edges.filter((edge) => edge.id === selectedEdgeId)]
    : edges;

  return (
    <svg width={5200} height={3200} className="pointer-events-none absolute top-0 left-0 overflow-visible">
      <defs>
        <marker id="oq-arrow" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 1 1 L 6 4 L 1 7 z" fill={STROKE.plain} />
        </marker>
        <marker id="oq-arrow-yes" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 1 1 L 6 4 L 1 7 z" fill={STROKE.yes} />
        </marker>
        <marker id="oq-arrow-no" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 1 1 L 6 4 L 1 7 z" fill={STROKE.no} />
        </marker>
        <marker id="oq-arrow-button" viewBox="0 0 8 8" refX="5.4" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 1 1 L 6 4 L 1 7 z" fill={STROKE.button} />
        </marker>
        {/* The head has to follow the line. A violet stroke ending in a blue
            arrow reads as a rendering fault rather than as two facts. */}
        <marker
          id="oq-arrow-transition"
          viewBox="0 0 8 8"
          refX="5.4"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 1 1 L 6 4 L 1 7 z" fill={TRANSITION_STROKE} />
        </marker>
      </defs>

      {ordered.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;

        const end = targetInPoint(to);
        // The target decides which side a keyboard row leaves by — see
        // `portAnchor`. Read before the start for that reason.
        const start = portAnchor(from, edge.port, end);
        const side = portSide(from, edge.port, end);
        const routed = routeEdge(start, end, edge.from === edge.to ? from : null, side);
        const tone = toneOf(edge.port);
        const label = edgeLabel(from, edge.port, main);
        const labelWidth = label ? label.length * 6.4 + 18 : 0;
        const selected = edge.id === selectedEdgeId;
        // Cards paint above this layer, so whatever the edge puts on the canvas
        // has to stay inside the open gap between the two of them or it is
        // simply covered up. The flow runs rightward, so that gap is the
        // horizontal one, and only a forward edge is at risk — a backward one
        // doubles back through open canvas. When the gap is too tight to hold
        // the chip, clearing the source wins: half over the target still reads,
        // fully behind it does not.
        //
        // Clamped by whichever of the two things anchored here is wider, since
        // they share the one spot: the chip when the edge is idle, the remove
        // control once it is picked out.
        const anchorHalfW = Math.max(labelWidth / 2, REMOVE_R);
        const anchorX =
          end.x > start.x
            ? Math.max(
                Math.min(routed.labelX, to.x - CARD_CLEARANCE - anchorHalfW),
                start.x + CARD_CLEARANCE + anchorHalfW,
              )
            : routed.labelX;
        const anchorY = routed.labelY;
        // A button edge leaves the very row that already names it on the card,
        // so its chip repeats what the reader can see — it stays out of the way
        // until the line is hovered. "Ha"/"Yo'q" have no such twin on a Shart
        // card, so they always show.
        const quietLabel = tone === "button";
        // What this connection does to the message already on screen. An author
        // who cannot see it on the canvas will not find the setting that caused
        // it — and the stroke is the only channel that says so at rest, since
        // `.oq-edge-glow` is transparent until the line is hovered.
        //
        // `keep` is left alone deliberately: it is most edges and it is the
        // case where nothing happens, so a graph full of them looks exactly as
        // it did before any of this existed.
        const transition = resolveTransition(edge, to, from);
        const marked = isMarkedTransition(transition);
        // Everything hung off this edge follows the one colour — the hover
        // glow, the chip's border, the remove control — because a violet line
        // wearing a blue chip reads as two edges overlapping.
        const edgeVars = {
          "--edge-color": marked ? TRANSITION_STROKE : STROKE[tone],
          "--edge-glow": marked ? TRANSITION_GLOW : GLOW[tone],
        } as CSSProperties;

        return (
          <g
            key={edge.id}
            // Read by the canvas's context menu to tell a connection from the
            // block it leaves — `closest()` walks SVG the same as HTML.
            data-edge-id={edge.id}
            className={cn("oq-edge-group", quietLabel && "is-quiet", selected && "is-selected")}
            style={edgeVars}
          >
            <path
              d={routed.path}
              className="oq-edge-glow"
              fill="none"
              stroke="var(--edge-glow)"
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={routed.path}
              className="oq-edge-core"
              fill="none"
              stroke="var(--edge-color)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={TRANSITION_DASH[transition] ?? undefined}
              markerEnd={
                marked ? "url(#oq-arrow-transition)" : tone === "plain" ? "url(#oq-arrow)" : `url(#oq-arrow-${tone})`
              }
            />
            {/* Picking, not deleting: a stray click on this 16px-wide invisible
                hit area used to drop the connection outright. */}
            <path
              d={routed.path}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              className="pointer-events-auto cursor-pointer"
              onMouseDown={(event) => {
                event.stopPropagation();
                selectEdge(edge.id);
              }}
            />
            {label && !selected ? (
              <g className="oq-edge-label">
                <rect
                  className="oq-edge-label-bg"
                  x={anchorX - labelWidth / 2}
                  y={anchorY - LABEL_HALF_H}
                  width={labelWidth}
                  height={LABEL_HALF_H * 2}
                  rx={LABEL_HALF_H}
                  fill="var(--color-surface)"
                  stroke="var(--edge-color)"
                />
                <text
                  x={anchorX}
                  y={anchorY + 4}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={600}
                  fill="var(--color-neutral-200)"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {label}
                </text>
              </g>
            ) : null}
            {!label && <circle className="oq-edge-core" cx={start.x} cy={start.y} r={3} fill="var(--edge-color)" />}
            {/* Removal takes the chip's place rather than sitting next to it:
                one anchor per edge means the control can never land on its own
                label, and it inherits the clearance the chip was already given. */}
            {selected && (
              <g
                className="pointer-events-auto cursor-pointer"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  deleteEdge(edge.id);
                }}
              >
                <title>{label ? `"${label}" bog'lanishini o'chirish` : "Bog'lanishni o'chirish"}</title>
                <circle
                  cx={anchorX}
                  cy={anchorY}
                  r={REMOVE_R}
                  fill="var(--color-surface)"
                  stroke="var(--edge-color)"
                />
                <path
                  d={`M ${anchorX - 3.2} ${anchorY - 3.2} L ${anchorX + 3.2} ${anchorY + 3.2} M ${anchorX + 3.2} ${anchorY - 3.2} L ${anchorX - 3.2} ${anchorY + 3.2}`}
                  stroke="var(--color-neutral-200)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        );
      })}

      {pending &&
        (() => {
          const fromNode = byId.get(pending.fromNodeId);
          if (!fromNode) return null;
          // Nothing is wired yet, so the pointer stands in for the target.
          const start = portAnchor(fromNode, pending.port, mouse);
          const routed = routeEdge(start, mouse, null, portSide(fromNode, pending.port, mouse));
          return (
            <path
              d={routed.path}
              fill="none"
              stroke="var(--color-accent-400)"
              strokeWidth={1.6}
              strokeDasharray="5 5"
              style={{ animation: "oq-dash .6s linear infinite" }}
            />
          );
        })()}
    </svg>
  );
}
