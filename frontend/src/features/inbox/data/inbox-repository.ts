import "server-only";
import { apiList, apiRequest } from "@/lib/api/server";
import type { ConversationSummary, InboxMessage } from "../types";

/**
 * Suhbatlar, from `/api/inbox/`.
 *
 * The list and one thread are reads; the reply is the only write, and it is a
 * POST for the reason `check:effects` exists — a message sent twice because a
 * hover prefetched the page is a message the customer read twice.
 */
export interface InboxRepository {
  listConversations(
    workspaceId: string,
    filters?: { projectId?: string; botId?: string; q?: string },
  ): Promise<ConversationSummary[]>;
  /** The tail of one conversation, oldest first — a chat is read downwards. */
  listMessages(workspaceId: string, contactId: string): Promise<InboxMessage[]>;
  /** Sends as the bot, signed by the operator, and returns the line it added. */
  sendReply(workspaceId: string, contactId: string, text: string): Promise<InboxMessage>;
}

class ApiInboxRepository implements InboxRepository {
  async listConversations(
    workspaceId: string,
    filters: { projectId?: string; botId?: string; q?: string } = {},
  ): Promise<ConversationSummary[]> {
    return apiList<ConversationSummary>("/api/inbox/conversations/", {
      workspaceId,
      params: { projectId: filters.projectId, botId: filters.botId, q: filters.q },
    });
  }

  async listMessages(workspaceId: string, contactId: string): Promise<InboxMessage[]> {
    return apiList<InboxMessage>(`/api/inbox/conversations/${contactId}/messages/`, { workspaceId });
  }

  async sendReply(workspaceId: string, contactId: string, text: string): Promise<InboxMessage> {
    return apiRequest<InboxMessage>(`/api/inbox/conversations/${contactId}/messages/`, {
      method: "POST",
      workspaceId,
      body: { text },
    });
  }
}

export const inboxRepository: InboxRepository = new ApiInboxRepository();
