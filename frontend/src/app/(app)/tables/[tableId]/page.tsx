import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { RowsBoard } from "@/features/tables/components/RowsBoard";
import { RowsToolbar } from "@/features/tables/components/RowsToolbar";
import { getRefOptions } from "@/features/tables/get-ref-options";
import { tablesRepository } from "@/features/tables";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { countOf } from "@/lib/utils/format";

/**
 * The rows themselves — the screen the table exists for.
 *
 * Paginated by the backend, and the page number lives in the URL rather than in
 * state: a reader who opened row 240, corrected it and pressed back belongs on
 * page 6, and a "load more" button held in memory puts them on page 1.
 *
 * Read only. Adding, correcting and deleting a row are all inside `RowsBoard`,
 * behind a button — see `check:effects` for why that distinction is enforced
 * rather than remembered.
 */
export default async function TableRowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ page?: string; q?: string; sort?: string }>;
}) {
  const { tableId } = await params;
  const { page: rawPage, q, sort } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);

  const { workspace, role } = await getSession();
  const table = await tablesRepository.getById(workspace.id, tableId);
  if (!table) notFound();

  const [{ rows, total, hasMore }, refs] = await Promise.all([
    tablesRepository.listRows(workspace.id, tableId, page, { q, sort }),
    getRefOptions(workspace.id, table),
  ]);

  return (
    <div className="flex flex-col gap-4 pb-4">
      <RowsToolbar tableId={table.id} total={total} />
      <RowsBoard
        tableId={table.id}
        columns={table.columns}
        rows={rows}
        refs={refs}
        sort={sort ?? ""}
        canEdit={canEditContent(role)}
      />

      {(hasMore || page > 1) && (
        <nav className="flex items-center justify-between gap-2 px-1" aria-label="Sahifalar">
          {page > 1 ? (
            <Link
              href={page === 2 ? `/tables/${table.id}` : `/tables/${table.id}?page=${page - 1}`}
              className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-1 text-accent-400"
            >
              <Icon name="caret-right" size={15} className="rotate-180" /> Oldingi
            </Link>
          ) : (
            <span />
          )}
          <span className="t-footnote t-tertiary">
            {page}-sahifa · jami {countOf(total, "qator")}
          </span>
          {hasMore ? (
            <Link
              href={`/tables/${table.id}?page=${page + 1}`}
              className="oq-press t-body flex min-h-[44px] items-center gap-1.5 px-1 text-accent-400"
            >
              Keyingi <Icon name="caret-right" size={15} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
