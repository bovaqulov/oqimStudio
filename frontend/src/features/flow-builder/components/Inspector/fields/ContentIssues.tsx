import { Icon } from "@/components/ui/Icon";

/** Surfaces the blocking gaps in a block's content config instead of letting it look ready when it is not. */
export function ContentIssues({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-warning-bg p-2">
      {issues.map((issue) => (
        <div key={issue} className="flex items-start gap-1.5 text-[11px] max-md:text-[13px] leading-relaxed text-warning-fg">
          <Icon name="warning" size={12} className="mt-[1px] flex-none" />
          <span>{issue}</span>
        </div>
      ))}
    </div>
  );
}
