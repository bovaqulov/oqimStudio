import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionTabsBar } from "@/components/layout/SectionTabsBar";
import { MarketTabs } from "@/features/marketplace/components/MarketTabs";

/**
 * "Mening shablonlarim" was a second sidebar entry for what is the same screen
 * with a different filter. As a segment it costs one row of the market page
 * instead of a permanent line in the navigation — and /market/mine still opens
 * straight to it, because the control reads the URL rather than any state of
 * its own. The label is "Meniki" there: two segments share the width equally,
 * and the full phrase would arrive truncated on a phone.
 */
export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Market" />
      <SectionTabsBar><MarketTabs /></SectionTabsBar>
      {/* 900, the width /dashboard and /bots use. It was 640 — the width of a
          form screen — which on a desktop left the catalogue as a narrow column
          against the left edge while every screen the reader reaches it from is
          half as wide again. */}
      <PageBody maxWidth={900} chrome="tabs">
        {children}
      </PageBody>
    </>
  );
}
