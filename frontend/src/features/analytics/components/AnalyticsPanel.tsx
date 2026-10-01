"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { useResource } from "@/lib/api/useResource";
import { cn } from "@/lib/utils/cn";
import { downloadCsv, seriesToCsv } from "../csv";
import { formatDelta, formatMetric } from "../format";
import { analyticsQueryToParams } from "../query";
import type { AnalyticsDimensions, AnalyticsQuery, AnalyticsReport, AnalyticsSummaryEntry, MetricKey } from "../types";
import { AnalyticsFilterBar, type AnalyticsDimensionKey } from "./AnalyticsFilterBar";
import { BreakdownTable } from "./BreakdownTable";
import { FunnelChart } from "./FunnelChart";
import { TrendChart } from "./TrendChart";

/**
 * The four numbers somebody opens this screen to read: how many people talked to
 * the bot, how many of them were new, how many did the thing, and what it
 * earned. The other three answer "why" once one of these moves, which is a
 * second question — so they sit behind a disclosure instead of splitting the
 * card row into an awkward six-plus-one.
 */
const PRIMARY_SUMMARY: MetricKey[] = ["conversations", "newContacts", "conversions", "revenue"];
const SECONDARY_SUMMARY: MetricKey[] = ["messages", "clicks", "handoffs"];

export interface AnalyticsPanelProps {
  dimensions: AnalyticsDimensions;
  initialQuery: AnalyticsQuery;
  /** Rendered on the server so the first paint carries real numbers, not a spinner. */
  initialReport: AnalyticsReport;
  locale: string;
  /** `compact` is the dashboard's summary; `full` adds the comparison table. */
  variant?: "full" | "compact";
  /**
   * Writes the chosen filters back into the address bar. On the analytics screen
   * a report is a link somebody sends a colleague; on the dashboard the address
   * is just `/dashboard` and should stay that way.
   */
  syncUrl?: boolean;
  /**
   * Dimensions whose control is not worth drawing. A workspace with one project
   * has a "which project?" filter with a single answer; the query parameter it
   * writes keeps working, so a saved `?projectId=` link still narrows the
   * report and the control returns the moment a second project exists.
   */
  hiddenFilters?: AnalyticsDimensionKey[];
  /** What to offer when the workspace has no flows at all — normally a "create a flow" button. */
  emptyAction?: ReactNode;
}

function SummaryCard({
  entry,
  currency,
  locale,
}: {
  entry: AnalyticsSummaryEntry;
  currency: string;
  locale: string;
}) {
  return (
    <Panel className="flex flex-col gap-0.5 px-4 py-3.5">
      <span className="t-footnote t-secondary">{entry.label}</span>
      {/* 34/700. The audit found four numbers at 26px on a page whose labels
          were 13px — a two-step gap that reads as one size, which is why the
          screen had no hierarchy to speak of. */}
      <span className="t-large-title md:text-[26px] md:leading-[32px]">
        {formatMetric(entry.value, entry.format, currency, locale)}
      </span>
      {/* A delta that does not exist is not drawn. The row of grey em-dashes
          under every card said nothing and cost a line each. */}
      {entry.deltaPercent !== null && (
        <span
          className={cn("t-footnote", entry.deltaPercent >= 0 ? "text-success-fg" : "text-danger-fg")}
        >
          {formatDelta(entry.deltaPercent)}
        </span>
      )}
    </Panel>
  );
}

/**
 * The analytics surface, shared by the dashboard and the analytics screen.
 * Filters live in one place, the report comes from one endpoint, and the three
 * states every data view owes the reader — loading, error, empty — are handled
 * here rather than by each page.
 */
export function AnalyticsPanel({
  dimensions,
  initialQuery,
  initialReport,
  locale,
  variant = "full",
  syncUrl = false,
  hiddenFilters,
  emptyAction,
}: AnalyticsPanelProps) {
  const [query, setQuery] = useState<AnalyticsQuery>(initialQuery);
  const [metric, setMetric] = useState<MetricKey>("conversations");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data, loading, error, reload } = useResource<AnalyticsReport>(
    "/api/analytics",
    analyticsQueryToParams(query),
    { initialData: initialReport },
  );

  const report = data ?? initialReport;
  const byKey = (keys: MetricKey[]) =>
    keys.flatMap((key) => report.summary.filter((entry) => entry.key === key));
  const primary = byKey(PRIMARY_SUMMARY);
  const secondary = variant === "compact" ? [] : byKey(SECONDARY_SUMMARY);
  // Two different kinds of nothing: a workspace with no flows yet, and a
  // window in which the flows it does have saw no traffic.
  const hasFlows = dimensions.flows.length > 0;
  const hasTraffic = report.totals.conversations > 0;

  function applyQuery(next: AnalyticsQuery) {
    setQuery(next);
    // The native History API rather than the router: the report the filters
    // describe is already being fetched by the hook below, and a push through
    // the router would re-run the server render to produce the same numbers.
    if (!syncUrl) return;
    const params = new URLSearchParams(analyticsQueryToParams(next));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div>
      <div className={cn(variant === "compact" && "max-md:hidden")}>
        <AnalyticsFilterBar
          dimensions={dimensions}
          query={query}
          onChange={applyQuery}
          onReset={() => applyQuery(initialQuery)}
          hidden={hiddenFilters}
        />
      </div>

      {error && (
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-[12px] bg-danger-bg px-3.5 py-3">
          <Icon name="warning" size={17} className="flex-none text-danger-fg" />
          <span className="t-subhead min-w-0 flex-1 text-danger-fg">Hisobotni yuklab bo&apos;lmadi</span>
          <button
            type="button"
            onClick={reload}
            className="oq-press t-subhead min-h-[44px] flex-none cursor-pointer px-2 text-accent-400"
          >
            Qayta urinish
          </button>
        </div>
      )}

      {!hasFlows ? (
        <Panel>
          <EmptyState
            icon="chart-bar"
            title="Hozircha ma'lumot yo'q"
          />
          {emptyAction && <div className="flex justify-center pb-6">{emptyAction}</div>}
        </Panel>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="mb-3.5 grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(148px,1fr))]">
            {primary.map((entry) => (
              <SummaryCard key={entry.key} entry={entry} currency={report.currency} locale={locale} />
            ))}
          </div>

          {secondary.length > 0 && (
            <div className="mb-3.5">
              <button
                type="button"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((value) => !value)}
                className="oq-press t-subhead flex min-h-[44px] cursor-pointer items-center gap-1.5 px-1 text-neutral-500"
              >
                <Icon name={detailsOpen ? "caret-up" : "caret-down"} size={15} />
                Batafsil ko&apos;rsatkichlar
              </button>
              {detailsOpen && (
                <div className="mt-2.5 grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(148px,1fr))]">
                  {secondary.map((entry) => (
                    <SummaryCard key={entry.key} entry={entry} currency={report.currency} locale={locale} />
                  ))}
                </div>
              )}
            </div>
          )}

          {!hasTraffic && (
            <p className="t-footnote t-tertiary mb-3.5 px-1">Bu davrda suhbat bo&apos;lmagan.</p>
          )}

          <div
            className={cn(
              "mb-3.5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]",
              variant === "compact" && "max-md:hidden",
            )}
          >
            <TrendChart
              series={report.series}
              currency={report.currency}
              locale={locale}
              scopeLabel={report.scopeLabel}
              metric={metric}
              onMetricChange={setMetric}
            />
            <FunnelChart steps={report.funnel} />
          </div>

          {variant === "compact" && (
            /* A plain link, not a full-width outlined button: it goes to
               another screen, it is not the thing to do on this one. */
            <Link
              href="/analytics"
              className="t-body mb-3.5 flex min-h-[44px] items-center gap-1.5 px-1 text-accent-400 md:hidden"
            >
              Batafsil analitika <Icon name="caret-right" size={15} />
            </Link>
          )}

          {variant === "full" && (
            <>
              {/* Same shape as the one on the breakdown card below it — two
                  exports on one screen drawn two different ways read as two
                  different features. */}
              <div className="mb-3.5 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(`oqim-analitika-${report.query.from}-${report.query.to}.csv`, seriesToCsv(report))
                  }
                  className="oq-press t-subhead flex min-h-[44px] cursor-pointer items-center gap-1.5 px-2 text-accent-400"
                >
                  <Icon name="download-simple" size={15} /> Kunlik CSV
                </button>
              </div>
              <BreakdownTable report={report} locale={locale} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
