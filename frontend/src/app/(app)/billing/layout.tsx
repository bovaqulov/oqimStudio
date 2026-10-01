import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionTabsBar } from "@/components/layout/SectionTabsBar";
import { BillingTabs } from "@/features/billing/components/BillingTabs";
import { getSession } from "@/features/workspace/session";

/**
 * Tariflar and Limitlar are two readings of one subscription, so they are two
 * tabs rather than two sidebar entries. /billing/usage still opens directly on
 * "Limitlar" — the tab bar takes its answer from the URL.
 *
 * The subtitle is the workspace and nothing else: "tarif, hisob-fakturalar va
 * limitlar" listed the tabs that are drawn two lines below it.
 */
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await getSession();

  return (
    <>
      <PageHeader title="To'lov" subtitle={workspace.name} />
      <SectionTabsBar>
        <BillingTabs />
      </SectionTabsBar>
      <PageBody maxWidth={960} chrome="tabs">
        {children}
      </PageBody>
    </>
  );
}
