import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import type { ProjectResourceGroup } from "../get-resource-groups";

/**
 * One group of a project's resources — its bots, its flows, its agents — as a
 * grouped list. The last group is not resources but two destinations, so both
 * the add row and the per-row badge are optional here rather than a second
 * component that would drift away from this one row by row.
 *
 * What it replaces: an uppercase tracking-out caption, a grey pill button
 * floating to its right, and rows carrying a name, a meta line, a badge and a
 * 150px right-hand statistic column that wrapped to nothing on a phone. The
 * heading is now the group's own (sentence case, secondary), the add button is
 * the group's last row, and every row says two things: what it is, and what it
 * is doing.
 */
export function ResourceGroupList({ group }: { group: ProjectResourceGroup }) {
  return (
    <ListGroup title={group.title} inset="icon">
      {group.rows.map((row) => (
        <Link key={row.id} href={row.href} className="oq-row">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
            <Icon name={row.icon} size={17} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-headline truncate">{row.name}</span>
            {row.meta && <span className="t-footnote t-secondary truncate">{row.meta}</span>}
          </span>
          {/* Only a resource that is not simply running has something to add —
              and only a row that is a resource at all has a state to report.
              The two at the bottom are links to other screens. */}
          {row.status && row.status.tone !== "success" && (
            <Badge tone={row.status.tone}>{row.status.label}</Badge>
          )}
          <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
        </Link>
      ))}

      {/* An empty group is this row on its own — "Hozircha bo'sh" above a
          button says nothing the button does not.

          Absent for a group nothing here can add to. A contact is written by a
          bot being talked to, not by a button on this page, and a "+" that
          could only open a screen saying so is worse than no "+" at all. */}
      {group.addHref && group.addLabel && (
        <Link href={group.addHref} className="oq-row">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-800 text-accent-400">
            <Icon name="plus" size={17} />
          </span>
          <span className="t-body min-w-0 flex-1 truncate text-accent-400">{group.addLabel}</span>
        </Link>
      )}

      {/* Under the add row, not beside the heading: it is the rarer of the two
          and a group is read downwards. */}
      {group.allHref && (
        <Link href={group.allHref} className="oq-row">
          <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
            <Icon name="folders" size={17} />
          </span>
          <span className="t-body min-w-0 flex-1 truncate text-neutral-300">{group.allLabel}</span>
          <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
        </Link>
      )}
    </ListGroup>
  );
}
