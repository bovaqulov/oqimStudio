import Link from "next/link";
import { DemoDataNotice } from "@/components/layout/DemoDataNotice";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListGroup } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { ChannelStatusList } from "@/features/dashboard/components/ChannelStatusList";
import { FlowBotFilter } from "@/features/dashboard/components/FlowBotFilter";
import { FlowRow } from "@/features/flows/components/FlowRow";
import { FlowRowMenu } from "@/features/flows/components/FlowRowMenu";
import { NewFlowButton } from "@/features/dashboard/components/NewFlowButton";
import { getDashboardOverview } from "@/features/dashboard/data";
import { OnboardingChecklist } from "@/features/onboarding/components/OnboardingChecklist";
import { getOnboardingChecklist } from "@/features/onboarding/get-checklist";
import { getSession } from "@/features/workspace/session";
import { countOf } from "@/lib/utils/format";

/**
 * The home screen: my flows.
 *
 * It used to open with four analytics tiles — Suhbatlar, Yangi kontaktlar,
 * Maqsadli amal, Tushum — a trend chart and a funnel, which made the first
 * screen a report about the bot rather than the bot itself. The owner's own
 * verdict was that analytics does not belong here at all, and the four numbers
 * were the thing standing between them and the flow they came to switch on.
 *
 * None of it is gone from the product: `/analytics` is untouched and is two
 * taps away (the dock's "Yana", then Analitika), which is the right depth for a
 * question somebody asks weekly rather than on arrival. A flow card also still
 * links to its own filtered report through "Statistika" on the bot page.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ botId?: string }>;
}) {
  const { botId } = await searchParams;
  const { workspace } = await getSession();
  const [overview, checklist] = await Promise.all([
    getDashboardOverview(workspace.id, botId),
    getOnboardingChecklist(workspace.id),
  ]);

  return (
    <>
      <PageHeader
        title="Bosh sahifa"
        subtitle={`${workspace.name} · ${countOf(overview.botCount, "bot")} · ${countOf(overview.flowCount, "oqim")}`}
      />
      {/* Capped like every other single-column screen — 900 is the bots list's
          width, and these are the same shape of row. Uncapped, a desktop drew
          a label on the far left and its toggle 1600px away on the right, with
          the reader's eye asked to cross the gap between them. Only the chats
          screen goes full-width, and it earns it with a second pane. */}
      <PageBody maxWidth={900}>
        <div className="flex flex-col gap-6">
          <DemoDataNotice isDemo={workspace.isDemo} />
          <OnboardingChecklist checklist={checklist} />

          {/* ------------------------------- Flows ------------------------------ */}
          <section className="flex flex-col">
            <div className="flex items-baseline gap-2 px-1">
              <h2 className="t-headline m-0 flex-1">Oqimlar</h2>
              {/* The heading beside it already says "Oqimlar", so the noun is
                  elided — the same sentence, not a second format. It counts what
                  is on screen rather than what the workspace holds: a filtered
                  list under a total is two numbers disagreeing in public. */}
              <span className="t-footnote t-tertiary tabular-nums">{countOf(overview.shownFlowCount)}</span>
            </div>

            {overview.flowBots.length > 1 && (
              <div className="px-1 pt-2">
                <FlowBotFilter bots={overview.flowBots} active={botId} />
              </div>
            )}

            {overview.recentFlows.length === 0 ? (
              <Panel className="mt-1">
                {/* Without a bot the card says *why* there is nothing here, so
                    the button under it becomes the answer to a sentence the
                    reader has just read rather than an unexplained "Bot ulash".
                    Since the floating action left this screen, this is also the
                    only way out of an empty home. */}
                <EmptyState
                  icon="flow-arrow"
                  title="Hozircha oqim yo'q"
                  description={
                    overview.quickCreate
                      ? undefined
                      : "Oqim botga tegishli — avval bot ulang, keyin birinchi oqimni shu yerdan yaratasiz."
                  }
                />
                <div className="flex justify-center pb-6">
                  <NewFlowButton target={overview.quickCreate} />
                </div>
              </Panel>
            ) : (
              <>
                {/* Literally the same component the bot page lists flows with,
                    down to the "⋯" beside the switch, so the two can no longer
                    drift apart. Which bot a flow belongs to used to be printed
                    under every name; the filter above answers that once for the
                    whole list instead.

                    The menu is here because this is where the flows are: a
                    reader who can see a row and switch it off had to open the
                    bot, then the module, to rename or delete the same row. Only
                    "Sinash" is missing from it, and only because a test chat
                    needs the graph this list does not read. */}
                <ListGroup inset="icon" className="pt-1">
                  {overview.recentFlows.map((flow) => (
                    <FlowRow key={flow.id} flow={flow} trailing={<FlowRowMenu flow={flow} />} />
                  ))}
                </ListGroup>
                <Link
                  href={overview.quickCreate ? `/bots/${overview.quickCreate.botId}/modules/dms` : "/bots"}
                  className="t-body flex min-h-[44px] items-center px-1 text-accent-400"
                >
                  Barcha oqimlar
                </Link>
              </>
            )}
          </section>

          {/* Draws nothing when the workspace has no bot — the checklist above
              already opens with "Botni ulash". */}
          <ChannelStatusList channels={overview.channels} />
        </div>
      </PageBody>
    </>
  );
}
