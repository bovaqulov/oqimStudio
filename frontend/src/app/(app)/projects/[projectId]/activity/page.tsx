import { ProjectActivityList } from "@/features/projects/components/ProjectActivityList";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { workspace } = await getSession();
  const entries = await projectsRepository.getActivity(workspace.id, projectId);

  return <ProjectActivityList entries={entries} />;
}
