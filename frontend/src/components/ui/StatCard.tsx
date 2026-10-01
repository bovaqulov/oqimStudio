import { Icon, type IconName } from "./Icon";
import { Panel } from "./Panel";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  icon,
  label,
  value,
  delta,
  positive = true,
}: {
  icon?: IconName;
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
}) {
  return (
    <Panel className="flex flex-col gap-1.5 px-3.5 py-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-600">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="text-[23px] font-medium tracking-tight">{value}</div>
      {delta && (
        <div className={cn("text-[11px]", positive ? "text-success-fg" : "text-neutral-600")}>
          {delta}
        </div>
      )}
    </Panel>
  );
}
