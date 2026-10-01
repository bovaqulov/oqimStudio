import { METRIC_DEFINITIONS, type AnalyticsBreakdownRow, type AnalyticsReport } from "./types";

/** Quotes a cell so separators, quotes and newlines inside a label cannot break the file. */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number)[][]): string {
  // The BOM is what makes Excel open a UTF-8 file with o‘zbek letters intact.
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Daily series: one row per day, one column per metric. */
export function seriesToCsv(report: AnalyticsReport): string {
  const header = ["Sana", ...METRIC_DEFINITIONS.map((definition) => definition.label)];
  const rows = report.series.map((point) => [
    point.date,
    ...METRIC_DEFINITIONS.map((definition) => point.metrics[definition.key]),
  ]);
  const totals = ["Jami", ...METRIC_DEFINITIONS.map((definition) => report.totals[definition.key])];
  return toCsv([header, ...rows, totals]);
}

/** A comparison table: one row per flow, bot, channel or source. */
export function breakdownToCsv(rows: AnalyticsBreakdownRow[], dimensionLabel: string): string {
  const header = [
    dimensionLabel,
    ...METRIC_DEFINITIONS.map((definition) => definition.label),
    "Ulush, %",
    "Konversiya, %",
  ];
  const body = rows.map((row) => [
    row.label,
    ...METRIC_DEFINITIONS.map((definition) => row.metrics[definition.key]),
    row.share,
    row.conversionRate,
  ]);
  return toCsv([header, ...body]);
}

/**
 * Hands the browser a file. Kept out of the components so the CSV builders
 * above stay pure and testable, and so a future "email me this report" path
 * can reuse them untouched.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
