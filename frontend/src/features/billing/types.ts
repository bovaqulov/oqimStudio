import type { StatusLabel } from "@/components/ui/types";

/**
 * One row of the price list, as the backend holds it.
 *
 * The price carries **its own** currency and never the workspace's. They are
 * two different questions: `Workspace.currency` is the tenant's formatting
 * default — what its reports and its own customers' invoices are read in — and
 * this is what Oqim Studio charges for the plan. Labelling one with the other
 * is how a 290 000 so'm plan came to read "290 000 $ / oy" on a workspace that
 * had switched its reports to dollars.
 *
 * `limits` is keyed the same way `UsageMetric.key` is, because it is the same
 * vocabulary the gauge and the guard share — see `apps/billing/services.py`.
 * `null` means uncapped.
 */
export interface Plan {
  key: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  limits: Record<string, number | null>;
}

/** How a workspace pays. `null` card means the plan is on a trial or an invoice agreement. */
export interface PaymentMethod {
  label: string;
  expiry: string;
}

export interface Subscription {
  workspaceId: string;
  planKey: string;
  status: StatusLabel;
  /** Human-readable renewal date, e.g. "1-sentabr 2026". */
  renewsAt: string;
  autoRenew: boolean;
  paymentMethod: PaymentMethod | null;
}

export interface Invoice {
  id: string;
  workspaceId: string;
  date: string;
  amount: number;
  currency: string;
  status: StatusLabel;
}

/** One line of the limits screen: what was used, out of what the plan allows. */
export interface UsageMetric {
  key: string;
  label: string;
  used: number;
  /** `null` means the plan does not cap this — shown as "cheksiz", never as a bar. */
  limit: number | null;
  hint: string;
  /**
   * Whether going over this one is refused, or only counted.
   *
   * Every limit but `messages` is refused (`billing.services.COUNTED_NOT_REFUSED`).
   * Messages are never blocked — a bot that stops answering because a counter
   * is full fails in front of a customer — so a full bar there means something
   * different, and the meter has to say which.
   */
  enforced: boolean;
  /**
   * What a full bar costs, in the terms of the thing that stops.
   *
   * Written per resource on the server (`RESOURCES[...]["whenFull"]`) rather
   * than composed here, because the consequence differs per key and only one
   * side knows it. The line every meter used to print — "yangi so'rovlar rad
   * etilyapti" — named nothing the reader owns: a «so'rov» is what their
   * customers send, so a full `bots` bar read as an outage when what had
   * actually happened was that a second bot could not be connected.
   */
  whenFull: string;
  /**
   * Why one more of this would be refused — for a control that has to say so
   * *before* it is pressed. Empty on every limit that still has room.
   *
   * The other half of `whenFull`, and a different moment: that one describes a
   * bar somebody is reading, this one is what a locked palette row, or a
   * disabled button, prints instead of letting a reader find out by being
   * refused. `apps.billing.services.lock_reason` writes it, beside the
   * `limit_message` the 402 carries, so the lock and the refusal cannot come
   * to say different things.
   */
  lockReason: string;
}

export interface UsageReport {
  metrics: UsageMetric[];
  /** What window `used` covers, e.g. "so'nggi 30 kun". */
  periodLabel: string;
  /** The plan these limits come from — the same one the API refuses on. */
  planKey: string;
  planName: string;
}

/** Nothing more of this resource may be created — the API refuses at this point. */
export function isOverLimit(metric: UsageMetric): boolean {
  return metric.limit !== null && metric.used >= metric.limit;
}

/** Share of the limit already used, or `null` when the metric is uncapped. */
export function usagePercent(metric: UsageMetric): number | null {
  if (metric.limit === null) return null;
  // A plan that allows none of something — the entry plan and AI blocks — is
  // full the moment one exists. Dividing by zero read as "uncapped", which is
  // the opposite of what a limit of 0 means.
  if (metric.limit === 0) return metric.used > 0 ? 100 : 0;
  return Math.min(100, Math.round((metric.used / metric.limit) * 100));
}

/**
 * Colour of a usage bar. Warning from 75% — and no red at all: a full limit
 * on the Free plan is the plan's own shape, not an emergency, and a screen
 * that opened blood-red for every Free workspace read as "something broke"
 * when nothing had. The one sentence that matters ("yangi so'rovlar rad
 * etilyapti") is still printed under the bar.
 */
export function usageTone(percent: number | null): "accent" | "warning" | "danger" {
  if (percent === null) return "accent";
  if (percent >= 75) return "warning";
  return "accent";
}
