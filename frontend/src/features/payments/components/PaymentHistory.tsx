import { EmptyState } from "@/components/ui/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/List";
import { currencyLabel } from "@/features/analytics/format";
import { formatThousands } from "@/lib/utils/format";
import type { PaymentRecord } from "../types";

/**
 * What the bot has actually been paid, under the providers that took it.
 *
 * The providers list answers "can this bot take money"; everything below the
 * fold on this screen used to answer nothing at all, which is the one question
 * the person who connected Click actually comes back to ask.
 *
 * The payer leads the row rather than the sum, unlike the invoice list this
 * borrows its shape from: an invoice is identified by its number, a payment by
 * the person who made it. The sum keeps the right-hand column to itself so a
 * column of takings can be read down in one pass — hence `tabular-nums`, which
 * is what keeps those digits in line.
 */
export function PaymentHistory({ payments }: { payments: PaymentRecord[] }) {
  return (
    <ListGroup
      title="To'lovlar tarixi"
      footer={payments.length > 0 ? "Telegram tasdiqlagan so'nggi to'lovlar." : undefined}
    >
      {payments.length === 0 ? (
        // Inside the group rather than in a Panel of its own: an empty history
        // is still the same section, and it keeps its heading instead of
        // leaving the reader with a title over a blank area.
        <EmptyState
          icon="receipt"
          title="Hali to'lov yo'q"
          description="Bot invoice bloki orqali to'lov qabul qilgach, ular shu yerda ko'rinadi."
        />
      ) : (
        payments.map((payment) => (
          <ListRow key={payment.id}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-body truncate">{payment.contactName}</span>
              <span className="t-footnote t-secondary truncate">{payment.occurredAt}</span>
            </span>
            <span className="t-body flex-none tabular-nums">
              {formatThousands(payment.amount)} {currencyLabel(payment.currency)}
            </span>
          </ListRow>
        ))
      )}
    </ListGroup>
  );
}
