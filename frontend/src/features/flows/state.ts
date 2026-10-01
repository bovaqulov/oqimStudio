import type { StatusLabel } from "@/components/ui/types";
import type { FlowRecord, FlowSummary } from "./types";

/**
 * The one reading of "is this flow live?", shared by the card that shows it, the
 * switch that flips it and the repository that writes it down.
 *
 * `enabled` is the field; `status` is the label. They are kept in step by
 * `flowStatus` below rather than by every caller remembering to set both, and a
 * record written before the field existed falls back to what its label already
 * said — a seeded "Faol" flow reads as on without a migration.
 */
export function isFlowEnabled(flow: Pick<FlowSummary, "enabled" | "status">): boolean {
  return flow.enabled ?? flow.status.tone === "success";
}

/** The label that belongs to a given switch position — the only place these two words are chosen. */
export function flowStatus(enabled: boolean): StatusLabel {
  return enabled ? { label: "Faol", tone: "success" } : { label: "O'chirilgan", tone: "neutral" };
}

/** How many times the flow has run. Absent means it has never run, not "unknown". */
export function flowRuns(flow: Pick<FlowSummary, "runs">): number {
  return flow.runs ?? 0;
}

/** Whether the flow has anything to run at all — an empty canvas is a flow in name only. */
export function isFlowEmpty(flow: Pick<FlowRecord, "nodes">): boolean {
  return flow.nodes.length === 0;
}
