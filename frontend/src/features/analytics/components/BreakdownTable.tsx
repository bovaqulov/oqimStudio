"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { breakdownToCsv, downloadCsv } from "../csv";
import { formatMetric } from "../format";
import type { AnalyticsReport, BreakdownDimension } from "../types";

const DIMENSIONS: { value: BreakdownDimension; label: string }[] = [
  { value: "flows", label: "Oqimlar" },
  { value: "bots", label: "Botlar" },
  { value: "channels", label: "Kanallar" },
  { value: "sources", label: "Manbalar" },
];

/**
 * Side-by-side comparison. One number on its own says nothing about whether a
 * flow is doing well — the table is where "compared with what" is answered, so
 * every dimension the report carries is one tab away.
 *
 * The one table the phone keeps. Seven columns do not become seven cards, so it
 * scrolls sideways inside its own box, with the row's name pinned to the left
 * edge: a number you have scrolled to is worthless once you cannot see whose it
 * is. The page around it never moves.
 *
 * The dimension picker is the 36px `Segmented`, not the 26px pill row it used
 * to be — four options that had to be side-scrolled on a phone now share the
 * full width, which also removes the scroller that competed with the table's.
 */
export function BreakdownTable({ report, locale }: { report: AnalyticsReport; locale: string }) {
  const [dimension, setDimension] = useState<BreakdownDimension>("flows");
  const rows = report.breakdown[dimension];
  const dimensionLabel = DIMENSIONS.find((item) => item.value === dimension)!.label;

  return (
    <div className="overflow-hidden rounded-[16px] bg-surface shadow-md">
      <div className="flex flex-col gap-3 border-b border-separator p-4">
        <div className="flex items-center gap-2">
          <h3 className="t-headline m-0 min-w-0 flex-1 truncate">Taqqoslash</h3>
          {/* A plain accent button: the screen's one fill belongs to whatever
              acts on the data, not to a copy of it. */}
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `oqim-${dimension}-${report.query.from}-${report.query.to}.csv`,
                breakdownToCsv(rows, dimensionLabel),
              )
            }
            className="oq-press t-subhead flex min-h-[44px] flex-none cursor-pointer items-center gap-1.5 px-2 text-accent-400 disabled:cursor-default disabled:opacity-40"
          >
            <Icon name="download-simple" size={15} /> CSV
          </button>
        </div>
        <Segmented label="Kesim" options={DIMENSIONS} value={dimension} onChange={setDimension} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="chart-bar" title="Bu kesimda ma'lumot yo'q" />
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="t-footnote w-full min-w-[660px] border-collapse">
            <thead>
              <tr className="t-secondary">
                <th className="bg-surface px-4 py-2.5 text-left font-normal max-md:sticky max-md:left-0 max-md:z-10">
                  {dimensionLabel}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">Suhbat</th>
                <th className="px-3 py-2.5 text-right font-normal">Yangi kontakt</th>
                <th className="px-3 py-2.5 text-right font-normal">Maqsadli amal</th>
                <th className="px-3 py-2.5 text-right font-normal">Konversiya</th>
                <th className="px-3 py-2.5 text-right font-normal">Tushum</th>
                <th className="px-4 py-2.5 text-right font-normal">Ulush</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-separator">
                  <td className="t-subhead max-w-[220px] truncate bg-surface px-4 py-2.5 max-md:sticky max-md:left-0 max-md:z-10 max-md:max-w-[136px] max-md:border-r max-md:border-separator">
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="block min-w-0 text-text pointer-coarse:flex pointer-coarse:min-h-[44px] pointer-coarse:items-center"
                      >
                        {/* The ellipsis lives on a child: a flex box does not
                            truncate its own text, and on a coarse pointer this
                            link is one. */}
                        <span className="block w-full truncate">{row.label}</span>
                      </Link>
                    ) : (
                      <span className="block truncate">{row.label}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatMetric(row.metrics.conversations, "count", report.currency, locale)}
                  </td>
                  <td className="t-secondary px-3 py-2.5 text-right tabular-nums">
                    {formatMetric(row.metrics.newContacts, "count", report.currency, locale)}
                  </td>
                  <td className="t-secondary px-3 py-2.5 text-right tabular-nums">
                    {formatMetric(row.metrics.conversions, "count", report.currency, locale)}
                  </td>
                  <td className="t-secondary px-3 py-2.5 text-right tabular-nums">{row.conversionRate}%</td>
                  <td className="t-secondary px-3 py-2.5 text-right tabular-nums">
                    {formatMetric(row.metrics.revenue, "currency", report.currency, locale)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-14 flex-none overflow-hidden rounded-full bg-neutral-800">
                        <span className="block h-full rounded-full bg-accent-600" style={{ width: `${row.share}%` }} />
                      </span>
                      <span className="t-secondary w-9 flex-none tabular-nums">{row.share}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
