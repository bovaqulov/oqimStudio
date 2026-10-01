import type { IconName } from "@/components/ui/Icon";

/**
 * Payment providers a bot can take money through.
 *
 * Telegram issues one provider token per provider through @BotFather
 * (Payments → pick a provider → connect) and every one of them has the same
 * `<merchant-id>:<TEST|LIVE>:<secret>` shape — which is why one pattern serves
 * the whole catalogue and each entry only differs in where the merchant gets
 * it from.
 *
 * Product-level data: adding a provider is an entry here (Open/Closed), and no
 * component branches on a provider id.
 */
/**
 * How a provider is authorised.
 *
 * `provider_token` — a merchant token pasted from the provider's cabinet.
 * `bot_token` — nothing to paste: the provider runs on the bot's own Telegram
 * token (Telegram Stars, where `sendInvoice` takes `currency: "XTR"` and an
 * empty `provider_token`), so the card offers an on/off switch instead of a
 * token field.
 */
export type ProviderAuthKind = "provider_token" | "bot_token";

export interface PaymentProviderDefinition {
  id: string;
  name: string;
  /** Stand-in for the provider logo until brand assets are added. */
  icon: IconName;
  /** Brand colour for the card's mark. */
  accent: string;
  summary: string;
  auth: ProviderAuthKind;
  /** Where the merchant gets the token, in one sentence. Unused for `bot_token`. */
  tokenHint?: string;
  docsUrl: string;
  docsLabel: string;
  tokenExample?: string;
  currencies: string[];
  /** Extra line shown on the card — what the merchant should know before switching it on. */
  note?: string;
}

/** `123456789:TEST:abcdef…` — the shape @BotFather hands out for every provider. */
export const PROVIDER_TOKEN_PATTERN = /^\d{4,}:(TEST|LIVE):[A-Za-z0-9_-]{6,}$/;

export const PAYMENT_PROVIDERS: PaymentProviderDefinition[] = [
  {
    id: "telegram-stars",
    name: "Telegram Stars",
    icon: "star",
    accent: "#f0b429",
    summary: "Telegram ichidagi raqamli valyuta — raqamli tovar va obunalar uchun.",
    auth: "bot_token",
    docsUrl: "https://core.telegram.org/bots/payments-stars",
    docsLabel: "Telegram Stars hujjati",
    currencies: ["XTR"],
    note: "Bot tokeningiz orqali avtomatik ishlaydi, qo'shimcha token kerak emas.",
  },
];

export function getPaymentProvider(id: string): PaymentProviderDefinition | undefined {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === id);
}

/** Ids a merchant may not take: the catalogue's own. */
const RESERVED_IDS = new Set(PAYMENT_PROVIDERS.map((provider) => provider.id));

/** `Click Up` -> `click-up`. The model stores 48 characters, so neither do we. */
export function slugifyProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Whether this is a well-formed id for a connection the merchant named.
 *
 * The guard the catalogue lookup used to be. `connectPaymentProviderAction`
 * refused anything `getPaymentProvider` did not know, which was a real check
 * while the list was four fixed brands and is the wrong check now that a
 * merchant names their own — so the shape is checked instead, and the
 * catalogue's own ids stay reserved so a custom row can never shadow Stars.
 */
export function isCustomProviderId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(id) && !RESERVED_IDS.has(id);
}

/** What the add sheet starts from, and what every named connection looks like. */
const CUSTOM_TOKEN_HINT =
  "@BotFather → /mybots → botni tanlang → Payments → kerakli to'lov tizimini tanlab ulang. Chiqqan provider tokenini shu yerga kiriting — bot tokenini emas.";

/**
 * A definition for a connection the merchant named themselves.
 *
 * The catalogue used to carry four brand rows — Click, Payme, Uzum, Stripe —
 * and that was a catalogue of logos rather than of anything this product
 * integrates with. Telegram integrates with them; @BotFather hands out a token;
 * every one of those tokens has the same shape and is used the same way, which
 * is what the single `PROVIDER_TOKEN_PATTERN` proves. Naming four of the
 * twenty-odd providers @BotFather offers also quietly said the rest were
 * unsupported.
 *
 * So the merchant names the connection and the name *is* the id. A bot can hold
 * as many as it has merchant accounts, which is what the brand rows allowed and
 * a single generic row did not.
 *
 * Telegram Stars stays in the catalogue because it is genuinely different: no
 * merchant account, no token, its own currency, an on/off switch instead of a
 * field.
 */
export function customProvider(id: string, name?: string): PaymentProviderDefinition {
  return {
    id,
    // A stored id round-trips to a readable name: `click-up` -> `Click up`.
    // Nothing stores the name separately, so nothing can disagree with the id.
    name: name ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
    icon: "credit-card",
    accent: "#5b8def",
    summary: "@BotFather orqali olingan provider tokeni bilan ulanadi.",
    auth: "provider_token",
    tokenHint: CUSTOM_TOKEN_HINT,
    docsUrl: "https://core.telegram.org/bots/payments",
    docsLabel: "Telegram Payments hujjati",
    tokenExample: "398062629:TEST:999999999_F91D8F69C042267444B74CC0B3C747757EB0E9",
    currencies: ["UZS", "USD", "EUR", "RUB"],
  };
}

/**
 * The catalogue, plus a row for anything already connected that is not in it.
 *
 * The order is deliberate: what a merchant can connect today comes first, and
 * what they connected yesterday follows it.
 */
export function providersWithConnected(connectedIds: string[]): PaymentProviderDefinition[] {
  const known = new Set(PAYMENT_PROVIDERS.map((provider) => provider.id));
  const custom = [...new Set(connectedIds)].filter((id) => !known.has(id));
  return [...PAYMENT_PROVIDERS, ...custom.map((id) => customProvider(id))];
}
