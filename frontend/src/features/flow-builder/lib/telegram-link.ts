export interface MessageLink {
  /** `from_chat_id` for copyMessage — `@username` for public chats, `-100…` for private ones. */
  chatId: string;
  messageId: number;
  /** Forum topic thread, when the link points inside one. */
  threadId?: number;
}

const T_ME = /^(?:https?:\/\/)?(?:www\.)?t\.me\/(.+)$/i;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,}$/;

/**
 * Pulls the chat and message out of a `t.me` message link, the form Telegram
 * puts on the clipboard for "Copy Link":
 *
 *   https://t.me/kanal/123          → @kanal, 123
 *   https://t.me/c/1234567890/123   → -1001234567890, 123   (private)
 *   https://t.me/kanal/12/123       → @kanal, 123           (forum topic 12)
 *
 * Returns null for anything that is not a message link — invite links
 * (`t.me/+abc`, `/joinchat/…`) and bare profile links have no message to copy.
 */
export function parseMessageLink(raw: string): MessageLink | null {
  const match = T_ME.exec(raw.trim());
  if (!match?.[1]) return null;

  const path = match[1].split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const isPrivate = parts[0] === "c";
  const head = isPrivate ? parts[1] : parts[0];
  if (!head) return null;

  const numeric = parts.slice(isPrivate ? 2 : 1).filter((part) => /^\d+$/.test(part));
  const last = numeric[numeric.length - 1];
  if (!last) return null;

  if (isPrivate) {
    // The `/c/` form drops the -100 prefix every private chat id carries.
    if (!/^\d+$/.test(head)) return null;
    return {
      chatId: `-100${head}`,
      messageId: Number(last),
      ...(numeric.length > 1 && numeric[0] ? { threadId: Number(numeric[0]) } : {}),
    };
  }

  if (!USERNAME.test(head)) return null;
  return {
    chatId: `@${head}`,
    messageId: Number(last),
    ...(numeric.length > 1 && numeric[0] ? { threadId: Number(numeric[0]) } : {}),
  };
}

/** Short human label for a parsed link — used on the canvas card and in the preview. */
export function formatMessageLink(link: MessageLink): string {
  return `${link.chatId} · #${link.messageId}`;
}
