import Link from "next/link";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { ProjectRow } from "@/features/projects/components/ProjectRow";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export default async function ProjectsPage() {
  const { workspace } = await getSession();
  const projects = await projectsRepository.list(workspace.id);

  return (
    <>
      {/* The subtitle said "every bot and account in the workspace", which is
          what the word "Loyihalar" already says. */}
      <PageHeader title="Loyihalar" />
      <PageBody maxWidth={640}>
        {projects.length === 0 ? (
          <Panel>
            <EmptyState icon="folders" title="Hozircha loyiha yo'q" />
            <div className="flex justify-center pb-6">
              <Link
                href="/projects/new"
                className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-2 text-accent-400"
              >
                <Icon name="plus" size={16} /> Yangi loyiha
              </Link>
            </div>
          </Panel>
        ) : (
          // The add row is the group's last row rather than a dashed tile at
          // the end of a grid: same place, same height, and it lines up with
          // the rows above it instead of imitating one.
          <ListGroup inset="icon">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
            <Link href="/projects/new" className="oq-row">
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-800 text-accent-400">
                <Icon name="plus" size={17} />
              </span>
              <span className="t-body min-w-0 flex-1 truncate text-accent-400">Yangi loyiha</span>
            </Link>
          </ListGroup>
        )}
      </PageBody>
    </>
  );
}
