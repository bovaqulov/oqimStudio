import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ToastButton } from "@/components/ui/ToastButton";
import { currencyLabel } from "@/features/analytics/format";
import { cn } from "@/lib/utils/cn";
import { formatThousands } from "@/lib/utils/format";
import { planFeatures } from "../plans";
import type { Plan } from "../types";

export function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[16px] bg-surface p-4 shadow-md",
        current && "ring-2 ring-accent-500 ring-inset",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="t-headline flex-1">{plan.name}</span>
        {current && <Badge tone="accent">Joriy</Badge>}
      </div>
      {/*
        The plan's own currency, and no period on a free plan. This used to take
        the *workspace's* currency as a prop, on the reasoning that the
        catalogue held bare amounts — it held so'm, so a workspace reporting in
        dollars was quoted so'm prices with a $ after them.
      */}
      <div className="flex items-baseline gap-1.5">
        {plan.price === 0 ? (
          <span className="t-title2">Bepul</span>
        ) : (
          <>
            <span className="t-title2">{formatThousands(plan.price)}</span>
            <span className="t-footnote t-tertiary">{currencyLabel(plan.currency)} / oy</span>
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        {planFeatures(plan).map((feature) => (
          <div key={feature} className="t-footnote t-secondary flex items-start gap-2">
            <Icon name="check" size={14} className="mt-px flex-none text-accent-400" />
            {feature}
          </div>
        ))}
      </div>
      <ToastButton
        message={current ? `${plan.name} · joriy tarif` : `${plan.name} tarifiga o'tish so'rovi yuborildi`}
        disabled={current}
        // Plain text, not a fill: a page of plans is a page of choices, and
        // three filled blue buttons side by side is three primary actions.
        className={cn(
          "oq-press flex min-h-[44px] items-center justify-center rounded-[12px] text-[17px] font-medium",
          current ? "t-secondary cursor-default" : "cursor-pointer text-accent-400",
        )}
      >
        {current ? "Joriy tarif" : "Tanlash"}
      </ToastButton>
    </div>
  );
}
