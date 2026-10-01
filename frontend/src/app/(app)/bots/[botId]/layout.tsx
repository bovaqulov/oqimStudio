import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionTabsBar } from "@/components/layout/SectionTabsBar";
import { BotMenuRows } from "@/features/bots/components/BotMenuRows";
import { BotTabs } from "@/features/bots/components/BotTabs";
import { botsRepository } from "@/features/bots";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

/**
 * Bots live at a top-level route (not nested under /projects/[id]) on
 * purpose: a nested URL would inherit the project layout's own header and
 * tab bar, stacking two full chrome sections on one screen. The project is
 * still shown — as a breadcrumb, not as a URL segment.
 *
 * The breadcrumb rides in the page header rather than on a line of its own:
 * everything above the flow list is chrome, and on a phone the flow list is
 * what the visit was for.
 */
export default async function BotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { workspace } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();
  const project = await projectsRepository.getById(workspace.id, bot.projectId);

  return (
    <>
      <PageHeader
        title={bot.settings.displayName?.trim() || bot.handle}
        /*
         * "Botlar" leads the trail, and it is load-bearing rather than
         * decorative: the phone header derives its back button from the
         * deepest crumb that has an `href`, and a workspace with a single
         * project has its project crumb filtered out — which left the most
         * drilled-into screen in the product with no way back at all.
         */
        breadcrumbs={[
          { label: "Botlar", href: "/bots" },
          { label: project?.name ?? "Loyiha", href: project ? `/projects/${project.id}` : undefined },
          { label: bot.handle },
        ]}
        // Into the header's existing "⋯" rather than beside it: two identical
        // overflow buttons on one row is a coin toss for the reader.
        menuActions={<BotMenuRows handle={bot.handle} />}
      />
      {/* One navigation row, and it is this one — floating over the list on a
          phone, in the document from `md:` up. */}
      <SectionTabsBar>
        <BotTabs botId={botId} />
      </SectionTabsBar>
      {/* Wider than the 1000 it was: the module row, the flow rows and the
          metrics strip all run the full width, and on a desktop that left the
          screen's right half empty while every row inside truncated. */}
      <PageBody maxWidth={1180} chrome="tabs">
        {children}
      </PageBody>
    </>
  );
}
