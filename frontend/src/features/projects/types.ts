import type { IconName } from "@/components/ui/Icon";
import type { StatusLabel } from "@/components/ui/types";

export interface Project {
  id: string;
  /** Tenant this project belongs to — every read is filtered by it. */
  workspaceId: string;
  name: string;
  handle: string;
  icon: IconName;
  tag: string;
  status: StatusLabel;
  description: string;
  flowCountLabel: string;
  contactCountLabel: string;
  channelsLabel: string;
  createdAt: string;
  createdBy: string;
}

export interface ProjectActivityEntry {
  subject: string;
  text: string;
  icon: IconName;
  when: string;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  description: string;
  /** Email of the member creating it — shown in the project's activity trail. */
  createdBy: string;
}

/** The two fields a project's settings screen can change. */
export interface UpdateProjectInput {
  name: string;
  description: string;
}
