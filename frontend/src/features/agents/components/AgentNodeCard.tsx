"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import type { AgentNode } from "../canvas-model";

/**
 * One card on the agent canvas — the same object whether it is placed on the
 * graph or stacked in a phone's list.
 *
 * One component and not two, because the two views must never be able to say
 * different things about the same node. The graph gives it a fixed height and
 * lets the text clamp; the list lets it grow. Everything else — the colour, the
 * title, the badge, the problem line — is decided here, once.
 *
 * A card is a *glance*: what this part of the agent currently holds, and
 * whether it will work. The fields themselves are one press away, in the
 * inspector, for the same reason the flow editor keeps them off the canvas —
 * a card you can edit in place is a card you cannot read at a distance.
 */
export function AgentNodeCard({
  node,
  selected,
  onOpen,
  fixedHeight = false,
}: {
  node: AgentNode;
  selected: boolean;
  onOpen: () => void;
  /** On the graph the height is the layout's, so the card fills its box. */
  fixedHeight?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        // A `pending` card opens like every other one — it just has nothing to
        // set. Making it inert instead would leave the reader with a card that
        // says «Hali yo'q» and no way to find out what to do in the meantime,
        // which is the question the card raises. The dashed edge is what says
        // it is not a working part of the agent; refusing the press would say
        // it is not part of the screen.
        "oq-press relative flex cursor-pointer flex-col gap-1 rounded-[14px] border bg-surface px-3.5 py-3 text-left transition-[border-color,box-shadow] duration-150",
        fixedHeight && "h-full overflow-hidden",
        node.pending && "border-dashed opacity-70",
        selected ? "border-accent-500" : "border-separator",
      )}
      style={
        selected
          ? { boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-accent-500) 30%, transparent)" }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        <Icon name={node.icon} size={15} style={{ color: node.color }} className="flex-none" />
        <span className="t-subhead min-w-0 flex-1 truncate font-medium">{node.title}</span>
        {node.badge && (
          <span className="t-caption flex-none rounded-full bg-neutral-800 px-2 py-[2px] text-neutral-400">
            {node.badge}
          </span>
        )}
      </div>

      <p className="t-caption t-tertiary m-0 line-clamp-2 whitespace-pre-wrap">{node.summary}</p>

      {node.problem && (
        /* Amber and not red: none of these stops the agent from being saved
           except the two that say so, and a card that shouts about a missing
           budget in the same voice as a broken URL teaches the reader to
           ignore both. */
        <p className="t-caption m-0 mt-auto flex items-start gap-1.5 text-warning-fg">
          <Icon name="warning" size={13} className="mt-[2px] flex-none" />
          <span className="min-w-0 flex-1 line-clamp-2">{node.problem}</span>
        </p>
      )}

      {node.ports && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-0 p-0">
          {node.ports.map((port) => (
            <li key={port.id} className="flex h-[26px] items-center gap-2">
              {/* A dot in the exit's own colour — the same three the «AI agent»
                  block's ports wear on the flow canvas, so the two drawings of
                  the same three exits read as the same three exits. */}
              <span
                aria-hidden
                className="size-[9px] flex-none rounded-full"
                style={{ background: port.color }}
              />
              <span className="t-caption min-w-0 flex-1 truncate" style={{ color: port.color }}>
                {port.label}
              </span>
              {port.carriesFailures && (
                <span className="t-caption t-tertiary flex-none">xatolik shu yerga</span>
              )}
              {typeof port.count === "number" && (
                <span className="t-caption t-tertiary flex-none tabular-nums">{port.count}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
