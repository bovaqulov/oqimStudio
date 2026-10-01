import type { UsageReport } from "./types";

/**
 * What the workspace's plan will not let the flow editor do, in the sentence
 * the API would refuse with.
 *
 * This exists because the editor was offering things the plan had already said
 * no to. «AI javob» sat in the palette with a number key beside it, the wizard
 * offered it, the author wired a flow around it — and the refusal arrived on
 * «Yoqish», at the end, from `check_graph_allows`, about a graph they had
 * already built. Meanwhile the limits screen two clicks away had been saying
 * «AI bloklari — Bu tarifda mavjud emas» the whole time.
 *
 * So the plan travels into the editor, and the palette reads it. The sentences
 * are not written here: every one of them is `lockReason` off the usage row,
 * which is `apps.billing.services.lock_reason` — the same module, the same
 * plan row and the same noun the 402 would have used. A lock composed here
 * would be a second opinion about the plan, and a second opinion is how the
 * editor came to disagree with the guard in the first place.
 */
export interface EditorPlanLimits {
  /**
   * Block types the plan will not run, keyed by `NodeType` → why, and where to
   * change it. A type that is absent is a type the plan covers.
   */
  blocks: Record<string, string>;
  /** Why this flow may not carry its own code, or `""` when it may. */
  script: string;
}

/**
 * Which plan limit gates which blocks in the palette.
 *
 * `AI_NODE_TYPES` in `apps/billing/services.py` is the other half of this and
 * holds the same one member — that set is what the server counts, this is what
 * the palette locks, and a block in one and not the other is exactly the
 * disagreement the whole item is about.
 *
 * Scripting is not here: it is not a block, it is the panel behind the «Kod»
 * button, so it travels as its own field.
 */
const GATED_BLOCKS: Record<string, string[]> = {
  aiBlocks: ["ai"],
};

/** Nothing is locked — what an editor opened without a plan reads. */
export const NO_PLAN_LIMITS: EditorPlanLimits = { blocks: {}, script: "" };

export function editorPlanLimits(usage: UsageReport): EditorPlanLimits {
  const reasons = new Map(usage.metrics.map((metric) => [metric.key, metric.lockReason]));
  const blocks: Record<string, string> = {};
  for (const [key, types] of Object.entries(GATED_BLOCKS)) {
    const reason = reasons.get(key);
    // Empty is the plan having room, which is most rows most of the time.
    if (!reason) continue;
    for (const type of types) blocks[type] = reason;
  }
  return { blocks, script: reasons.get("scripts") || "" };
}
