/**
 * What a bot has learned about the people who wrote to it.
 *
 * This is the product's output: a flow that asks three questions is worth
 * exactly as much as the record it leaves behind, which is why the contact
 * carries the answers (`variables`) rather than only the profile Telegram
 * hands over.
 */
export interface Contact {
  id: string;
  botId: string;
  telegramUserId: number;
  chatId: number;
  displayName: string;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  /** Where they arrived from — ads, a campaign, organic. */
  source: string;
  /** Everything the flow's "Ma'lumotni saqlash" blocks (type `tag`) stored, by name. */
  variables: Record<string, string>;
  tags: string[];
  isBlocked: boolean;
  /** The flow that first reached this person. */
  sourceFlowName: string;
  sourceFlowId: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ConversationStep {
  id: string;
  actor: "bot" | "user" | "system";
  text: string;
  nodeId: string;
  at: string;
}

/** One conversation, whole — what the bot asked and what came back. */
export interface Conversation {
  id: string;
  flowId: string;
  flowName: string;
  status: "running" | "waiting" | "sleeping" | "handoff" | "done" | "failed";
  error: string;
  startedAt: string;
  finishedAt: string | null;
  steps: ConversationStep[];
}

export interface ContactFilters {
  q?: string;
  /**
   * Which business, when a workspace holds more than one.
   *
   * Analytics has had this cut since it was written; the contact list, which is
   * where the *people* are, did not — so a clinic's patients and a school's
   * students were one undifferentiated list, and the only way to separate them
   * was to know which bot belonged to which.
   */
  projectId?: string;
  botId?: string;
  flowId?: string;
  tag?: string;
  status?: "active" | "blocked";
  from?: string;
  to?: string;
}

/** How a conversation's state reads on a card. */
export const CONVERSATION_STATUS: Record<Conversation["status"], { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  running: { label: "Ketmoqda", tone: "accent" as never },
  waiting: { label: "Javob kutilmoqda", tone: "warning" },
  sleeping: { label: "Kutish blokida", tone: "neutral" },
  handoff: { label: "Operatorda", tone: "warning" },
  done: { label: "Yakunlandi", tone: "success" },
  failed: { label: "Xato", tone: "danger" },
};
