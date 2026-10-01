import "server-only";
import { apiRequest } from "@/lib/api/server";
import type { AnalyticsDimensions, AnalyticsQuery, AnalyticsReport } from "../types";

/**
 * The analytics contract, served by `/api/analytics/`.
 *
 * Nothing here knows how the numbers are produced — the backend aggregates its
 * event log and answers the same JSON the screens were written against, which
 * is why this file is a transport and not a calculation.
 *
 * The tenant is not a parameter the backend trusts: it comes from the session
 * on that side too, and the workspace id below only says which of the caller's
 * own workspaces to report on.
 */
export interface AnalyticsRepository {
  listDimensions(workspaceId: string): Promise<AnalyticsDimensions>;
  getReport(workspaceId: string, query: AnalyticsQuery): Promise<AnalyticsReport>;
}

class ApiAnalyticsRepository implements AnalyticsRepository {
  async listDimensions(workspaceId: string): Promise<AnalyticsDimensions> {
    return apiRequest<AnalyticsDimensions>("/api/analytics/dimensions/", { workspaceId });
  }

  async getReport(workspaceId: string, query: AnalyticsQuery): Promise<AnalyticsReport> {
    return apiRequest<AnalyticsReport>("/api/analytics/", {
      workspaceId,
      params: {
        from: query.from,
        to: query.to,
        projectId: query.projectId,
        botId: query.botId,
        flowId: query.flowId,
        sourceId: query.sourceId,
        channelId: query.channelId,
      },
    });
  }
}

export const analyticsRepository: AnalyticsRepository = new ApiAnalyticsRepository();
