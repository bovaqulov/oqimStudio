import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { MENU_ROW_CLASS } from "@/components/layout/menu-row";
import { Panel } from "@/components/ui/Panel";
import { billingRepository } from "@/features/billing/data/billing-repository";
import { isOverLimit } from "@/features/billing/types";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { parseColumns, serializeColumns } from "@/features/contacts/columns";
import { ContactFilterForm } from "@/features/contacts/components/ContactFilterForm";
import { ContactList } from "@/features/contacts/components/ContactList";
import { contactsRepository } from "@/features/contacts/data/contacts-repository";
import type { ContactFilters } from "@/features/contacts/types";
import { flowsRepository } from "@/features/flows";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";
import { countOf } from "@/lib/utils/format";

export const metadata = { title: "Kontaktlar · Oqim Studio" };

/**
 * Everyone who has written to a bot, and what the bot learned from them.
 *
 * This is where the product's output lives: a flow that collects a name and a
 * phone number is worth exactly as much as this list is readable. Filters and
 * the chosen variable columns are plain query parameters and the form is a GET
 * — the URL of a filtered list is a link somebody can send to a colleague,
 * which a client-side filter is not.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string): string => (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";

  const filters: ContactFilters = {
    q: read("q"),
    projectId: read("projectId"),
    botId: read("botId"),
    flowId: read("flowId"),
    tag: read("tag"),
    status: (read("status") || undefined) as ContactFilters["status"],
    from: read("from"),
    to: read("to"),
  };
  const columns = parseColumns(read("columns"));

  const { workspace } = await getSession();
  const [{ rows }, bots, flows, projects, variableKeys, usage] = await Promise.all([
    contactsRepository.list(workspace.id, filters),
    botsRepository.list(workspace.id),
    flowsRepository.list(workspace.id),
    projectsRepository.list(workspace.id),
    contactsRepository.listVariableKeys(workspace.id, filters),
    billingRepository.getUsage(workspace.id),
  ]);

  const activeFilters = Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][];
  const filterQuery = new URLSearchParams(activeFilters).toString();
  const exportQuery = new URLSearchParams([
    ...activeFilters,
    ...(columns.length ? ([["columns", serializeColumns(columns)]] as [string, string][]) : []),
  ]).toString();

  // A column chosen before the filters narrowed the list may no longer appear
  // in any visible row; it still belongs in the picker, or there is no way to
  // switch it back off.
  const pickerKeys = [...new Set([...variableKeys, ...columns])];

  // A full contacts limit is not visible anywhere else: the runtime simply
  // stops filing new people, so the list quietly stops growing.
  const contactsLimit = usage.metrics.find((metric) => metric.key === "contacts");
  const limitReached = contactsLimit ? isOverLimit(contactsLimit) : false;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Kontaktlar" }]}
        title="Kontaktlar"
        subtitle="Botlaringizga yozgan odamlar"
        menuActions={
          <a
            href={`/api/contacts/export${exportQuery ? `?${exportQuery}` : ""}`}
            className={MENU_ROW_CLASS}
          >
            <Icon name="download-simple" size={17} className="flex-none text-neutral-500" /> CSV yuklab olish
          </a>
        }
      />

      <PageBody maxWidth={1100}>
        {limitReached && contactsLimit && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[12px] bg-danger-bg px-3.5 py-3">
            <Icon name="warning" size={15} className="mt-0.5 flex-none text-danger-fg" />
            <span className="t-subhead min-w-0 flex-1 text-danger-fg">
              Kontaktlar limiti to&apos;ldi — yangi odamlar saqlanmayapti
            </span>
            <Link href="/billing/usage" className="t-body flex min-h-[44px] flex-none items-center px-2 text-accent-400">
              Limitlar
            </Link>
          </div>
        )}

        <ContactFilterForm
          filters={filters}
          filterEntries={activeFilters}
          columns={columns}
          pickerKeys={pickerKeys}
          projects={projects.map((item) => ({ value: item.id, label: item.name }))}
          bots={bots.map((bot) => ({ value: bot.id, label: bot.handle }))}
          flows={flows.map((flow) => ({ value: flow.id, label: flow.name }))}
        />

        {rows.length === 0 ? (
          <Panel>
            <EmptyState
              icon="address-book"
              title={filterQuery ? "Bu filtrga mos kontakt yo'q" : "Hozircha kontakt yo'q"}
            />
          </Panel>
        ) : (
          <>
            {/* The number needs its noun: "1" on its own says nothing. */}
            <div className="t-footnote t-tertiary mb-2.5 px-1">{countOf(rows.length, "kontakt")}</div>

            <ContactList rows={rows} columns={columns} />

          </>
        )}
      </PageBody>
    </>
  );
}
