import { formatThousands } from "@/lib/utils/format";
import type { MetricDefinition } from "./types";

/**
 * One metric value, rendered the way its definition says. Money follows the
 * workspace's currency rather than a hardcoded so'm, because a workspace in
 * another country bills in its own.
 */
export function formatMetric(
  value: number,
  format: MetricDefinition["format"],
  currency: string,
  _locale = "uz-UZ",
): string {
  if (format !== "currency") return formatThousands(value);

  // Compact form: a revenue axis in full so'm would be unreadable at a glance.
  // Formatted by hand rather than through `Intl` so the server render and the
  // browser hydration can never disagree on a separator.
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} mln ${currencyLabel(currency)}`;
  }
  return `${formatThousands(value)} ${currencyLabel(currency)}`;
}

export function currencyLabel(currency: string): string {
  switch (currency) {
    case "UZS":
      return "so'm";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "RUB":
      return "₽";
    // Telegram's own currency: an in-app balance, not money in a bank.
    case "XTR":
      return "Stars";
    default:
      return currency;
  }
}

/** "+12%" / "−4%" / "—" when there is no comparable previous window. */
export function formatDelta(deltaPercent: number | null): string {
  if (deltaPercent === null) return "—";
  if (deltaPercent === 0) return "0%";
  return `${deltaPercent > 0 ? "+" : "−"}${Math.abs(deltaPercent)}%`;
}
