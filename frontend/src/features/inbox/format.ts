/**
 * How a chat row reads.
 *
 * Server-side, like `lib/utils/date`: the browser is handed finished strings, so
 * a clock rendered from an instant can never disagree between the two.
 */

/** "14:32", in the workspace's own zone rather than the server's. */
export function clockAt(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
  } catch {
    // An unknown zone is a stored setting, not a reason for a blank chat.
    return new Intl.DateTimeFormat("uz-UZ", { hour: "2-digit", minute: "2-digit" }).format(at);
  }
}

/** "12 mart", for the divider between one day and the next. */
export function dayAt(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("uz-UZ", { day: "numeric", month: "long", timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("uz-UZ", { day: "numeric", month: "long" }).format(at);
  }
}

/**
 * What a line with no words was.
 *
 * A tap, a payment, a photo: Telegram sends plenty that carries no text, and a
 * chat row that renders those as an empty bubble tells the reader nothing about
 * a conversation that did in fact continue.
 */
const KIND_LABELS: Record<string, string> = {
  callback: "tugma bosildi",
  payment: "to'lov qilindi",
  webapp: "Web App orqali javob",
  join: "kanalga qo'shildi",
  leave: "kanaldan chiqdi",
  join_request: "qo'shilish so'rovi",
  reaction: "reaksiya qoldirdi",
  blocked: "botni bloklandi",
  unblocked: "blokdan chiqarildi",
  invoice: "hisob yuborildi",
  fallback: "menyu yuborildi",
};

export function messageLabel(message: { kind: string; text: string }): string {
  if (message.text.trim()) return message.text;
  return KIND_LABELS[message.kind] ?? "matnsiz xabar";
}
