import type { EdgeTransition } from "@/features/flows";
import { TRANSITION_DASH, TRANSITION_STROKE, isMarkedTransition } from "../../../lib/transitions";

/**
 * One choice, wearing the mark the canvas will draw for it.
 *
 * A swatch and not a colour chip: the row shows the actual stroke the canvas
 * will draw — dashed for «Tahrirlash», dash-dot for «O'chirish», dotted for
 * «Tugmasiz qoldirish», a plain line for «Qoldirish» — so picking one here and
 * finding it on the canvas is recognition rather than recall.
 */
export function TransitionChoice({
  label,
  hint,
  transition,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  hint: string;
  transition: EdgeTransition;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const marked = isMarkedTransition(transition);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled && !selected}
      onClick={onSelect}
      className={`flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? "border-accent-600 bg-accent-900/30"
          : "border-neutral-800 bg-neutral-900/40 enabled:hover:border-neutral-700"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <span className="flex items-center gap-2">
        <svg width={22} height={8} viewBox="0 0 22 8" aria-hidden="true" className="flex-none">
          <line
            x1={0}
            y1={4}
            x2={22}
            y2={4}
            stroke={marked ? TRANSITION_STROKE : "var(--color-neutral-500)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={TRANSITION_DASH[transition] ?? undefined}
          />
        </svg>
        <span className="text-[12px] font-medium max-md:text-[14px]">{label}</span>
      </span>
      <span className="text-[10.5px] leading-relaxed text-neutral-500 max-md:text-[12.5px]">{hint}</span>
    </button>
  );
}
