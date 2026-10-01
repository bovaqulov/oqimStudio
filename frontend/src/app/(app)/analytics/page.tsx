import { DemoDataNotice } from "@/components/layout/DemoDataNotice";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { AnalyticsPanel } from "@/features/analytics/components/AnalyticsPanel";
import { analyticsRepository } from "@/features/analytics/data/analytics-repository";
import { parseAnalyticsQuery } from "@/features/analytics/query";
import { NewFlowButton } from "@/features/dashboard/components/NewFlowButton";
import { getDashboardOverview } from "@/features/dashboard/data";
import { getSession } from "@/features/workspace/session";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await getSession();
  // A flow card's "Statistika" link carries `?flowId=`, and a filtered report
  // someone shares is a URL. Reading the defaults instead threw both away —
  // the page opened on "Barcha oqimlar" whatever the link said.
  const params = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, Array.isArray(value) ? (value[0] ?? "") : value] as [string, string]],
    ),
  );
  const query = parseAnalyticsQuery(params);
  const [dimensions, report, overview] = await Promise.all([
    analyticsRepository.listDimensions(workspace.id),
    analyticsRepository.getReport(workspace.id, query),
    getDashboardOverview(workspace.id),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Analitika" }]} title="Analitika" subtitle={`${workspace.name} · oqim, kanal va manba kesimida`} />
      <PageBody maxWidth={1040}>
        <DemoDataNotice isDemo={workspace.isDemo} />
        <AnalyticsPanel
          dimensions={dimensions}
          initialQuery={query}
          initialReport={report}
          locale={workspace.locale}
          syncUrl
          emptyAction={<NewFlowButton target={overview.quickCreate} />}
        />
      </PageBody>
    </>
  );
}
