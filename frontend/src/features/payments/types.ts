import type { StatusLabel } from "@/components/ui/types";

/** Whether the provider token is a sandbox one or takes real money. */
export type PaymentMode = "test" | "live";

/**
 * A provider connection as the browser is allowed to see it.
 *
 * There is deliberately no `token` field: the full token never leaves the
 * server. Everything the UI needs — that it is connected, the tail of the
 * token, when it was last checked — is here.
 */
export interface PaymentConnection {
  providerId: string;
  /**
   * "•••• 4242" — the last four characters only. `null` for a provider that
   * needs no token of its own (Telegram Stars rides the bot token), so the
   * card knows there is nothing to show rather than printing an empty mask.
   */
  tokenMasked: string | null;
  /** Unset for token-less providers — there is no TEST/LIVE pair to be in. */
  mode?: PaymentMode;
  connectedAt: string;
  /** When the token was last verified against the provider. */
  lastCheckedAt: string;
  status: StatusLabel;
  /** Set when the last verification failed — shown on the card. */
  error?: string;
}

/**
 * One payment the bot has already taken.
 *
 * Reconstructed from the analytics event log rather than from a payments
 * table, because a confirmed charge is already written there — which is also
 * why there is no product title, no Telegram charge id and no provider on
 * this record. Nothing stores those yet, and a field that would have to be
 * guessed is worse than a field that is absent.
 */
export interface PaymentRecord {
  id: string;
  /** The payer as the bot knows them, or a stand-in once their contact is gone. */
  contactName: string;
  amount: number;
  currency: string;
  /** "22 avgust 2026" — the repository formats it, in the workspace's own zone. */
  occurredAt: string;
}
