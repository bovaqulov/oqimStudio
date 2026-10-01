import { cn } from "@/lib/utils/cn";
import { Icon } from "./Icon";

export function CheckboxRow({
  checked,
  label,
  hint,
  onToggle,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[15px] transition-colors md:min-h-[34px] md:text-[13px]",
        checked ? "bg-accent-800 text-accent-200" : "bg-neutral-800 text-neutral-400",
      )}
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]",
          checked ? "bg-accent-700 text-white" : "border border-neutral-700",
        )}
      >
        {checked && <Icon name="check" size={12} weight="bold" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span>{label}</span>
        {hint && (
          <span className="t-footnote t-tertiary truncate font-mono">{hint}</span>
        )}
      </span>
    </button>
  );
}
