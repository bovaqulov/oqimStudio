import { notFound, redirect } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { AgentEditor } from "@/features/agents/components/AgentEditor";
import { AgentStatusNotice } from "@/features/agents/components/AgentStatusNotice";
import { agentsRepository, UNKNOWN_STATUS } from "@/features/agents/data/agents-repository";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

/**
 * A new agent, on the same form the existing one is edited with.
 *
 * One editor and not two: a "create" screen that asks fewer questions than the
 * "edit" screen is how an agent ends up in the world with no budget and no
 * handover rule, which are exactly the two settings nobody comes back for.
 *
 * `?projectId=` is not optional, and it is a query rather than a path segment
 * for the same reason `/bots/new` takes one: the project is chosen on the
 * screen this is opened from — the project's own «Resurslar» tab — and the
 * form carries it through rather than asking again. Without one there is
 * nothing to create the agent in, so the reader is sent to pick a project
 * instead of being shown a form that can only fail. An ordinary redirect and
 * not a permanent one: this URL *does* serve a page, just not without its
 * project, and a 308 cached against the bare address is a trap for the next
 * reader who arrives with one.
 */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).projectId;
  const projectId = Array.isArray(raw) ? raw[0] : raw;
  if (!projectId) redirect("/projects");

  const { workspace } = await getSession();
  const [project, status] = await Promise.all([
    projectsRepository.getById(workspace.id, projectId),
    agentsRepository.status(workspace.id).catch(() => UNKNOWN_STATUS),
  ]);
  // Another workspace's project id resolves to nothing here, so a hand-edited
  // query cannot open a form that would file an agent into somebody else's
  // folder — and the backend refuses the same write again on the save.
  if (!project) notFound();

  return (
    <>
      <PageHeader
        title="Yangi agent"
        breadcrumbs={[
          { label: "Loyihalar", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Yangi agent" },
        ]}
      />
      {/* Same width as the saved agent's screen — the canvas is the editor in
          both, and a create screen that laid out differently would be a second
          editor to keep in step. */}
      <PageBody maxWidth={1120}>
        <div className="flex flex-col gap-4">
          <AgentStatusNotice status={status} />
          <AgentEditor projectId={project.id} status={status} />
        </div>
      </PageBody>
    </>
  );
}
