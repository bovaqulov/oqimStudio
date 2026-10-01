import type { AnalyticsDimensionOption } from "../types";

/**
 * Acquisition sources a conversation can be attributed to. Telegram carries
 * these as the deep-link payload (`t.me/bot?start=<payload>`), which is how a
 * campaign, an ad or a QR code becomes a filterable dimension.
 *
 * Product-level defaults: a real backend returns whatever payloads the tenant
 * actually uses, through the same `listDimensions` call — no component imports
 * this list directly.
 */
export const TRAFFIC_SOURCES: AnalyticsDimensionOption[] = [
  { id: "telegram-ads", label: "Telegram Ads" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "google", label: "Google / SEO" },
  { id: "youtube", label: "YouTube" },
  { id: "referral", label: "Tavsiya (referral)" },
  { id: "qr-offline", label: "QR / oflayn" },
  { id: "organic", label: "To'g'ridan-to'g'ri" },
];
