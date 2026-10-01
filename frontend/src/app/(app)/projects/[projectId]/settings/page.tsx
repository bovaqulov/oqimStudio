import { notFound } from "next/navigation";
import { ProjectSettingsPanel } from "@/features/projects/components/ProjectSettingsPanel";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { workspace } = await getSession();
  const project = await projectsRepository.getById(workspace.id, projectId);
  if (!project) notFound();

  return <ProjectSettingsPanel project={project} />;
}
