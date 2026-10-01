"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiRequest } from "@/lib/api/server";
import { canManageWorkspace } from "@/features/workspace/roles";
import { getSession } from "@/features/workspace/session";
import type { NotificationSettings, NotificationSwitch } from "./types";

/**
 * Marking a notice read, on the server.
 *
 * Fire-and-forget from the bell's point of view: the popover has already
 * dimmed the row and is navigating away, and a failed write costs an unread
 * dot, not the click.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const { workspace } = await getSession();
  await apiRequest(`/api/notifications/${id}/read/`, { method: "POST", workspaceId: workspace.id });
}

export async function markAllNotificationsRead(): Promise<void> {
  const { workspace } = await getSession();
  await apiRequest("/api/notifications/read-all/", { method: "POST", workspaceId: workspace.id });
}

/**
 * Flips one notification switch for the whole workspace.
 *
 * Returns rather than throws, in the shape `BotModuleSwitches` uses next door:
 * the panel moves the toggle before the round trip, so a refusal has to arrive
 * as a sentence it can put the switch back with. A switch that snaps back and
 * says nothing reads as a broken switch.
 *
 * The role check is here as well as in the API. Not because the API's can be
 * skipped — it cannot — but because the two answer different questions: this
 * one is why the panel greys the switches out and prints a reason, and the
 * backend's is what actually holds. Both name the same two roles.
 */
export async function setNotificationSwitchAction(
  key: NotificationSwitch,
  enabled: boolean,
): Promise<{ ok: true; settings: NotificationSettings } | { ok: false; message: string }> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) {
    return { ok: false, message: "Bildirishnomalarni faqat ish maydoni egasi yoki admini o'zgartira oladi." };
  }

  try {
    const settings = await apiRequest<NotificationSettings>("/api/notification-settings/", {
      method: "PATCH",
      workspaceId: workspace.id,
      body: { [key]: enabled },
    });
    revalidatePath("/settings");
    return { ok: true, settings };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("setNotificationSwitchAction failed", error);
    return {
      ok: false,
      message:
        error instanceof ApiError ? error.message : "Saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
}
