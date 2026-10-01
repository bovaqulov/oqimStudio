"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { cn } from "@/lib/utils/cn";
import { layoutAgentGraph, NODE_WIDTH, type AgentNode } from "../canvas-model";
import { AgentNodeCard } from "./AgentNodeCard";

/**
 * The agent as a graph — and, on a phone, as the same graph read downwards.
 *
 * ## What the phone gets
 *
 * The flow editor answers this question by refusing: a canvas is a desktop
 * tool, `FlowEditor` forces Simple mode on a phone, and a flow with no blocks
 * at all says «Birinchi qadam kompyuterda qo'shiladi» because placing the first
 * block genuinely needs one.
 *
 * An agent's graph is not that graph, and the honest answer here is different.
 * Its shape is *fixed* — five nodes down the spine, branches only under two of
 * them — so there is nothing to arrange, nothing to place, and no first block
 * to drop. Reading it top to bottom loses nothing: the spine is already a
 * column, and a branch becomes an indent under the card it belongs to, which is
 * the same containment the curve draws on a wide screen. So a phone gets the
 * whole editor and not a reduced one: every node opens, every field is
 * reachable, and a tool can be added there as easily as on a desktop.
 *
 * The one thing a phone does not get is the two-column picture, and it does not
 * need it: the column exists on a desktop because there is width going spare.
 */
export function AgentCanvas({
  spine,
  selectedId,
  onSelect,
  onAddTool,
}: {
  spine: AgentNode[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** Opens the «Vositalar» node, which is where a tool is added. */
  onAddTool: () => void;
}) {
  const phone = usePhoneViewport();
  const layout = useMemo(() => layoutAgentGraph(spine), [spine]);

  if (phone) {
    return (
      <div className="flex flex-col gap-3">
        {spine.map((node, index) => (
          <div key={node.id} className="flex flex-col">
            {/* The spine, drawn as the thing between two cards rather than as
                a line beside them: the gap itself is the connector. */}
            {index > 0 && <span aria-hidden className="mx-auto h-3 w-px bg-separator" />}
            <AgentNodeCard
              node={node}
              selected={selectedId === node.id}
              onOpen={() => onSelect(node.id)}
            />
            {(node.children.length > 0 || node.kind === "tools") && (
              /* Indented under the card they belong to, on a rail — the same
                 "these hang off that" the curve says on a wide screen. */
              <div className="mt-2 ml-4 flex flex-col gap-2 border-l border-separator pl-4">
                {node.children.map((child) => (
                  <AgentNodeCard
                    key={child.id}
                    node={child}
                    selected={selectedId === child.id}
                    onOpen={() => onSelect(child.id)}
                  />
                ))}
                {node.kind === "tools" && <AddToolCard onClick={onAddTool} />}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-bg relative overflow-x-auto rounded-[16px] border border-separator">
      {/* The dotted ground of the flow canvas, so the two read as one product.
          Not scaled by a zoom, because this canvas has none — the graph is a
          fixed five-node spine and fits. */}
      <div
        className="relative"
        style={{
          width: layout.width,
          height: layout.height,
          backgroundImage: "radial-gradient(var(--color-neutral-800) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          className="pointer-events-none absolute top-0 left-0"
          aria-hidden
        >
          {layout.links.map((link) => (
            <path
              key={link.id}
              d={link.path}
              fill="none"
              stroke="var(--color-neutral-500)"
              strokeWidth={link.branch ? 1.5 : 2}
              strokeOpacity={link.branch ? 0.4 : 0.55}
              strokeDasharray={link.branch ? "4 4" : undefined}
            />
          ))}
          {layout.addSlot && (
            <path
              d={layout.addSlot.path}
              fill="none"
              stroke="var(--color-neutral-500)"
              strokeWidth={1.5}
              strokeOpacity={0.25}
              strokeDasharray="4 4"
            />
          )}
        </svg>

        {layout.nodes.map((node) => (
          <div
            key={node.id}
            className="absolute"
            style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: node.height }}
          >
            <AgentNodeCard
              node={node}
              selected={selectedId === node.id}
              onOpen={() => onSelect(node.id)}
              fixedHeight
            />
          </div>
        ))}

        {layout.addSlot && (
          <div
            className="absolute"
            style={{
              left: layout.addSlot.x,
              top: layout.addSlot.y,
              width: layout.addSlot.width,
              height: layout.addSlot.height,
            }}
          >
            <AddToolCard onClick={onAddTool} fill />
          </div>
        )}
      </div>
    </div>
  );
}

/** The one place on the canvas where something can be added. */
function AddToolCard({ onClick, fill = false }: { onClick: () => void; fill?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "oq-press flex w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-separator bg-transparent text-neutral-400 hover:text-accent-400",
        fill ? "h-full" : "min-h-[52px]",
      )}
    >
      <Icon name="plus" size={15} />
      <span className="t-subhead">Vosita qo&apos;shish</span>
    </button>
  );
}
