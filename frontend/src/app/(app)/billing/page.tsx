import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { ToastButton } from "@/components/ui/ToastButton";
import { InvoiceTable } from "@/features/billing/components/InvoiceTable";
import { PlanCard } from "@/features/billing/components/PlanCard";
import { UsageMeter } from "@/features/billing/components/UsageMeter";
import { billingRepository } from "@/features/billing/data/billing-repository";
import { getPlans } from "@/features/billing/get-plans";
import { getUsageReport } from "@/features/billing/get-usage";
import { planPriceLabel } from "@/features/billing/plans";
import { usagePercent } from "@/features/billing/types";
import { getSession } from "@/features/workspace/session";

export default async function BillingPage() {
  const { workspace } = await getSession();
  const [subscription, invoices, plans] = await Promise.all([
    billingRepository.getSubscription(workspace.id),
    billingRepository.listInvoices(workspace.id),
    getPlans(workspace.id),
  ]);
  const planKey = subscription?.planKey ?? workspace.planKey;
  const plan = plans.find((row) => row.key === planKey);
  const usage = await getUsageReport(workspace.id, planKey);
  /*
   * A plan that costs nothing is not a plan that is waiting to be paid for.
   * This screen said both at once: «Bepul» beside the price, «Obuna
   * rasmiylashtirilmagan» under it, and a box warning that flows would stop
   * when the trial ran out — on a plan that has no trial, no renewal and
   * nothing to stop. Every sentence about payment below asks this first.
   *
   * `plan` can be missing — a workspace on a key the price list has no row for
   * — and an unknown plan is not a free one, so the paid wording stands.
   */
  const free = plan?.price === 0;
  // Only the limits that are close to being hit belong on this screen; the
  // full picture lives on the Limitlar tab.
  const pressing = usage.metrics.filter((metric) => (usagePercent(metric) ?? 0) >= 75);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-[2_1_360px] rounded-[16px] bg-surface p-4 shadow-md">
          <div className="mb-3.5 flex flex-wrap items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="t-footnote t-secondary">Joriy tarif</span>
                {subscription && <Badge tone={subscription.status.tone}>{subscription.status.label}</Badge>}
              </div>
              <div className="t-title2 mt-1">{plan?.name ?? usage.planName}</div>
              {/* The plan's own currency, never the workspace's — see `Plan`. */}
              {plan && <div className="t-subhead t-secondary">{planPriceLabel(plan, "/ oy")}</div>}
              <div className="t-footnote t-tertiary mt-1">
                {subscription
                  ? `Keyingi to'lov: ${subscription.renewsAt}`
                  : free
                    ? "Bepul tarif — obuna talab qilinmaydi"
                    : "Obuna rasmiylashtirilmagan"}
              </div>
            </div>
          </div>

          {pressing.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
              {pressing.map((metric) => (
                <UsageMeter key={metric.key} metric={metric} />
              ))}
            </div>
          ) : (
            <div className="t-footnote t-tertiary">Limitlar bo&apos;yicha muammo yo&apos;q.</div>
          )}
          <Link
            href="/billing/usage"
            className="t-body mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-accent-400"
          >
            Barcha limitlar <Icon name="caret-right" size={15} />
          </Link>
        </div>

        <Panel className="flex min-w-0 flex-[1_1_252px] flex-col gap-[11px] p-4">
          <div className="t-headline">To&apos;lov usuli</div>
          {subscription?.paymentMethod ? (
            <div className="flex items-center gap-2.5 rounded-md border border-neutral-900 bg-surface-raised p-[11px]">
              <Icon name="credit-card" size={16} className="text-accent-300" />
              <div className="flex-1">
                <div className="text-[14px] md:text-[12.5px]">{subscription.paymentMethod.label}</div>
                <div className="text-[12px] text-neutral-600 md:text-[11px]">{subscription.paymentMethod.expiry}</div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-neutral-800 p-[11px] text-[13px] leading-relaxed text-neutral-600 md:text-[11.5px]">
              {free
                ? "Karta kerak emas — bu tarif bepul va muddati tugamaydi. Karta faqat pullik tarifga o'tganda kerak bo'ladi."
                : "Karta biriktirilmagan. Obuna muddati tugagach oqimlar to'xtamasligi uchun karta qo'shing."}
            </div>
          )}
          {/*
            The button used to promise a window: "Karta qo'shish oynasi
            ochiladi". No such window exists — there is no card vault in this
            product and no acquirer behind one — so the promise was the whole
            behaviour, and in the light theme, where the toast was white on
            white, pressing it did nothing observable at all. It now says what
            actually happens, which is that a person takes the payment.
          */}
          <ToastButton
            message="Karta biriktirish hozircha panelda emas — to'lovni Payme yoki Click orqali amalga oshiring."
            className="min-h-[44px] rounded-md bg-neutral-800 text-[14px] text-neutral-300 hover:bg-neutral-700 hover:text-white md:min-h-0 md:py-[7px] md:text-[12px]"
          >
            To&apos;lash usullari
          </ToastButton>
          <div className="text-[12px] leading-relaxed text-neutral-600 md:text-[11px]">
            To&apos;lovlar Payme va Click orqali qabul qilinadi. Yuridik shaxslar uchun shartnoma va hisob-faktura
            beriladi.
          </div>
        </Panel>
      </div>

      <div id="plans">
        <div className="mb-2.5 text-[15px] font-medium md:text-[13px]">Tariflar</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3">
          {plans.map((item) => (
            <PlanCard key={item.key} plan={item} current={item.key === planKey} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2.5 text-[15px] font-medium md:text-[13px]">Hisob-fakturalar</div>
        <InvoiceTable invoices={invoices} />
      </div>
    </div>
  );
}
