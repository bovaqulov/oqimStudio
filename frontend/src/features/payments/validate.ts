import { getPaymentProvider, isCustomProviderId, PROVIDER_TOKEN_PATTERN } from "./providers";
import type { PaymentMode } from "./types";

/**
 * Checks a provider token's shape before it is stored or sent anywhere.
 *
 * Pure and message-first: every failure names what is wrong with *this* token
 * rather than saying "invalid", because the merchant is usually pasting from
 * another browser tab and needs to know which tab they got the wrong string
 * from (bot token vs provider token is the classic mix-up).
 *
 * Returns `null` when the token is well-formed.
 */
export function validateProviderToken(providerId: string, rawToken: string): string | null {
  if (!getPaymentProvider(providerId) && !isCustomProviderId(providerId)) {
    return "To'lov tizimi nomi noto'g'ri — harf va raqamlardan iborat bo'lsin.";
  }

  const token = rawToken.trim();
  if (!token) return "Token bo'sh — provayder kabinetidan nusxa oling.";
  if (/\s/.test(token)) return "Tokenda bo'shliq bor. Nusxa olishda ortiqcha belgi tushib qolgan bo'lishi mumkin.";

  const parts = token.split(":");
  if (parts.length !== 3) {
    return "Token uch qismdan iborat bo'lishi kerak: raqam:TEST yoki LIVE:maxfiy qism.";
  }
  const [merchant, mode] = parts;
  if (!/^\d{4,}$/.test(merchant ?? "")) {
    return "Birinchi qism faqat raqamlardan iborat merchant ID bo'lishi kerak.";
  }
  if (mode !== "TEST" && mode !== "LIVE") {
    // The most common paste error: a bot token's second segment starts with AA.
    return mode?.startsWith("AA")
      ? "Bu bot tokeni ko'rinadi. To'lov uchun @BotFather → Payments bo'limidagi provider tokeni kerak."
      : "Ikkinchi qism TEST yoki LIVE bo'lishi kerak.";
  }
  if (!PROVIDER_TOKEN_PATTERN.test(token)) {
    return "Tokenning maxfiy qismi juda qisqa yoki ruxsat etilmagan belgilar bor.";
  }
  return null;
}

export function tokenMode(token: string): PaymentMode {
  return token.split(":")[1] === "LIVE" ? "live" : "test";
}

/** "•••• 8F69" — the tail is enough to tell two tokens apart, and tells nothing else. */
export function maskProviderToken(token: string): string {
  return `•••• ${token.trim().slice(-4)}`;
}
