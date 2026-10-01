import "server-only";
import { apiList, apiRequest } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import type { PaymentConnection, PaymentRecord } from "../types";

export interface ConnectProviderInput {
  workspaceId: string;
  botId: string;
  providerId: string;
  /**
   * Merchant token, or `null` for a provider that runs on the bot's own
   * Telegram token (Telegram Stars). Nothing is stored in that case — the
   * connection is just a switch that is on.
   */
  token?: string | null;
}

/**
 * Payment providers attached to a bot, from `/api/bots/<id>/payments/`.
 *
 * The token is write-only end to end: it is sent once, stored on the backend,
 * and never appears in a response — `PaymentConnection` has no field for it,
 * so no page or action can leak one by accident.
 */
export interface PaymentsRepository {
  list(workspaceId: string, botId: string): Promise<PaymentConnection[]>;
  connect(input: ConnectProviderInput): Promise<PaymentConnection>;
  disconnect(workspaceId: string, botId: string, providerId: string): Promise<void>;
  /** Re-checks a stored connection and updates `lastCheckedAt`. */
  verify(workspaceId: string, botId: string, providerId: string): Promise<PaymentConnection | undefined>;
  /** What the bot has been paid, newest first — the backend caps the page. */
  history(workspaceId: string, botId: string): Promise<PaymentRecord[]>;
}

/** The instant arrives ISO; every screen shows a date, so it is turned here. */
type PaymentRecordDto = Omit<PaymentRecord, "occurredAt"> & { occurredAt: string };
type PaymentConnectionDto = Omit<PaymentConnection, "connectedAt" | "lastCheckedAt"> & {
  connectedAt: string;
  lastCheckedAt: string;
};

/**
 * The connection's instants, as the sheet prints them. "Tekshirilgan" is an
 * age — the reader is asking "is this stale", the same question the webhook
 * panel answers with its own relative stamp — while the connection date is a
 * date. Raw ISO leaked to the screen here once, milliseconds and all, and the
 * row truncated it into "2026-08-24T10:04:29.4824…" (BUG-002).
 */
function toConnection(dto: PaymentConnectionDto): PaymentConnection {
  return {
    ...dto,
    connectedAt: formatInstant(dto.connectedAt),
    lastCheckedAt: formatRelative(dto.lastCheckedAt),
  };
}

class ApiPaymentsRepository implements PaymentsRepository {
  async list(workspaceId: string, botId: string): Promise<PaymentConnection[]> {
    const rows = await apiList<PaymentConnectionDto>(`/api/bots/${botId}/payments/`, { workspaceId });
    return rows.map(toConnection);
  }

  async connect(input: ConnectProviderInput): Promise<PaymentConnection> {
    return toConnection(await apiRequest<PaymentConnectionDto>(`/api/bots/${input.botId}/payments/`, {
      method: "POST",
      workspaceId: input.workspaceId,
      body: {
        providerId: input.providerId,
        token: input.token ?? "",
        // A token-less provider has no TEST/LIVE pair to be in.
        mode: input.token ? (input.token.includes("TEST") ? "test" : "live") : "",
      },
    }));
  }

  async disconnect(workspaceId: string, botId: string, providerId: string): Promise<void> {
    await apiRequest(`/api/bots/${botId}/payments/${providerId}/`, { method: "DELETE", workspaceId });
  }

  async verify(workspaceId: string, botId: string, providerId: string): Promise<PaymentConnection | undefined> {
    const dto = await apiRequest<PaymentConnectionDto | undefined>(`/api/bots/${botId}/payments/${providerId}/`, {
      method: "POST",
      workspaceId,
      body: {},
    });
    return dto && toConnection(dto);
  }

  async history(workspaceId: string, botId: string): Promise<PaymentRecord[]> {
    const rows = await apiList<PaymentRecordDto>(`/api/bots/${botId}/payment-history/`, { workspaceId });
    return rows.map((row) => ({ ...row, occurredAt: formatInstant(row.occurredAt) }));
  }
}

export const paymentsRepository: PaymentsRepository = new ApiPaymentsRepository();
