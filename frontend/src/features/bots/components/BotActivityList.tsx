import { Icon } from "@/components/ui/Icon";
import type { BotActivityEntry } from "../types";

/**
 * What the bot has been doing.
 *
 * The uppercase tracked-out "FAOLIYAT" is gone: it is a group label inside a
 * section that already carries a heading, so it reads at the size the grouped
 * list gives its own titles. The rows themselves are 44px, which they were not.
 *
 * Renders nothing at all when there is nothing — an empty card takes a quarter
 * of a phone screen to say "hodisa yo'q".
 */
export function BotActivityList({ activity }: { activity: BotActivityEntry[] }) {
  if (activity.length === 0) return null;

  return (
    <div className="flex flex-col">
      <h3 className="t-footnote t-secondary m-0 pb-1">Faoliyat</h3>
      {activity.map((entry, index) => (
        <div key={index} className="flex min-h-[44px] items-center gap-3 border-t border-separator py-2.5">
          <Icon name={entry.icon} size={17} className="flex-none text-neutral-600" />
          <span className="t-subhead min-w-0 flex-1">{entry.text}</span>
          <span className="t-footnote t-tertiary flex-none">{entry.when}</span>
        </div>
      ))}
    </div>
  );
}
