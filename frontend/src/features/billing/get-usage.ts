import { billingRepository } from "./data/billing-repository";
import type { UsageReport } from "./types";

/**
 * What this workspace has used against what its plan allows.
 *
 * One call, to the endpoint that owns the answer. It used to be composed here
 * out of the analytics report and three lists, with the limits read from the
 * frontend's own catalogue — which meant the screen could show a comfortable
 * 40% while the API refused the next write, because the two were reading
 * different numbers. Now the gauge and the guard are the same rows.
 */
export async function getUsageReport(workspaceId: string, planKey: string): Promise<UsageReport> {
  const report = await billingRepository.getUsage(workspaceId);
  // A workspace can sit on a plan key the price list has no row for, and the
  // backend answers that with an empty name, which renders as a blank heading.
  // The key itself is the honest stand-in: it is what the workspace is actually
  // on. Inventing a name from a second catalogue is what this used to do.
  return { ...report, planName: report.planName || planKey };
}
