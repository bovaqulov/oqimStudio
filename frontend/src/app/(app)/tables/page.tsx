import Link from "next/link";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { tablesRepository, type Table } from "@/features/tables";
import { projectsRepository } from "@/features/projects/data/projects-repository";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";
import { countOf } from "@/lib/utils/format";

export const metadata = { title: "Ma'lumotlar · Oqim Studio" };

/**
 * The workspace's tables.
 *
 * A table is where the numbers a flow quotes actually live — a price list, a
 * service menu, a queue — so that changing a price is editing a row here rather
 * than opening the flow editor and retyping a message. Two other things read
 * from the same rows: an outside system posting into the table's webhook, and
 * (next) a flow writing its answers back into one.
 *
 * Read here and nothing else. Every write on these screens is behind a button
 * or a form action, which is what `check:effects` is enforcing.
 */

/** A read that answers "could not" rather than throwing — the shape the API keys screen uses. */
async function loadTables(
  workspaceId: string,
): Promise<{ ok: true; value: Table[] } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await tablesRepository.list(workspaceId) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    console.error("TablesPage failed to load tables", error);
    return { ok: false, message: "Ma'lumotlar ro'yxatini o'qib bo'lmadi." };
  }
}

export default async function TablesPage() {
  const { workspace } = await getSession();
  // Together: the table list is the page and the project names are what each
  // row is labelled with, so asking for one and then the other would open the
  // screen in two round trips.
  const [tables, projects] = await Promise.all([
    loadTables(workspace.id),
    projectsRepository.list(workspace.id).catch(() => []),
  ]);
  const rows = tables.ok ? tables.value : [];
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Ma'lumotlar" }]}
        title="Ma'lumotlar"
        subtitle="Oqim o'qiydigan ma'lumotlar — narxlar, xizmatlar, ro'yxatlar"
      />
      <PageBody maxWidth={720}>
        {!tables.ok && (
          <Panel className="mb-4 flex flex-col gap-1.5 p-4">
            <p className="t-body m-0">Ma&apos;lumotlarni ochib bo&apos;lmadi</p>
            <p className="t-footnote t-secondary m-0">{tables.message}</p>
          </Panel>
        )}

        {tables.ok && rows.length === 0 ? (
          <Panel>
            <EmptyState
              icon="table"
              title="Hozircha ma'lumot yo'q"
              description="Narxlar yoki xizmatlar ro'yxatini shu yerda saqlang — oqim matni undan o'qiydi."
            />
            <div className="flex justify-center pb-6">
              <Link
                href="/tables/new"
                className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-2 text-accent-400"
              >
                <Icon name="plus" size={16} /> Yangi ma&apos;lumot
              </Link>
            </div>
          </Panel>
        ) : (
          // The add row is the group's last row rather than a button floating
          // above the list: same place, same height, lined up with the rows.
          <ListGroup inset="icon">
            {rows.map((table) => (
              <TableRowLink key={table.id} table={table} projects={projectNames} />
            ))}
            <Link href="/tables/new" className="oq-row">
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-800 text-accent-400">
                <Icon name="plus" size={17} />
              </span>
              <span className="t-body min-w-0 flex-1 truncate text-accent-400">Yangi ma&apos;lumot</span>
            </Link>
          </ListGroup>
        )}
      </PageBody>
    </>
  );
}

/**
 * One table.
 *
 * The project is on the row, and it is the one thing this list says that the
 * project's own page cannot. Data is reached through a project now, so a table
 * filed under none is a table no other screen links to — it exists, a flow
 * reads it by name, and nothing lists it. Saying so here is what makes it
 * findable, and the settings screen is where it gets a project.
 */
function TableRowLink({ table, projects }: { table: Table; projects: Map<string, string> }) {
  return (
    <Link href={`/tables/${table.id}`} className="oq-row">
      <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
        <Icon name="table" size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-body min-w-0 truncate">{table.name}</span>
        <span className="t-footnote t-tertiary truncate">
          {table.projectId ? (
            (projects.get(table.projectId) ?? "Boshqa loyiha")
          ) : (
            <span className="text-warning-fg">Loyihaga biriktirilmagan</span>
          )}{" "}
          · {countOf(table.columns.length, "ustun")} · {countOf(table.rowCount, "qator")}
        </span>
      </span>
      <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
    </Link>
  );
}
