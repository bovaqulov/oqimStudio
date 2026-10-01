/** Which way a message went: `in` from the customer, `out` from the bot or an operator. */
export type MessageDirection = "in" | "out";

/**
 * One row of the chat list.
 *
 * `contactId` and not a conversation id: a conversation *is* a contact — one
 * per Telegram user per bot — so there is no second identifier to keep in step.
 * See `apps/inbox/models.py`, which says the same thing from the other side.
 */
export interface ConversationSummary {
  contactId: string;
  name: string;
  username: string;
  botId: string;
  /** `@handle` — a bot has no other name in this product. */
  botHandle: string;
  chatType: string;
  /** Telegram refuses every send to this person until they unblock the bot. */
  isBlocked: boolean;
  lastMessage: {
    text: string;
    /** The event kind for an incoming line, the block type for an outgoing one. */
    kind: string;
    direction: MessageDirection;
    createdAt: string;
  } | null;
}

export interface InboxMessage {
  id: string;
  direction: MessageDirection;
  kind: string;
  text: string;
  /** `null` for everything the runtime sent — the interface draws the two apart. */
  operatorName: string | null;
  createdAt: string;
}
