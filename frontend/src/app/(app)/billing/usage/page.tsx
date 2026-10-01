import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { UsageMeter } from "@/features/billing/components/UsageMeter";
import { billingRepository } from "@/features/billing/data/billing-repository";
import { getUsageReport } from "@/features/billing/get-usage";
import { getSession } from "@/features/workspace/session";

/**
 * "Limitlar" — the second tab of /billing rather than an anchor on the tariff
 * page, so the two readings of a subscription stay two addresses.
 *
 * The tinted box that used to close the screen is gone. It said limits are
 * counted per period and renew monthly — which the heading over the meters
 * already states — and carried a filled blue "Tarifni oshirish" beside it, on a
 * screen whose whole job is to report. Upgrading happens on the Tariflar tab,
 * so the way there is a link, not this screen's primary action.
 */
export default async function UsagePage() {
  const { workspace } = await getSession();
  const subscription = await billingRepository.getSubscription(workspace.id);
  const planKey = subscription?.planKey ?? workspace.planKey;
  const usage = await getUsageReport(workspace.id, planKey);

  return (
    <div className="flex max-w-[560px] flex-col gap-5">

      <section className="flex flex-col gap-2">
        <h2 className="t-headline m-0 px-1">
          {usage.planName} · {usage.periodLabel}
        </h2>
        <Panel className="flex flex-col gap-5 p-4">
          {usage.metrics.map((metric) => (
            <UsageMeter key={metric.key} metric={metric} />
          ))}
        </Panel>
      </section>

      <Link
        href="/billing#plans"
        className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-1 text-accent-400"
      >
        Tarifni oshirish <Icon name="caret-right" size={15} />
      </Link>
    </div>
  );
}
