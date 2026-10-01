"use client";

import { memo, useMemo } from "react";
import type { FlowNode } from "@/features/flows";
import { findTriggerConflicts } from "../lib/trigger";
import { FlowEdgesLayer } from "./FlowEdgesLayer";
import { FlowNodeCard } from "./FlowNodeCard";

/**
 * The graph itself, split out from the canvas so that panning and zooming —
 * which only move the transform wrapper around it — cost nothing.
 *
 * Without this boundary the canvas re-rendered every card and re-routed every
 * edge on each frame of a pan, work that could never change the picture: the
 * blocks sit at the same coordinates the whole time, and the browser is
 * already moving them with a single CSS transform.
 */
export const FlowGraph = memo(function FlowGraph({ nodes }: { nodes: FlowNode[] }) {
  // Every Handler has to be compared against every other one to find the
  // racing pairs, so it is computed once per graph change rather than per card.
  const conflicts = useMemo(() => findTriggerConflicts(nodes), [nodes]);

  return (
    <>
      <FlowEdgesLayer nodes={nodes} />
      {nodes.map((node) => (
        // Joined here rather than in the card: a fresh array on every drag
        // frame would defeat the card's own memo, a string never does.
        <FlowNodeCard key={node.id} node={node} conflict={conflicts.get(node.id)?.join("; ")} />
      ))}
    </>
  );
});
