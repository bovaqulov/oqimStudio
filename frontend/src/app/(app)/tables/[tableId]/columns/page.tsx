import { notFound } from "next/navigation";
import { ListGroup, ListRow } from "@/components/ui/List";
import { ColumnsEditor } from "@/features/tables/components/ColumnsEditor";
import { getRefOptions } from "@/features/tables/get-ref-options";
import { tablesRepository } from "@/features/tables";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * What the store is made of.
 *
 * Its own screen rather than a panel above the rows: the columns are decided
 * once and then left alone, while the rows are edited every week, and putting
 * a "delete this column" control above a grid somebody is typing into is asking
 * for the wrong click.
 *
 * A `kv` store has nothing to decide. Its pair *is* the kind — the backend
 * replaces whatever a PATCH sends with it — so the editor is not drawn at all
 * rather than drawn and refused on save: an editable field whose Save button
 * silently undoes the edit is worse than no field.
 */
export default async function TableColumnsPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const { workspace, role } = await getSession();
  const table = await tablesRepository.getById(workspace.id, tableId);
  if (!table) notFound();

  if (table.kind === "kv") {
    return (
      <div className="flex flex-col gap-3 pb-4">
        <p className="t-footnote t-secondary m-0 max-w-[52ch] px-1 leading-[18px]">
          Bu — «kalit = qiymat» ma&apos;lumoti. Uning ikkita ustuni turining o&apos;zi, shuning uchun
          ular o&apos;zgarmaydi: har bir kalitga bitta qiymat to&apos;g&apos;ri keladi va kalit
          takrorlanmaydi.
        </p>
        <ListGroup>
          {table.columns.map((column) => (
            <ListRow key={column.key} label={column.label} value={column.key} />
          ))}
        </ListGroup>
      </div>
    );
  }

  // Only the editor needs these, and only it can point a column at another
  // table — a `kv` store returned above without paying for the read.
  const refs = await getRefOptions(workspace.id, table);

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/*
       * This used to say the flow's name «shundan o'zi olinadi» — is taken from
       * the heading — full stop, and a reader who renamed «Nomi» to «FIO» then
       * found «Integratsiyalar» still saying `{{ qator.nomi }}` and the webhook
       * sample still saying `"nomi"`. The key not moving is the correct
       * behaviour and stays: every stored row is filed under it, and every flow
       * and every integration already written against the table names it. What
       * was wrong was the sentence promising the opposite, so the sentence says
       * when the key is taken — once, at the start — and each column now prints
       * the key it actually has, beside the heading it does not follow.
       */}
      <p className="t-footnote t-secondary m-0 max-w-[52ch] px-1 leading-[18px]">
        Sarlavha — jadvalning tepasida ko&apos;rinadigan nom, uni istagan payt o&apos;zgartirsa
        bo&apos;ladi. Oqim va webhook ishlatadigan kalit esa ustun birinchi marta saqlanganda
        sarlavhadan olinadi va shundan keyin o&apos;zgarmaydi — har bir ustunning kaliti o&apos;z
        yonida turibdi. Tur qiymat qanday saqlanishini belgilaydi: son ustuniga matn yozib
        bo&apos;lmaydi.
      </p>
      <ColumnsEditor
        tableId={table.id}
        columns={table.columns}
        refs={refs}
        ownHandle={table.handle}
        canEdit={canEditContent(role)}
      />
    </div>
  );
}
