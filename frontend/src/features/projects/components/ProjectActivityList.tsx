import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import type { ProjectActivityEntry } from "../types";

/**
 * What happened in this project, as rows rather than as a table.
 *
 * The "Hodisa / Sana" caption row went with the table: two uppercase words
 * naming columns that a date on the right and a sentence on the left name
 * themselves.
 */
export function ProjectActivityList({ entries }: { entries: ProjectActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <Panel>
        <EmptyState icon="clock-counter-clockwise" title="Hali hodisa yo'q" />
      </Panel>
    );
  }

  return (
    <div className="oq-group" data-inset="icon">
      {entries.map((entry, index) => (
        <div key={`${entry.subject}-${index}`} className="oq-row">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
            <Icon name={entry.icon} size={17} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-headline truncate">{entry.subject}</span>
            <span className="t-footnote t-secondary line-clamp-2">{entry.text}</span>
          </span>
          <span className="t-footnote t-tertiary flex-none">{entry.when}</span>
        </div>
      ))}
    </div>
  );
}
