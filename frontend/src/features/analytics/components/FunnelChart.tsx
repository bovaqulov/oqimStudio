import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatThousands } from "@/lib/utils/format";
import type { AnalyticsFunnelStep } from "../types";

/**
 * Where the conversations go. Each step is a count and the share of the first
 * step it kept, and the hierarchy is carried by weight rather than by size:
 * the label is 15/400, the count 17/600, the percentage 13 tertiary. Before,
 * all three were 11.5px and the reader had to work out which was which.
 *
 * The line under the heading is there because the numbers here are smaller
 * than the tiles above them and that has to be explained rather than
 * discovered: a step counts people, a tile counts events, and one customer who
 * taps four buttons is four taps and one person.
 */
export function FunnelChart({ steps }: { steps: AnalyticsFunnelStep[] }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-surface p-4 shadow-md">
      <h3 className="t-headline m-0">Voronka</h3>
      <p className="t-footnote t-tertiary m-0 mb-3 pt-0.5">Har bir qadam — shu bosqichgacha yetgan mijozlar soni</p>
      <div className="flex flex-col gap-3">
        {steps.map((step) => (
          <div key={step.key}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="t-subhead t-secondary min-w-0 flex-1 truncate">{step.label}</span>
              <span className="t-headline flex-none tabular-nums">{formatThousands(step.value)}</span>
              <span className="t-footnote t-tertiary w-9 flex-none text-right tabular-nums">{step.percent}%</span>
            </div>
            <ProgressBar percent={step.percent} thickness={6} />
          </div>
        ))}
      </div>
    </div>
  );
}
