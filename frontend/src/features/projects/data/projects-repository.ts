import "server-only";
import { apiFind, apiList, apiRequest } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import type { CreateProjectInput, Project, ProjectActivityEntry, UpdateProjectInput } from "../types";

/**
 * Projects, read from `/api/projects/`.
 *
 * Every method is tenant-scoped: the workspace id comes first and travels as
 * the request's `X-Workspace-Id`, so a project id guessed from another
 * workspace resolves to `undefined` rather than to somebody else's folder.
 */
export interface ProjectsRepository {
  list(workspaceId: string): Promise<Project[]>;
  getById(workspaceId: string, id: string): Promise<Project | undefined>;
  getActivity(workspaceId: string, id: string): Promise<ProjectActivityEntry[]>;
  create(input: CreateProjectInput): Promise<Project>;
  /**
   * Renames a project, or rewrites its description.
   *
   * `handle` is deliberately not among the fields the backend accepts: it is
   * what the project's id was built from, so letting a rename change it would
   * turn every link anybody has already sent — a bookmark, a message, the
   * breadcrumb in somebody's other tab — into a 404. The reader gets a new
   * name; the address stays what it was.
   */
  update(workspaceId: string, id: string, patch: UpdateProjectInput): Promise<Project>;
  /**
   * Deletes an empty project. The backend refuses a folder that still holds
   * bots or flows — both cascade from it, so a delete there would take the
   * bots answering customers with it (`apps/projects/views.py`).
   */
  delete(workspaceId: string, id: string): Promise<void>;
}

type ProjectDto = Omit<Project, "createdAt"> & { createdAt: string };
type ActivityDto = { id: string; subject: string; text: string; icon: string; when: string };

function toProject(dto: ProjectDto): Project {
  return { ...dto, createdAt: formatInstant(dto.createdAt) };
}

class ApiProjectsRepository implements ProjectsRepository {
  async list(workspaceId: string): Promise<Project[]> {
    const rows = await apiList<ProjectDto>("/api/projects/", { workspaceId });
    return rows.map(toProject);
  }

  async getById(workspaceId: string, id: string): Promise<Project | undefined> {
    const dto = await apiFind<ProjectDto>(`/api/projects/${id}/`, { workspaceId });
    return dto && toProject(dto);
  }

  async getActivity(workspaceId: string, id: string): Promise<ProjectActivityEntry[]> {
    const rows = await apiList<ActivityDto>(`/api/projects/${id}/activity/`, { workspaceId });
    return rows.map((row) => ({
      subject: row.subject,
      text: row.text,
      icon: row.icon as ProjectActivityEntry["icon"],
      when: formatRelative(row.when),
    }));
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const dto = await apiRequest<ProjectDto>("/api/projects/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: { name: input.name, description: input.description },
    });
    return toProject(dto);
  }

  async update(workspaceId: string, id: string, patch: UpdateProjectInput): Promise<Project> {
    const dto = await apiRequest<ProjectDto>(`/api/projects/${id}/`, {
      method: "PATCH",
      workspaceId,
      body: patch,
    });
    return toProject(dto);
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    await apiRequest(`/api/projects/${id}/`, { method: "DELETE", workspaceId });
  }
}

export const projectsRepository: ProjectsRepository = new ApiProjectsRepository();
