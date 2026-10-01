import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionTabsBar } from "@/components/layout/SectionTabsBar";
import { TableTabs } from "@/features/tables/components/TableTabs";
import { tablesRepository } from "@/features/tables";
import { getSession } from "@/features/workspace/session";

/**
 * One table's four screens, under one header and one tab strip.
 *
 * The name is read here so it stands above every tab rather than being
 * re-stated at the top of each one — the same shape a project and a bot use.
 * The actions below re-read the table for the columns they need; that is one
 * extra request against a cached route and the alternative is passing it down
 * through props the router does not have.
 *
 * The handle used to be the subtitle, greyed under the name. It is a database
 * key printed on every screen of a product whose readers are shop owners, and
 * it answered a question only a flow author asks — so it moved to
 * «Integratsiyalar», beside the webhook URL, where somebody writing
 * `{{ table("narxlar") }}` is already looking. It is *shown*, not deleted:
 * nothing else in the product names that key, and the expression that reads
 * this table cannot be written without it.
 */
export default async function TableLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;
  const { workspace } = await getSession();
  const table = await tablesRepository.getById(workspace.id, tableId);
  if (!table) notFound();

  return (
    <>
      <PageHeader
        title={table.name}
        breadcrumbs={[{ label: "Ma'lumotlar", href: "/tables" }]}
      />
      <SectionTabsBar>
        <TableTabs tableId={table.id} />
      </SectionTabsBar>
      <PageBody maxWidth={900} chrome="tabs">
        {children}
      </PageBody>
    </>
  );
}
