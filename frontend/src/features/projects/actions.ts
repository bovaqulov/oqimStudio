"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/server";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import type { NewProjectState } from "./action-types";
import { projectsRepository } from "./data/projects-repository";

/** Longest name the card and the breadcrumb can show without turning into an ellipsis. */
const MAX_NAME = 80;

/**
 * Creates a project, or says why it did not.
 *
 * The silent `return` this used to do was the whole bug: a name of spaces
 * passes `required`, so the button did nothing and said nothing, and the only
 * reading available to the person clicking it was that the app was broken.
 */
export async function createProjectAction(
  _previous: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Loyiha nomini kiriting.", field: "name" };
  if (name.length > MAX_NAME) {
    return { error: `Nom juda uzun — ${MAX_NAME} belgidan oshmasin.`, field: "name" };
  }

  const { workspace, user } = await getSession();
  let projectId: string;
  try {
    const project = await projectsRepository.create({
      workspaceId: workspace.id,
      name,
      description,
      createdBy: user.email,
    });
    projectId = project.id;
  } catch (error) {
    return {
      error: error instanceof ApiError ? error.message : "Loyihani yaratib bo'lmadi. Birozdan so'ng urinib ko'ring.",
      ...(error instanceof ApiError && error.field === "name" ? { field: "name" as const } : {}),
    };
  }
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

/**
 * Deletes a project, or says why it stayed.
 *
 * The refusal is the backend's answer rather than a rule repeated here: bots
 * and flows both cascade from a project, and the only place that can count
 * them without a race is the one holding the transaction. What this used to be
 * was a toast saying "move the bots first" on every press, empty folder or
 * not — a sentence that was true often enough to look like a working check.
 */
export async function deleteProjectAction(formData: FormData): Promise<{ error: string } | void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Loyiha topilmadi." };

  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { error: "Loyihani o'chirish uchun tahrirlash huquqi kerak." };

  try {
    await projectsRepository.delete(workspace.id, projectId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("deleteProjectAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Loyihani o'chirib bo'lmadi. Birozdan so'ng urinib ko'ring.",
    };
  }

  revalidatePath("/projects");
  revalidatePath("/", "layout");
  redirect("/projects");
}

/**
 * Renames a project, or rewrites its description.
 *
 * What was here before was a `ToastButton` saying "sozlamalar" — an
 * acknowledgement that the press had been noticed and nothing else. A project
 * created with a typo in its name could not be fixed from the panel at all.
 *
 * Same validation as `createProjectAction`, and deliberately the same
 * sentences: a name of spaces is refused in both places for the same reason, so
 * it should not be refused in two different sets of words.
 */
export async function updateProjectAction(formData: FormData): Promise<{ error?: string; field?: "name" }> {
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!projectId) return { error: "Loyiha topilmadi." };
  if (!name) return { error: "Loyiha nomini kiriting.", field: "name" };
  if (name.length > MAX_NAME) return { error: `Nom juda uzun — ${MAX_NAME} belgidan oshmasin.`, field: "name" };

  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { error: "Loyihani tahrirlash uchun ruxsat yo'q." };

  try {
    await projectsRepository.update(workspace.id, projectId, { name, description });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("updateProjectAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.",
      ...(error instanceof ApiError && error.field === "name" ? { field: "name" as const } : {}),
    };
  }

  // The name stands in the breadcrumb and the sidebar as well as on this
  // screen, and all three are rendered by the layout above it.
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}
