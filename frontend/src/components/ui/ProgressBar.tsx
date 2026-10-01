import { cn } from "@/lib/utils/cn";

export type ProgressTone = "accent" | "neutral" | "warning" | "danger";

const toneClasses: Record<ProgressTone, string> = {
  accent: "bg-accent-500",
  neutral: "bg-neutral-600",
  warning: "bg-warning-fg",
  danger: "bg-danger-fg",
};

export function ProgressBar({
  percent,
  tone = "accent",
  thickness = 5,
}: {
  percent: number;
  /** `warning`/`danger` are for a value approaching or past a limit — see `usageTone`. */
  tone?: ProgressTone;
  thickness?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="overflow-hidden rounded-full bg-neutral-900" style={{ height: thickness }}>
      <div className={cn("h-full transition-[width]", toneClasses[tone])} style={{ width: `${clamped}%` }} />
    </div>
  );
}
