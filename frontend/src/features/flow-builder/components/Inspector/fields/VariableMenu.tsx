"use client";

import { VARIABLE_GROUPS, tableVariableGroup } from "../../../lib/variables";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";

/**
 * What the picker offers: the person, and nothing about the plumbing.
 *
 * `VARIABLE_GROUPS` has seven groups and five of them are machinery — the chat
 * id, the message id, the Business connection, the Web App payload, the bot's
 * own username. They are real and the runtime substitutes every one of them;
 * what they are not is something an author reaches for while writing a sentence
 * to a customer. Offered in a list that opened over the field, they were five
 * groups of noise around the one group anybody wanted, and most of them belong
 * to modules the flow is not even in.
 *
 * Filtered here rather than removed from `VARIABLE_GROUPS`, because the list is
 * also what `simple/step-meta.ts` reads to put a human name to a placeholder
 * already written, and what the preview resolves. A flow that already says
 * `{{chat.id}}` must keep rendering it — this decides what is *offered*, not
 * what works.
 */
const OFFERED = new Set(["Yig'ilgan javoblar", "Foydalanuvchi"]);

/**
 * The variable picker, opened by the «O'zgaruvchi» button.
 *
 * Each row shows the human name first and the placeholder it writes second, in
 * that order on purpose: the author is looking for "the customer's name", and
 * `{{mijoz_ismi}}` is the machine's spelling of it — worth showing so the
 * result in the textarea is recognisable afterwards, never worth typing.
 */
export function VariableMenu({ query, onSelect }: { query: string; onSelect: (path: string) => void }) {
  const q = query.trim().toLowerCase();
  /*
   * The workspace's own tables, last.
   *
   * They were reachable from nowhere: `{{ tableText("narxlar") }}` is
   * documented on the table's own Integratsiyalar page and on that page alone,
   * which is not a page anybody is on while writing a message to a customer.
   * So a bot could hold four tables and the author writing the sentence that
   * should quote one had no way of knowing they existed, let alone what the
   * function was called.
   *
   * After the two constant groups because they are what a sentence usually
   * needs — the customer's name comes up in every flow, a price list in a few.
   */
  const tables = useFlowEditorStore((state) => state.tables);
  const fromTables = tableVariableGroup(tables);
  const groups = [...VARIABLE_GROUPS.filter((group) => OFFERED.has(group.label)), ...(fromTables ? [fromTables] : [])]
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !q || item.path.toLowerCase().includes(q) || item.label.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      className="absolute top-full left-0 z-20 mt-1 max-h-[220px] w-full overflow-y-auto rounded-md border border-separator bg-overlay p-1 shadow-lg"
      onMouseDown={(event) => event.preventDefault()}
    >
      {groups.length === 0 ? (
        <div className="px-2 py-1.5 text-[11px] max-md:text-[13px] text-neutral-500">Topilmadi</div>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="mb-0.5 last:mb-0">
            <div className="px-2 pt-1 text-[9.5px] max-md:text-[12px] tracking-[.08em] text-neutral-600 uppercase">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => onSelect(item.path)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11.5px] max-md:text-[13px] text-neutral-300 hover:bg-accent-800 hover:text-accent-ink"
              >
                <span className="truncate">{item.label}</span>
                <span className="flex-none text-[10px] max-md:text-[12px] text-neutral-600">{`{{${item.path}}}`}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
