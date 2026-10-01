import "server-only";
import { cache } from "react";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export interface ProjectLayer {
  projects: { id: string; name: string }[];
}

/**
 * `cache` so the sidebar, the phone sheet and every page header share one read
 * per request instead of asking the backend the same question three times.
 */
export const getProjectLayer = cache(async (): Promise<ProjectLayer> => {
  const { workspace } = await getSession();
  const projects = await projectsRepository.list(workspace.id);
  return { projects: projects.map((project) => ({ id: project.id, name: project.name })) };
});
