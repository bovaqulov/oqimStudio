import { cache } from "react";
import { billingRepository } from "./data/billing-repository";
import type { Plan } from "./types";

/**
 * The price list, once per request.
 *
 * `cache` because more than one thing on a page wants it — the sidebar names
 * the workspace's plan, the screen prices it, the tariff grid lists all three —
 * and they would otherwise each spend a request on rows that are identical for
 * every tenant.
 */
export const getPlans = cache(async (workspaceId: string): Promise<Plan[]> =>
  billingRepository.listPlans(workspaceId),
);

/**
 * The row this workspace is on, or `undefined` when the price list has none.
 *
 * `undefined` and not a fallback row. The catalogue this replaced answered a key
 * it did not know with its first entry, so a workspace on `biznes` — a real key,
 * spelled `business` in that file — was shown Start's name and Start's price,
 * and nothing about the screen suggested it was looking at the wrong plan. A
 * caller that has nothing to show is better placed to say so.
 */
export async function getPlanFor(workspaceId: string, planKey: string): Promise<Plan | undefined> {
  return (await getPlans(workspaceId)).find((plan) => plan.key === planKey);
}
