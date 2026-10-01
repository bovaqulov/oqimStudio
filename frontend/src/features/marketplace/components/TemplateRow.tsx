"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { currencyLabel } from "@/features/analytics/format";
import { formatThousands } from "@/lib/utils/format";
import type { MarketplaceTemplate } from "../data";

/**
 * One template, as a row.
 *
 * It was a 272px card carrying the name, the category, the author, a two-line
 * description, a star rating, a review count, an install count, a price and a
 * "Ko'rib chiqish" button — nine things, of which the reader uses two to
 * decide whether to open it. The description, the counts and the category are
 * all on the preview that opening it leads to, so the row keeps the name, the
 * rating, the author and the price, and the whole row is the button.
 */
export function TemplateRow({
  template,
  onPreview,
}: {
  template: MarketplaceTemplate;
  /** Opens the preview — installing without seeing what lands in the workspace is the thing to avoid. */
  onPreview: (template: MarketplaceTemplate) => void;
}) {
  return (
    <button type="button" onClick={() => onPreview(template)} className="oq-row cursor-pointer">
      <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
        <Icon name={template.icon} size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-headline truncate">{template.name}</span>
        <span className="t-footnote t-secondary flex min-w-0 items-center gap-1">
          {template.reviews.length > 0 && (
            <>
              <Icon name="star" size={12} weight="fill" className="flex-none text-warning-fg" />
              {template.rating.toFixed(1)}
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">{template.author}</span>
          {/* Said on the row and not only inside the sheet: the rating and the
              author beside it are what a reader picks a template by, and both
              are invented for a seeded row. */}
          {template.isDemo && <Badge tone="warning">Namuna</Badge>}
        </span>
      </span>
      <span className="t-subhead t-secondary flex-none">
        {template.price === 0 ? "Bepul" : `${formatThousands(template.price)} ${currencyLabel(template.currency)}`}
      </span>
      <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
    </button>
  );
}
