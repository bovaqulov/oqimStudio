import "server-only";
import { apiFind, apiList, apiRequest } from "@/lib/api/server";
import { formatInstant } from "@/lib/utils/date";
import type {
  MemberRole,
  Workspace,
  WorkspaceInviteLink,
  WorkspaceInvitePreview,
  WorkspaceMember,
} from "../types";

export interface CreateWorkspaceInput {
  name: string;
  timezone?: string;
  locale?: string;
  currency?: string;
}

export interface InviteMemberInput {
  workspaceId: string;
  name: string;
  email: string;
  role: MemberRole;
}

/**
 * The tenant directory: which workspaces this account belongs to, who else is
 * in them, and with what role.
 *
 * Backed by `/api/workspaces/`. The interface is what the pages depend on
 * (Dependency Inversion) — it did not change when the in-memory seeds behind
 * it were replaced by the Django backend, which is what the seam was for.
 *
 * Who the caller *is* never travels as an argument: the request carries the
 * session token, and the backend answers for whoever that is.
 */
export interface WorkspacesRepository {
  getById(workspaceId: string): Promise<Workspace | undefined>;
  /** Every workspace the signed-in account belongs to — the switcher's contents. */
  listForUser(): Promise<Workspace[]>;
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | undefined>;
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  update(workspaceId: string, patch: Partial<Omit<Workspace, "id">>): Promise<Workspace | undefined>;
  invite(input: InviteMemberInput): Promise<WorkspaceMember>;
  setMemberRole(memberId: string, role: MemberRole): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  /** Redeems an invite code into a membership for the signed-in account. */
  join(code: string): Promise<Workspace>;
  /**
   * Mints a single-use invite and names the links that carry it — one to paste,
   * one that opens Telegram's own share sheet with the message written.
   */
  createInviteLink(workspaceId: string, role: MemberRole): Promise<WorkspaceInviteLink>;
  /** What an invite offers — read only, and it does not spend the code. */
  previewInvite(code: string): Promise<WorkspaceInvitePreview | undefined>;
}

/** The API's workspace, before the two date fields are made readable. */
type WorkspaceDto = Omit<Workspace, "createdAt"> & { createdAt: string };
type MemberDto = Omit<WorkspaceMember, "joinedAt"> & { joinedAt: string };
type InviteLinkDto = Omit<WorkspaceInviteLink, "expiresAt"> & { expiresAt: string };

function toWorkspace(dto: WorkspaceDto): Workspace {
  return { ...dto, createdAt: formatInstant(dto.createdAt) };
}

function toMember(dto: MemberDto): WorkspaceMember {
  return { ...dto, joinedAt: formatInstant(dto.joinedAt) };
}

class ApiWorkspacesRepository implements WorkspacesRepository {
  async getById(workspaceId: string): Promise<Workspace | undefined> {
    const dto = await apiFind<WorkspaceDto>(`/api/workspaces/${workspaceId}/`);
    return dto && toWorkspace(dto);
  }

  async listForUser(): Promise<Workspace[]> {
    const rows = await apiList<WorkspaceDto>("/api/workspaces/");
    return rows.map(toWorkspace);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await apiList<MemberDto>(`/api/workspaces/${workspaceId}/members/`, { workspaceId });
    return rows.map(toMember);
  }

  async getMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | undefined> {
    const members = await this.listMembers(workspaceId);
    return members.find((member) => member.userId === userId);
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const dto = await apiRequest<WorkspaceDto>("/api/workspaces/", { method: "POST", body: input });
    return toWorkspace(dto);
  }

  async update(workspaceId: string, patch: Partial<Omit<Workspace, "id">>): Promise<Workspace | undefined> {
    const dto = await apiFind<WorkspaceDto>(`/api/workspaces/${workspaceId}/`, {
      method: "PATCH",
      body: patch,
      workspaceId,
    });
    return dto && toWorkspace(dto);
  }

  async invite(input: InviteMemberInput): Promise<WorkspaceMember> {
    const { member } = await apiRequest<{ member: MemberDto }>(
      `/api/workspaces/${input.workspaceId}/members/`,
      { method: "POST", body: { email: input.email, role: input.role }, workspaceId: input.workspaceId },
    );
    return toMember(member);
  }

  async setMemberRole(memberId: string, role: MemberRole): Promise<void> {
    await apiRequest(`/api/members/${memberId}/`, { method: "PATCH", body: { role } });
  }

  async removeMember(memberId: string): Promise<void> {
    await apiRequest(`/api/members/${memberId}/`, { method: "DELETE" });
  }

  async join(code: string): Promise<Workspace> {
    const dto = await apiRequest<WorkspaceDto>("/api/workspaces/join/", { method: "POST", body: { code } });
    return toWorkspace(dto);
  }

  async previewInvite(code: string): Promise<WorkspaceInvitePreview | undefined> {
    return (await apiFind<WorkspaceInvitePreview>(`/api/workspaces/invite/${encodeURIComponent(code)}/`)) ?? undefined;
  }

  async createInviteLink(workspaceId: string, role: MemberRole): Promise<WorkspaceInviteLink> {
    const dto = await apiRequest<InviteLinkDto>(`/api/workspaces/${workspaceId}/invite-link/`, {
      method: "POST",
      workspaceId,
      body: { role },
    });
    return { ...dto, expiresAt: formatInstant(dto.expiresAt) };
  }
}

export const workspacesRepository: WorkspacesRepository = new ApiWorkspacesRepository();
