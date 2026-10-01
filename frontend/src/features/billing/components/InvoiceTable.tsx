import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { currencyLabel } from "@/features/analytics/format";
import { formatThousands } from "@/lib/utils/format";
import type { Invoice } from "../types";

/**
 * Invoices, as one list at every width.
 *
 * There used to be two of these — a five-column table from `md` up and a stack
 * of cards below it — which is two layouts to keep true about the same four
 * fields. A phone cannot hold five columns and a desktop does not need them: an
 * invoice is a sum, a date and whether it was paid, and that is one row.
 *
 * Collapsing to one shape also removed the "PDF" control from both. It was a
 * bare `<span>` on the phone (styled as a link, not tappable, no handler) and a
 * hover-tinted icon on the desktop with no handler either — an affordance that
 * promised a download nothing was wired up to deliver. It belongs back here the
 * day there is an endpoint behind it.
 */
export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <Panel>
        <EmptyState icon="receipt" title="Hisob-faktura yo'q" />
      </Panel>
    );
  }

  return (
    <ListGroup>
      {invoices.map((invoice) => (
        <ListRow key={invoice.id}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-body truncate tabular-nums">
              {formatThousands(invoice.amount)} {currencyLabel(invoice.currency)}
            </span>
            <span className="t-footnote t-secondary truncate">
              {invoice.date} · {invoice.id}
            </span>
          </span>
          <Badge tone={invoice.status.tone}>{invoice.status.label}</Badge>
        </ListRow>
      ))}
    </ListGroup>
  );
}
