import { notFound } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { HandlePanel } from "@/features/tables/components/HandlePanel";
import { WebhookPanel } from "@/features/tables/components/WebhookPanel";
import { tablesRepository } from "@/features/tables";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * How everything that is not this screen reaches the table.
 *
 * Two doors, and they are the two halves of the same question — "how do I get
 * at this data from somewhere else":
 *
 *   * the **handle**, for a flow inside the product. `{{ table("narxlar") }}`
 *     in a message, or a «Ma'lumot o'qish» block, both name the table by this
 *     key and nothing else in the interface prints it.
 *   * the **webhook**, for a system outside it. One URL with the secret inside,
 *     which is why rotating it is the only way to revoke it.
 *
 * Both used to be somewhere else — the handle greyed under the page title, the
 * webhook three sections down Sozlamalar, between a rename field and a delete
 * button. Neither reader was served: somebody renaming a table had to scroll
 * past an integration they were not touching, and somebody wiring one up had
 * to hunt for it on a screen named after something else.
 *
 * Moving a spreadsheet in and out is *not* here, though it is the same shape of
 * job. It lives on «Qatorlar» with the rows it adds, because the person doing
 * it is maintaining prices rather than wiring anything — see `ExcelTransfer`.
 */
export default async function TableIntegrationsPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const { workspace, role } = await getSession();
  const table = await tablesRepository.getById(workspace.id, tableId);
  if (!table) notFound();

  const canEdit = canEditContent(role);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <section className="flex flex-col gap-2">
        <h2 className="t-footnote t-secondary m-0 px-4">Oqimlar uchun kalit</h2>
        <Panel className="p-4">
          <HandlePanel handle={table.handle} firstColumn={table.columns[0]?.key ?? "ustun"} />
        </Panel>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="t-footnote t-secondary m-0 px-4">Webhook</h2>
        <Panel className="p-4">
          <WebhookPanel
            tableId={table.id}
            webhookUrl={table.webhookUrl}
            columns={table.columns}
            canEdit={canEdit}
          />
        </Panel>
      </section>
    </div>
  );
}
