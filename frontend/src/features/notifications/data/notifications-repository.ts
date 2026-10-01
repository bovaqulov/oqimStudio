import "server-only";
import { isIconName } from "@/components/ui/icon-names";
import { apiList } from "@/lib/api/server";
import { formatRelative } from "@/lib/utils/date";
import { apiRequest } from "@/lib/api/server";
import type { NotificationItem, NotificationKind, NotificationSettings } from "../types";
import { TONE_BY_KIND } from "../types";

interface NotificationDto {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  icon: string;
  href: string;
  isRead: boolean;
  at: string;
}

/**
 * What the bell shows, from `/api/notifications/`.
 *
 * Read state lives on the row, not in the browser: a notice followed on a
 * laptop is not still unread on a phone.
 */
export const notificationsRepository = {
  async list(workspaceId: string): Promise<NotificationItem[]> {
    const rows = await apiList<NotificationDto>("/api/notifications/", { workspaceId });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      text: row.text,
      time: formatRelative(row.at),
      icon: isIconName(row.icon) ? row.icon : "bell-ringing",
      tone: TONE_BY_KIND[row.kind] ?? "neutral",
      href: row.href || "/dashboard",
      isRead: row.isRead,
    }));
  },

  /**
   * Which notices this workspace raises. A read, and only a read — the backend
   * answers the defaults off an unsaved row rather than creating one, so a
   * settings page that renders three times has still written nothing.
   */
  async getSettings(workspaceId: string): Promise<NotificationSettings> {
    return apiRequest<NotificationSettings>("/api/notification-settings/", { workspaceId });
  },
};
