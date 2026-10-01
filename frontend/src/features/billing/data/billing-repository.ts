import "server-only";
import { apiList, apiRequest } from "@/lib/api/server";
import { formatInstant } from "@/lib/utils/date";
import type { Invoice, Plan, Subscription, UsageReport } from "../types";

/**
 * What the workspace is on, what a plan costs, and what it has been charged,
 * from `/api/billing/`.
 *
 * The catalogue is here now. It used to live in `features/billing/plans.ts` as
 * "marketing copy the backend has no opinion about" — but the backend has a
 * `Plan` table with a price, a currency and the limits `check_plan_allows`
 * refuses on, so the copy here was a second price list. The two drifted, as two
 * of anything do: this one still charged 290 000 for a Start plan the backend
 * gives away, called the top plan `business` where the rows say `biznes` — so a
 * workspace on it was shown Start's name and Start's price — and promised two
 * bots on a plan whose gauge, reading the real row, said one of one.
 */
export interface BillingRepository {
  /** The public price list. Product-level data: the same rows for every tenant. */
  listPlans(workspaceId: string): Promise<Plan[]>;
  getSubscription(workspaceId: string): Promise<Subscription | undefined>;
  listInvoices(workspaceId: string): Promise<Invoice[]>;
  setPlan(workspaceId: string, planKey: string): Promise<void>;
  /**
   * What has been used against what the plan allows. Read from the backend
   * rather than counted here: these are the numbers `check_plan_allows`
   * refuses on, and a gauge that disagrees with the guard is worse than none.
   */
  getUsage(workspaceId: string): Promise<UsageReport>;
}

type SubscriptionDto = Omit<Subscription, "renewsAt"> & { renewsAt: string | null };
/** DRF renders a `DecimalField` as a string, so the price arrives as "490000.00". */
type PlanDto = Omit<Plan, "price"> & { price: string };

class ApiBillingRepository implements BillingRepository {
  async listPlans(workspaceId: string): Promise<Plan[]> {
    const rows = await apiList<PlanDto>("/api/billing/plans/", { workspaceId });
    return rows.map((row) => ({ ...row, price: Number(row.price) }));
  }

  async getSubscription(workspaceId: string): Promise<Subscription | undefined> {
    const dto = await apiRequest<SubscriptionDto | null>("/api/billing/subscription/", { workspaceId });
    if (!dto) return undefined;
    return { ...dto, renewsAt: formatInstant(dto.renewsAt) };
  }

  async listInvoices(workspaceId: string): Promise<Invoice[]> {
    return apiList<Invoice>("/api/billing/invoices/", { workspaceId });
  }

  async setPlan(workspaceId: string, planKey: string): Promise<void> {
    await apiRequest("/api/billing/subscription/", { method: "POST", workspaceId, body: { planKey } });
  }

  async getUsage(workspaceId: string): Promise<UsageReport> {
    return apiRequest<UsageReport>("/api/billing/usage/", { workspaceId });
  }
}

export const billingRepository: BillingRepository = new ApiBillingRepository();
