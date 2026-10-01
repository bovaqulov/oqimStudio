import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { Project } from "../types";

/**
 * One project, as a row.
 *
 * It was a card in a 248px grid: a bordered box carrying the name, the handle,
 * the channels, a status badge, a flow count, a contact count and an arrow —
 * seven things about a folder nobody opens for its statistics. On a 390px
 * screen that grid is one column anyway, which makes it a list drawn as boxes.
 * The row says the two things that pick a project out of a list, and the
 * counts live on the project's own screen where they can be read properly.
 *
 * The `featured` flag went with it: the first project in the response was
 * outlined in accent, which promised the reader a meaning ("this one is
 * special") that the ordering never had.
 */
export function ProjectRow({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`} className="oq-row">
      <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
        <Icon name={project.icon} size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-headline truncate">{project.name}</span>
        <span className="t-footnote t-secondary truncate">{project.channelsLabel || project.handle}</span>
      </span>
      {/* A badge on every row is a column of green nobody reads. Only a project
          that is *not* running has something to say here. */}
      {project.status.tone !== "success" && <Badge tone={project.status.tone}>{project.status.label}</Badge>}
      <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
    </Link>
  );
}
