"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/utils/cn";
import { formatDayLabel } from "@/lib/utils/date";
import { formatMetric } from "../format";
import { METRIC_DEFINITIONS, type AnalyticsPoint, type MetricKey } from "../types";

/** Metrics offered as the bar height. The rest still show up in the tooltip. */
const PLOTTABLE: MetricKey[] = ["conversations", "newContacts", "conversions", "revenue"];

/** Half the tooltip, in pixels — the offset that centres it on the day it describes. */
const TOOLTIP_WIDTH = 188;

/**
 * Daily trend. The bars carry one metric at a time — a chart that plots four
 * units on one axis is a chart nobody can read — and opening a day shows the
 * full row of that day's numbers, which is what the legend below promises.
 */
export function TrendChart({
  series,
  currency,
  locale,
  scopeLabel,
  metric,
  onMetricChange,
}: {
  series: AnalyticsPoint[];
  currency: string;
  locale: string;
  scopeLabel: string;
  metric: MetricKey;
  onMetricChange: (metric: MetricKey) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const definition = METRIC_DEFINITIONS.find((item) => item.key === metric)!;
  const values = series.map((point) => point.metrics[metric]);
  const peak = Math.max(1, ...values);
  const peakIndex = values.indexOf(Math.max(...values));
  const active = hovered === null ? null : series[hovered];

  return (
    <div className="relative min-w-0 rounded-[16px] bg-surface p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="t-headline flex-1">Dinamika</span>
        <span className="t-footnote t-tertiary">{scopeLabel}</span>
      </div>
      {/* Full width and equal shares: four labels sharing a phone's width is
          what stops the last one being clipped to "… Tu". */}
      <div className="mb-3.5">
        <Segmented
          label="Ko'rsatkich"
          grow
          options={PLOTTABLE.map((key) => ({
            value: key,
            label: METRIC_DEFINITIONS.find((item) => item.key === key)!.label,
          }))}
          value={metric}
          onChange={(value) => onMetricChange(value as MetricKey)}
        />
      </div>

      <div
        className="relative flex h-[168px] items-end gap-[3px] max-md:gap-px"
        onMouseLeave={() => setHovered(null)}
      >
        {series.map((point, index) => {
          const value = point.metrics[metric];
          const height = Math.round((value / peak) * 100);
          const isHovered = hovered === index;
          return (
            <button
              key={point.date}
              type="button"
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              // A finger never hovers: without this the day's numbers were
              // unreachable on the device most likely to be reading them.
              onClick={() => setHovered((current) => (current === index ? null : index))}
              aria-label={`${formatDayLabel(point.date, locale)}: ${formatMetric(value, definition.format, currency, locale)}`}
              className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
            >
              <span
                className={cn("w-full rounded-t-[3px] rounded-b-[2px] transition-opacity", isHovered ? "opacity-100" : "opacity-80")}
                style={{
                  height: `${Math.max(2, height)}%`,
                  background:
                    index === peakIndex
                      ? "linear-gradient(180deg, var(--color-accent-300), var(--color-accent-700))"
                      : "linear-gradient(180deg, var(--color-accent-500), var(--color-accent-800))",
                }}
              />
            </button>
          );
        })}

        {active && (
          <div
            className="pointer-events-none absolute bottom-full z-20 mb-2 w-[188px] max-w-full rounded-md border border-neutral-800 bg-neutral-950 p-2.5 shadow-lg"
            style={{
              // Clamped in CSS rather than in percent alone: on a phone the card
              // is narrower than the tooltip's own reach, and a bubble that
              // hangs off the right edge is what makes the page scroll sideways.
              left: `clamp(0px, calc(${((hovered ?? 0) / Math.max(1, series.length - 1)) * 100}% - ${TOOLTIP_WIDTH / 2}px), calc(100% - ${TOOLTIP_WIDTH}px))`,
            }}
          >
            <div className="mb-1.5 text-[11px] font-medium text-neutral-200 max-md:text-[13px]">
              {formatDayLabel(active.date, locale)}
            </div>
            {METRIC_DEFINITIONS.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-[10.5px] leading-[1.6] max-md:text-[12px]">
                <span className={cn("flex-1", item.key === metric ? "text-neutral-200" : "text-neutral-600")}>
                  {item.label}
                </span>
                <span className={item.key === metric ? "text-accent-200" : "text-neutral-400"}>
                  {formatMetric(active.metrics[item.key], item.format, currency, locale)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[9.5px] text-neutral-700 max-md:text-[12px]">
        <span>{series[0] ? formatDayLabel(series[0].date, locale) : ""}</span>
        <span>{series.at(-1) ? formatDayLabel(series.at(-1)!.date, locale) : ""}</span>
      </div>

      {/* Legend: a swatch and a word each. What a metric means belongs in the
          metric picker above, not printed under every chart. */}
      <div className="t-footnote t-tertiary mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-separator pt-2.5">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--color-accent-500)" }}
          />
          {definition.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-accent-300)" }} />
          Eng yuqori
        </span>
      </div>
    </div>
  );
}
