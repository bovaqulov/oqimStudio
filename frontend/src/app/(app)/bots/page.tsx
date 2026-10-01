import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { BotsExplorer } from "@/features/bots/components/BotsExplorer";
import { ReconcileWebhooksButton } from "@/features/bots/components/ReconcileWebhooksButton";
import { getBotGroups } from "@/features/bots/get-bot-groups";
import { canManageWorkspace } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

export default async function BotsPage() {
  const { workspace, role } = await getSession();
  const groups = await getBotGroups(workspace.id);
  const hasBots = groups.some((group) => group.bots.length > 0);

  return (
    <>
      <PageHeader
        // One crumb, like every other top-level screen. "Resurslar" named a
        // level that is not a page and has no link — a breadcrumb whose first
        // step goes nowhere is a trail to somewhere that does not exist.
        breadcrumbs={[{ label: "Botlar" }]}
        title="Botlar"
        subtitle={workspace.name}
        // No "+" in the header: the list ends in "Yangi bot qo'shish", which is
        // the same destination one row below where the reader is already
        // looking. Two buttons for one action only make the reader check
        // whether they differ.
      />
      <PageBody maxWidth={900}>
        <BotsExplorer groups={groups} />
        {/* The repair for "every bot went quiet at once", on the screen where
            somebody notices that. It was written, wired to a working endpoint,
            and rendered by nothing — see `ReconcileWebhooksButton`. Below the
            list rather than in the header: it is a thing to try when the list
            has already disappointed you, not an action the page is about. */}
        {hasBots && canManageWorkspace(role) && <ReconcileWebhooksButton />}
      </PageBody>
    </>
  );
}
