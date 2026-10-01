/**
 * What a plan row *reads* as.
 *
 * The rows themselves — key, name, price, currency, limits — belong to the
 * backend's `Plan` table and are fetched, not repeated: see `get-plans.ts`.
 * This file holds the only part of a plan the backend has no column for, which
 * is the noun each limit is counted in, and the two rules for turning a row
 * into the lines a card shows.
 *
 * There is deliberately no price and no limit written down here any more. There
 * were, and they were wrong in three separate ways at once — a Start plan
 * quoted at 290 000 that the backend gives away for nothing, a `business` key
 * against rows that say `biznes`, and two bots promised on a plan the API
 * allows one bot on. A second price list does not stay a copy of the first.
 */
import { currencyLabel } from "@/features/analytics/format";
import { formatThousands } from "@/lib/utils/format";
import type { Plan } from "./types";

/**
 * The noun each limit is counted in, in the order a card lists them.
 *
 * The keys are the plan's `limits` keys, which are also `UsageMetric.key` and
 * `apps.billing.services.RESOURCES` — one vocabulary for the gauge, the guard
 * and the price list. A key nobody has a noun for is left off a card rather
 * than printed raw.
 */
const LIMIT_NOUNS: Record<string, string> = {
  bots: "bot",
  flows: "oqim",
  messages: "xabar",
  contacts: "kontakt",
  members: "jamoa a'zosi",
  aiBlocks: "AI bloki",
  // The plan is where scripting is bought, so it is the one place the gate has
  // to be legible before anybody opens an editor and finds the «Kod» button
  // locked. On the entry plan the line reads «oqim skripti yo'q», which is the
  // same answer that button gives.
  scripts: "oqim skripti",
};

/**
 * The lines under a plan's price, read off the row the API refuses on.
 *
 * Only what the row actually declares. A limit the plan does not mention is not
 * a promise of unlimited use — it is a plan that says nothing about it, and a
 * card that advertised "cheksiz" on that basis would be advertising whatever
 * the price list happened to forget.
 */
export function planFeatures(plan: Plan): string[] {
  const lines: string[] = [];
  for (const [key, noun] of Object.entries(LIMIT_NOUNS)) {
    const limit = plan.limits[key];
    // Absent, not merely null: JSON has no `undefined`, so this is the row
    // saying nothing about the resource at all.
    if (limit === undefined) continue;
    // Explicit `null` is the row saying "uncapped" out loud, and 0 is the row
    // saying the plan does not include this at all — the difference matters
    // most on the entry plan, where one of the two is the reason to upgrade.
    if (limit === null) lines.push(`Cheksiz ${noun}`);
    else if (limit === 0) lines.push(`${noun} yo'q`);
    else lines.push(`${formatThousands(limit)} ${noun}`);
  }
  return lines;
}

/**
 * A plan's price, in the currency the plan is *sold* in.
 *
 * `perMonth` is passed in because the words around it are the reader's: the
 * settings screen takes it from the dictionary, and the billing screen is still
 * Uzbek in the component. A free plan carries no period — "Bepul / oy" reads as
 * a price of nothing charged monthly.
 */
export function planPriceLabel(plan: Plan, perMonth: string): string {
  if (plan.price === 0) return "Bepul";
  return `${formatThousands(plan.price)} ${currencyLabel(plan.currency)} ${perMonth}`;
}
