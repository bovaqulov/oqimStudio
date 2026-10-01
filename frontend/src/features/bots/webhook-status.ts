import type { BotWebhook, WebhookProbe } from "./types";

/** One of the four facts "Hammasi joyida" is a claim about. */
export interface WebhookCondition {
  label: string;
  /** `null` is "not established" — neither a pass nor a failure. */
  ok: boolean | null;
  detail?: string;
}

/**
 * Everything "the webhook works" is actually made of.
 *
 * The check used to compare two strings and, on a match, say "Hammasi joyida" —
 * while Telegram was holding forty undelivered updates and reporting a read
 * timeout on every one of them. All four have to hold, and when one does not,
 * the screen has to name *that* one: "muammo bor" sends somebody looking
 * through logs for a fact the check already had.
 *
 * Plain module, not part of the panel that draws it: the collapsed status row
 * decides whether to open itself from the same four answers, and a `"use
 * client"` module cannot be asked a question from the server.
 */
export function webhookConditions(webhook: BotWebhook, probe: WebhookProbe | null): WebhookCondition[] {
  const addressed = Boolean(webhook.actualUrl) && webhook.actualUrl === webhook.url;
  return [
    {
      label: "Telegram shu manzilga yuboryapti",
      // Before the first check there is nothing of Telegram's to compare, so
      // the registered flag — which is our own record — stands in and says so.
      ok: webhook.actualUrl ? addressed : webhook.registered ? null : false,
      detail: webhook.actualUrl
        ? addressed
          ? undefined
          : `Telegramdagi manzil: ${webhook.actualUrl}`
        : "Telegramda webhook manzili ko'rinmadi",
    },
    {
      label: "So'nggi yetkazishda xato yo'q",
      ok: !webhook.error,
      detail: webhook.error
        ? `${webhook.error}${webhook.lastErrorAgo ? ` · ${webhook.lastErrorAgo}` : ""}`
        : undefined,
    },
    {
      label: "Navbatda kutayotgan xabar yo'q",
      ok: webhook.pending === 0,
      detail: webhook.pending > 0 ? `${webhook.pending} ta update yetkazilmagan` : undefined,
    },
    {
      label: "Manzil so'rovga javob berdi",
      ok: probe === null || !probe.checked ? null : probe.reachable,
      detail:
        probe === null
          ? "Tekshirish tugmasi bosilmagan"
          : !probe.checked
            ? // Offline mode, or a backend older than this field. Either way the
              // honest report is that nobody dialled — not that nobody answered.
              probe.error || "Manzilga so'rov yuborilmadi"
            : probe.reachable
              ? `HTTP ${probe.status} — manzil javob berdi`
              : probe.error || "Ulanib bo'lmadi",
    },
  ];
}

/** What the four answers add up to, for the one line that stands in for them. */
export function webhookFailures(conditions: WebhookCondition[]): WebhookCondition[] {
  return conditions.filter((condition) => condition.ok === false);
}

/** The ones nobody has established yet — not failures, and not passes either. */
export function webhookUnresolved(conditions: WebhookCondition[]): WebhookCondition[] {
  return conditions.filter((condition) => condition.ok === null);
}

/**
 * What to say after a check, in one sentence.
 *
 * Read from the conditions rather than from the `registered` flag the backend
 * returns: that flag only knows about the address, and three of the four things
 * that can leave a bot silent are not the address.
 *
 * This comment sat at the end of the file with nothing under it — the function
 * it describes had been deleted along with the panel that called it, and the
 * check itself became unreachable from any screen at the same time. Both are
 * back: `BotConnectionPanel` runs the check from Sozlamalar.
 */
export function webhookVerdict(conditions: WebhookCondition[]): string {
  const [worst] = webhookFailures(conditions);
  if (worst) return worst.detail || worst.label;
  return webhookUnresolved(conditions).length > 0
    ? "Hammasi joyida — bittasini tekshirib bo'lmadi."
    : "Hammasi joyida — Telegram xabarlarni shu yerga yuboryapti.";
}
