import { daysBetween, isISODate, lastNDays } from "@/lib/utils/date";
import type { AnalyticsQuery } from "./types";

export const DEFAULT_RANGE_DAYS = 14;
/** Longest window the report will build — keeps one runaway request from scanning years. */
export const MAX_RANGE_DAYS = 366;

export function defaultAnalyticsQuery(today = new Date()): AnalyticsQuery {
  const { from, to } = lastNDays(DEFAULT_RANGE_DAYS, today);
  return { projectId: null, botId: null, flowId: null, sourceId: null, channelId: null, from, to };
}

function readParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value && value !== "all" ? value : null;
}

/**
 * Turns request parameters into a valid query. Anything missing, malformed or
 * out of bounds falls back to the default window rather than erroring — a
 * report URL someone pasted with a typo should still open.
 */
export function parseAnalyticsQuery(params: URLSearchParams, today = new Date()): AnalyticsQuery {
  const fallback = defaultAnalyticsQuery(today);
  const from = params.get("from");
  const to = params.get("to");
  const validRange =
    from !== null &&
    to !== null &&
    isISODate(from) &&
    isISODate(to) &&
    daysBetween(from, to) >= 1 &&
    daysBetween(from, to) <= MAX_RANGE_DAYS;

  return {
    projectId: readParam(params, "projectId"),
    botId: readParam(params, "botId"),
    flowId: readParam(params, "flowId"),
    sourceId: readParam(params, "sourceId"),
    channelId: readParam(params, "channelId"),
    from: validRange ? from! : fallback.from,
    to: validRange ? to! : fallback.to,
  };
}

/** The same query as request parameters — what the client hook sends back. */
export function analyticsQueryToParams(query: AnalyticsQuery): Record<string, string> {
  return {
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.botId ? { botId: query.botId } : {}),
    ...(query.flowId ? { flowId: query.flowId } : {}),
    ...(query.sourceId ? { sourceId: query.sourceId } : {}),
    ...(query.channelId ? { channelId: query.channelId } : {}),
    from: query.from,
    to: query.to,
  };
}
