/**
 * The analytics contract. These types are the shape the UI is written
 * against — a real backend implements the same JSON and the components do not
 * change. Nothing here knows how the numbers are produced.
 */

/** Every measure the product reports on. Adding one is an entry here plus a label below. */
export type MetricKey =
  | "conversations"
  | "newContacts"
  | "messages"
  | "clicks"
  | "handoffs"
  | "conversions"
  | "revenue";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  /** How the raw number is rendered: a count, a money amount, or a share. */
  format: "count" | "currency";
  /** Short help text shown in the chart legend and the CSV header. */
  hint: string;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Suhbat — bitta ishga tushgan oqim, ya'ni bitta suhbat; bir mijoz kunda
  // ikki marta yozsa, ikkita suhbat. Uniq odamlar soni emas — voronka aynan
  // shuni alohida sanaydi.
  { key: "conversations", label: "Suhbatlar", format: "count", hint: "Boshlangan suhbatlar (oqimga kirishlar) soni" },
  { key: "newContacts", label: "Yangi kontaktlar", format: "count", hint: "Birinchi marta yozgan foydalanuvchilar" },
  { key: "messages", label: "Yuborilgan xabar", format: "count", hint: "Bot yuborgan xabarlar soni" },
  { key: "clicks", label: "Tugma bosilishi", format: "count", hint: "Inline va reply tugmalar bosilishi" },
  { key: "handoffs", label: "Operatorga o'tdi", format: "count", hint: "Jonli operatorga uzatilgan suhbatlar" },
  { key: "conversions", label: "Maqsadli amal", format: "count", hint: "Buyurtma, ariza yoki to'lov bilan yakunlangan" },
  { key: "revenue", label: "Tushum", format: "currency", hint: "Telegram Payments orqali qabul qilingan to'lovlar" },
];

export type MetricTotals = Record<MetricKey, number>;

/** One selectable value in a filter dropdown. */
export interface AnalyticsDimensionOption {
  id: string;
  label: string;
  /** Set for bots and flows — lets the UI narrow child dropdowns without another request. */
  parentId?: string;
}

/**
 * Everything the filter bar can offer, derived from the workspace's real
 * projects, bots, flows and traffic sources.
 */
export interface AnalyticsDimensions {
  projects: AnalyticsDimensionOption[];
  bots: AnalyticsDimensionOption[];
  flows: AnalyticsDimensionOption[];
  /** Acquisition sources — ads, campaigns and organic entries. */
  sources: AnalyticsDimensionOption[];
  /** Telegram surfaces a flow can run on (bot chat, group, channel, business, mini-app). */
  channels: AnalyticsDimensionOption[];
}

/** A report request. `null` means "not narrowed by this dimension". */
export interface AnalyticsQuery {
  projectId: string | null;
  botId: string | null;
  flowId: string | null;
  sourceId: string | null;
  channelId: string | null;
  /** Inclusive ISO `YYYY-MM-DD` bounds. */
  from: string;
  to: string;
}

export interface AnalyticsPoint {
  date: string;
  metrics: MetricTotals;
}

export interface AnalyticsSummaryEntry {
  key: MetricKey;
  label: string;
  value: number;
  format: MetricDefinition["format"];
  /** Same metric over the preceding window of equal length. */
  previousValue: number;
  /** Percent change against `previousValue`; `null` when there is nothing to compare with. */
  deltaPercent: number | null;
}

/**
 * One step of the funnel — a number of *people*, not of events.
 *
 * The steps nest: each one counts the contacts from the step above it who also
 * did this, so a step can never be wider than the one before it and every
 * percentage is a share of the same first step. That is the difference from
 * the summary tiles above the chart, which count events — flow runs, taps,
 * payments — and cannot be stacked into a funnel because no two of them count
 * the same thing.
 */
export interface AnalyticsFunnelStep {
  key: string;
  label: string;
  /** Contacts who reached this step. */
  value: number;
  /** Share of the first step, 0–100. Descending by construction. */
  percent: number;
}

export type BreakdownDimension = "flows" | "bots" | "channels" | "sources";

export interface AnalyticsBreakdownRow {
  id: string;
  label: string;
  /** Where the row's subject lives in the app, when it has a page of its own. */
  href?: string;
  metrics: MetricTotals;
  /** This row's share of the report's conversations, 0–100. */
  share: number;
  /** conversions / conversations, 0–100. */
  conversionRate: number;
}

export interface AnalyticsReport {
  query: AnalyticsQuery;
  /** Human-readable description of what was measured, e.g. "Barcha oqimlar · 14 kun". */
  scopeLabel: string;
  totals: MetricTotals;
  summary: AnalyticsSummaryEntry[];
  series: AnalyticsPoint[];
  funnel: AnalyticsFunnelStep[];
  breakdown: Record<BreakdownDimension, AnalyticsBreakdownRow[]>;
  /** Currency the `revenue` metric is expressed in, from the workspace. */
  currency: string;
}
