/**
 * The one thing the interface still checks about a bot token: its shape.
 *
 * Who the token belongs to is Telegram's answer, and the backend is what asks
 * — it calls `getMe` when the bot is connected, stores the name and the
 * `@username` it gets back, and registers the webhook. That is why the connect
 * form has a single field and no "bot nomi" input: typing either of them would
 * only create a way to be wrong about your own bot.
 *
 * Checking the shape here is still worth it because it costs nothing and gives
 * the precise message: a pasted token with a stray space is the everyday
 * mistake, and saying so beats a round trip that comes back "invalid".
 */

/** `123456789:AA…` — digits, a colon, then a long opaque part. */
const TOKEN_SHAPE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

/**
 * Checked before anything is sent anywhere.
 *
 * The format comes first and the stray-whitespace hint second, in that order on
 * purpose: "Tokenda bo'shliq bor" is useful advice about a token that is
 * otherwise right, and nonsense about a sentence somebody typed into the field.
 */
export function validateBotToken(token: string): string | null {
  const value = token.trim();
  if (!value) return "Token kiritilishi shart.";

  const compact = value.replace(/\s+/g, "");
  if (!TOKEN_SHAPE.test(compact)) {
    return "Token formati noto'g'ri. @BotFather bergan ko'rinish: 123456789:AAH…";
  }
  if (compact !== value) {
    return "Tokenda bo'shliq bor — nusxa olishda ortiqcha belgi tushgan bo'lishi mumkin.";
  }
  return null;
}
