import { notFound } from "next/navigation";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { projectsRepository } from "@/features/projects/data/projects-repository";
import { DeleteTableButton } from "@/features/tables/components/DeleteTableButton";
import { TableSettingsForm } from "@/features/tables/components/TableSettingsForm";
import { tablesRepository } from "@/features/tables";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { countOf } from "@/lib/utils/format";

/**
 * The table itself: what it is called, where it is filed, and the one
 * irreversible button.
 *
 * The webhook used to be in the middle of this screen, between the rename field
 * and the delete button. It left for «Integratsiyalar» along with the handle,
 * because the two readers are not the same person: this screen is opened by
 * whoever owns the table, that one by whoever is wiring something into it.
 */
export default async function TableSettingsPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const { workspace, role } = await getSession();
  const table = await tablesRepository.getById(workspace.id, tableId);
  if (!table) notFound();

  // Both at once: neither is the page's subject and waiting for one to ask for
  // the other would make the screen open in two round trips instead of one.
  const [bots, projects] = await Promise.all([
    botsRepository.list(workspace.id),
    projectsRepository.list(workspace.id),
  ]);
  const canEdit = canEditContent(role);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <Panel className="p-4">
        <TableSettingsForm
          table={table}
          bots={bots.map((bot) => ({ id: bot.id, name: bot.handle }))}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          canEdit={canEdit}
        />
      </Panel>

      <ListGroup title="Ma'lumot haqida">
        <ListRow label="Qatorlar" value={countOf(table.rowCount)} />
        <ListRow label="Ustunlar" value={countOf(table.columns.length)} />
        <ListRow label="Yaratilgan" value={table.createdAt} />
        <ListRow label="Oxirgi o'zgarish" value={table.updatedAt} />
      </ListGroup>

      {canEdit && (
        <ListGroup footer="Ma'lumot bilan birga undagi hamma qator o'chadi. Bu amalni orqaga qaytarib bo'lmaydi.">
          <DeleteTableButton tableId={table.id} name={table.name} rowCount={table.rowCount} />
        </ListGroup>
      )}
    </div>
  );
}
