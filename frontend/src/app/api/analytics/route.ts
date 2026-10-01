import { NextResponse } from "next/server";
import { analyticsRepository } from "@/features/analytics/data/analytics-repository";
import { parseAnalyticsQuery } from "@/features/analytics/query";
import { getSession } from "@/features/workspace/session";

/**
 * The analytics endpoint the interface talks to. The tenant is taken from the
 * session and never from the request, so no client can ask for another
 * workspace's numbers by editing a parameter.
 *
 * This handler is the contract a real backend has to honour: same query
 * parameters in, same `AnalyticsReport` JSON out.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { workspace } = await getSession();
    const query = parseAnalyticsQuery(new URL(request.url).searchParams);
    const report = await analyticsRepository.getReport(workspace.id, query);
    return NextResponse.json(report);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Hisobotni tayyorlab bo'lmadi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
