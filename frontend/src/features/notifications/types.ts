import type { IconName } from "@/components/ui/Icon";
import type { Tone } from "@/components/ui/types";

/** The kinds the backend raises — mirrors `Notification.Kind`. */
export type NotificationKind = "system" | "handoff" | "bot" | "billing" | "flow";

/**
 * One entry in the notification center. `href` is what makes a notification
 * actionable — an alert that cannot be followed anywhere is just noise, so
 * every entry points at the screen that answers it.
 */
export interface NotificationItem {
  id: string;
  title: string;
  text: string;
  /** Already humanised ("2 soat oldin") — the bell renders it as given. */
  time: string;
  icon: IconName;
  tone: Tone;
  href: string;
  isRead: boolean;
}

/** What each kind looks like. Colour is the only thing the bell adds itself. */
export const TONE_BY_KIND: Record<NotificationKind, Tone> = {
  system: "neutral",
  handoff: "accent",
  bot: "success",
  billing: "warning",
  flow: "accent",
};

/**
 * Which notices this workspace raises at all — `NotificationSettings` in
 * `apps/notifications/models.py`.
 *
 * The workspace's and not the reader's, because the notices are: everything
 * that reaches the bell in this product is written with no addressee, so one
 * member switching «Operator kerak» off would be switching it off for the
 * colleague beside them. A control labelled as personal over a shared row
 * would be a lie in whichever direction it was read.
 */
export interface NotificationSettings {
  /** «Operator kerak» — a flow handed a conversation to a person. */
  handoff: boolean;
  /** «Limit tugayapti» and «limiti to'ldi», with one exception the panel names. */
  usageWarnings: boolean;
}

/** Which switch a row drives. The key the API PATCHes, and nothing else. */
export type NotificationSwitch = keyof NotificationSettings;
