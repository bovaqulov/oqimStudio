import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { NewBotForm } from "@/features/bots/components/NewBotForm";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export default async function NewBotPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const { workspace } = await getSession();
  /*
   * Opened from a project's own page, the bot belongs to that project — the
   * form still asks for nothing, the page it was opened from already said it.
   * Resolved here rather than trusted from the query: an id from another
   * workspace simply resolves to nothing and the action falls back.
   */
  const project = projectId ? await projectsRepository.getById(workspace.id, projectId) : undefined;
  /*
   * Every project in the workspace, for the case the query named none.
   *
   * Reached from "Botlar" rather than from a project's own page, this form had
   * nothing to say about where the bot would land and no way to choose — it
   * fell to whatever `resolveProjectId` picked. Two businesses in one workspace
   * is the case that makes that unacceptable: a clinic's bot silently filed
   * under the school.
   */
  const projects = project ? [] : await projectsRepository.list(workspace.id);
  /*
   * Whether the second half of the form can be offered. Read here rather than
   * in the client component: the real answer lives on Telegram
   * (`getMe().can_manage_bots`), so it is one server round trip either way,
   * and asking for it on the server means the tab arrives already knowing
   * instead of flickering from "available" to "not".
   */
  const managed = await botsRepository.managedConfig(workspace.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          ...(project ? [{ label: project.name, href: `/projects/${project.id}` }] : []),
          { label: "Botlar", href: "/bots" },
          { label: "Yangi bot" },
        ]}
        title="Yangi bot"
        subtitle="Telegram botini ish maydoniga ulash"
      />
      <PageBody maxWidth={640}>
        <Panel className="p-4">
          <NewBotForm
            project={project ? { id: project.id, name: project.name } : undefined}
            projects={projects.map((item) => ({ id: item.id, name: item.name }))}
            managed={managed}
          />
        </Panel>
      </PageBody>
    </>
  );
}
