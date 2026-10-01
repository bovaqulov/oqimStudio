"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/server";
import { joinWorkspaceWithCodeAction } from "@/features/auth/actions";
import { workspacesRepository } from "./data/workspaces-repository";
import { canManageWorkspace } from "./roles";
import { getSession, WORKSPACE_COOKIE } from "./session";
import type { MemberRole, WorkspaceInviteLink } from "./types";
import { cookies } from "next/headers";

/** Switches the active tenant. Only a workspace this user belongs to is accepted. */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const session = await getSession();
  if (!session.memberships.some((workspace) => workspace.id === workspaceId)) return;

  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

/**
 * The settings screen's form — the tenant's fields, and only those.
 *
 * The name and the timezone need `canManageWorkspace`; their inputs are
 * `disabled` for anyone else, so they arrive empty here anyway — the check is
 * what makes that a rule rather than a rendering detail.
 *
 * "Interfeys tili" used to be handled here too, first and for everybody, which
 * made one form answer to two owners. It is the reader's own setting, it is not
 * a change anybody confirms, and waiting for this button meant the picker could
 * sit on a language the screen was not written in. It saves on change now —
 * `InterfaceLocaleSelect`, straight to `setInterfaceLocaleAction`.
 *
 * No currency either. A tenant-level currency was a setting with one consumer —
 * how revenue reads on the analytics screens — and four ways to be wrong, the
 * worst of which put a `$` after a so'm price. Workspaces keep the column's
 * default and every other amount in the product already carries its own
 * currency: an invoice, a payment, a plan, a Stars balance.
 *
 * `locale` *is* here, and it is the opposite case. It has one reader — the
 * number and date formatting on the analytics screens — and that reader is
 * real; what it did not have was a way to change it once the workspace
 * existed, so a tenant that picked the wrong one at sign-up was stuck with it.
 * A stored value with a live consumer and no control is the same bug as a
 * control with no consumer, seen from the other side.
 *
 * `planKey` is deliberately not reachable from here, and no longer reachable
 * from the endpoint either: it was a writable field on `WorkspaceSerializer`
 * that any editor could `PATCH`, which raised every limit in
 * `apps/billing/services.py` for free. The one door onto a plan is
 * `POST /api/billing/subscription/`, and it is owner-only.
 */
export async function updateWorkspaceAction(formData: FormData): Promise<{ error?: string }> {
  const session = await getSession();
  if (!canManageWorkspace(session.role)) return { error: "Ish maydonini o'zgartirish uchun ruxsat yo'q." };

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const locale = String(formData.get("locale") ?? "").trim();
  if (!name) return { error: "Ish maydoni nomini kiriting." };

  try {
    await workspacesRepository.update(session.workspace.id, {
      name,
      ...(timezone ? { timezone } : {}),
      ...(locale ? { locale } : {}),
    });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("updateWorkspaceAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Mints a shareable invite and hands back the links.
 *
 * Returns rather than redirects: the link is the whole result and the reader
 * stays on the team screen to copy it or push it into Telegram. A failure comes
 * back as a sentence for the same reason — a button that generates nothing and
 * says nothing reads as a broken button.
 */
export async function createInviteLinkAction(
  role: MemberRole,
): Promise<{ link: WorkspaceInviteLink } | { error: string }> {
  const session = await getSession();
  if (!canManageWorkspace(session.role)) {
    return { error: "Taklif havolasini yaratish uchun ruxsat yo'q." };
  }
  try {
    const link = await workspacesRepository.createInviteLink(session.workspace.id, role);
    // The pending-invite list on this screen is read from the server.
    revalidatePath("/settings/team");
    return { link };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("createInviteLinkAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Havola yaratib bo'lmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
}

/**
 * Redeems an invite code — from a button press, never from a page load.
 *
 * The code is single use, so whatever runs this spends it. That has to be an
 * action the reader took: a GET that redeemed was being spent by link
 * prefetches and double renders, and the screen that eventually drew reported
 * the code as invalid after consuming it itself.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/dashboard");

  const result = await joinWorkspaceWithCodeAction({ code });
  if ("error" in result) {
    // Back to the same screen rather than carrying the message in a query.
    // That page reads the invite before it draws, so it already knows whether
    // the code was spent, expired or never real — and one place deciding what
    // to say about an invite is one place that can be wrong about it.
    revalidatePath(`/join/${code}`);
    redirect(`/join/${code}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function inviteMemberAction(formData: FormData): Promise<{ error?: string }> {
  const session = await getSession();
  if (!canManageWorkspace(session.role)) return { error: "A'zo taklif qilish uchun ruxsat yo'q." };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email manzilini kiriting." };
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "editor") as MemberRole;

  /*
   * It used to `return` on each of these instead, which submitted the form,
   * reloaded the panel and changed nothing on it — the reader's only evidence
   * that anything had happened at all. A refusal that produces an unchanged
   * screen is indistinguishable from a bug, so each one now carries a sentence
   * and the form beside it prints it.
   */
  try {
    await workspacesRepository.invite({ workspaceId: session.workspace.id, name, email, role });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("inviteMemberAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Taklif yuborilmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
  revalidatePath("/settings/team");
  return {};
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!canManageWorkspace(session.role)) return;

  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as MemberRole;
  if (!memberId || !role) return;

  // The owner seat is not something a role dropdown may take away.
  const members = await workspacesRepository.listMembers(session.workspace.id);
  const target = members.find((member) => member.id === memberId);
  if (!target || target.role === "owner") return;

  await workspacesRepository.setMemberRole(memberId, role);
  revalidatePath("/settings/team");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!canManageWorkspace(session.role)) return;

  const memberId = String(formData.get("memberId") ?? "");
  const members = await workspacesRepository.listMembers(session.workspace.id);
  const target = members.find((member) => member.id === memberId);
  if (!target || target.role === "owner") return;

  await workspacesRepository.removeMember(memberId);
  revalidatePath("/settings/team");
}
