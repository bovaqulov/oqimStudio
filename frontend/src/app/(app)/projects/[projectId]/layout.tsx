import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionTabsBar } from "@/components/layout/SectionTabsBar";
import { ProjectTabs } from "@/features/projects/components/ProjectTabs";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

/**
 * The identity card that used to sit above the tabs — a 46px icon, the name
 * again, the tag again and the description — is gone: the page header already
 * says which project this is, and the description is a fact that belongs on
 * the Sozlamalar tab, where it is now one row. What is left above the content
 * is one navigation row, the same as on a bot.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { workspace } = await getSession();
  const project = await projectsRepository.getById(workspace.id, projectId);
  if (!project) notFound();

  return (
    <>
      <PageHeader title={project.name} breadcrumbs={[{ label: "Loyihalar", href: "/projects" }]} />
      <SectionTabsBar><ProjectTabs projectId={project.id} /></SectionTabsBar>
      <PageBody maxWidth={640} chrome="tabs">
        {children}
      </PageBody>
    </>
  );
}
