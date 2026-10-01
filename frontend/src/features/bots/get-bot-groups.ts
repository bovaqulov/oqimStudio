import { projectsRepository } from "@/features/projects";
import { botsRepository } from "./data/bots-repository";
import type { Bot } from "./types";

export interface BotGroup {
  projectId: string;
  projectName: string;
  projectHref: string;
  bots: Bot[];
}

/**
 * The workspace-wide "Botlar" list, grouped by the project each bot belongs
 * to. Like the project page's resource groups this is a view over two
 * features' data, so it lives as a composition function instead of teaching
 * either repository about the other (keeps each repository single-purpose).
 */
export async function getBotGroups(workspaceId: string): Promise<BotGroup[]> {
  const [bots, projects] = await Promise.all([
    botsRepository.list(workspaceId),
    projectsRepository.list(workspaceId),
  ]);

  return projects
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      projectHref: `/projects/${project.id}`,
      bots: bots.filter((bot) => bot.projectId === project.id),
    }))
    .filter((group) => group.bots.length > 0);
}
