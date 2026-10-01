"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiRequest } from "@/lib/api/server";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * Installing a template.
 *
 * A copy, not a link: the flow that comes out has no connection back to the
 * template it came from, so a template improving later can never change a bot
 * that is already answering customers.
 *
 * It answers rather than redirects, and it answers on failure too. Every exit
 * here used to be a bare `return` — no permission, no bot, a quota refused by
 * the server — and the sheet closed on all of them with nothing said, which is
 * indistinguishable from an install that worked. The caller shows the words.
 */
export async function installTemplateAction(
  templateId: string,
  botId: string,
): Promise<{ ok: boolean; flowId?: string; message?: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Shablon o'rnatish uchun ruxsat yo'q." };
  if (!templateId) return { ok: false, message: "Shablon tanlanmadi." };
  if (!botId) return { ok: false, message: "Avval bot tanlang." };

  try {
    const flow = await apiRequest<{ id: string }>(`/api/market/templates/${templateId}/install/`, {
      method: "POST",
      workspaceId: workspace.id,
      body: { botId },
    });
    revalidatePath("/market");
    return { ok: true, flowId: flow.id };
  } catch (error) {
    // The server's own sentence where there is one — a plan limit says which
    // limit, and that is the only place the reader can learn it.
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : "Shablonni o'rnatib bo'lmadi — qayta urinib ko'ring.",
    };
  }
}

/**
 * Leaving a review.
 *
 * This screen used to keep the verdict in React state and show «Sharhingiz
 * yuborildi» over it — a comment pushed to a list nobody else would ever see,
 * on an endpoint that had existed all along. Now it posts, and the two answers
 * that matter come back in words: a template this workspace never installed is
 * refused by the server, which is where that rule has to live.
 */
export async function reviewTemplateAction(
  templateId: string,
  rating: number,
  text: string,
): Promise<{ ok: boolean; message?: string }> {
  const { workspace } = await getSession();
  if (!templateId) return { ok: false, message: "Shablon tanlanmadi." };
  if (rating < 1 || rating > 5) return { ok: false, message: "Avval yulduz bilan baho bering." };

  try {
    await apiRequest(`/api/market/templates/${templateId}/review/`, {
      method: "POST",
      workspaceId: workspace.id,
      body: { rating, text },
    });
    revalidatePath("/market");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : "Sharhni yuborib bo'lmadi — qayta urinib ko'ring.",
    };
  }
}
