import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { NewTableForm } from "@/features/tables/components/NewTableForm";
import { getSession } from "@/features/workspace/session";

export const metadata = { title: "Yangi ma'lumot · Oqim Studio" };

/**
 * A new table.
 *
 * The bot picker is only offered when the workspace has more than nothing to
 * pick from, and its default is "every bot" — a table belonging to one bot is
 * the narrower case, and a question with an obvious answer is a question worth
 * not asking.
 */
export default async function NewTablePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { workspace } = await getSession();
  const [bots, { projectId }] = await Promise.all([botsRepository.list(workspace.id), searchParams]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Ma'lumotlar", href: "/tables" }, { label: "Yangi ma'lumot" }]}
        title="Yangi ma'lumot"
        subtitle="Nom, tur va ustunlar"
      />
      <PageBody maxWidth={640}>
        <Panel className="p-4">
          {/* The project travels in the link, because this screen is reached
              from a project's «Resurslar» tab and has no other way to know
              which one — the same shape «Bot qo'shish» already uses. Without it
              a table created from a project is filed under no project and
              disappears from the very list it was created from. */}
          <NewTableForm
            bots={bots.map((bot) => ({ id: bot.id, name: bot.handle }))}
            projectId={projectId ?? null}
          />
        </Panel>
      </PageBody>
    </>
  );
}
