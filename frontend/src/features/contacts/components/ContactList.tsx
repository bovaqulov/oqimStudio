import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import type { Contact } from "../types";

/**
 * The same people, drawn twice: a table on a desk, a chat list on a phone.
 *
 * Five columns cannot be squeezed into 390px without either shrinking the text
 * below reading size or making the page itself scroll sideways, so below `md`
 * the row becomes what the client this app lives inside would draw — a 44px
 * avatar, the name at headline weight, one secondary line for how to reach
 * them, and a chevron. The columns it drops are all on the contact's own page,
 * one tap away.
 *
 * Both are rendered and one is hidden, because the page around this is a server
 * component reading the list from the API: there is no viewport to branch on
 * before the markup is sent.
 */
export function ContactList({ rows, columns }: { rows: Contact[]; columns: string[] }) {
  return (
    <>
      {/* One card holding rows, not a stack of outlined cards: the hairline
          between two rows is what says they are one list. `inset="icon"` starts
          that hairline at 56px, which against a 44px avatar sitting at 16px is
          its right edge — where Telegram's own chat list starts it. */}
      <div className="oq-group md:hidden" data-inset="icon">
        {rows.map((contact) => {
          const reach =
            contact.phone || contact.variables.mijoz_telefoni || (contact.username ? `@${contact.username}` : "");
          return (
            <Link key={contact.id} href={`/contacts/${contact.id}`} className="oq-row">
              <Avatar name={contact.displayName} size={44} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="t-headline min-w-0 flex-1 truncate">{contact.displayName}</span>
                  {contact.isBlocked && <Badge tone="danger">Bloklangan</Badge>}
                </span>
                <span className="t-footnote t-secondary truncate">
                  {[reach, contact.lastSeenAt].filter(Boolean).join(" · ") || "—"}
                </span>
                {/* The variable columns the reader chose follow them here: the
                    choice lives in the URL, not in the table's markup. */}
                {columns.length > 0 && (
                  <span className="t-footnote t-tertiary truncate">
                    {columns.map((name) => `${name}: ${contact.variables[name] || "—"}`).join(" · ")}
                  </span>
                )}
              </span>
              <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
            </Link>
          );
        })}
      </div>

      <Panel className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full border-collapse text-left" style={{ minWidth: 760 + columns.length * 140 }}>
            <thead>
              {/* Sentence case, not tracked-out uppercase — a column heading is
                  a label, and 10.5px with letter-spacing is a decoration. */}
              <tr className="t-footnote t-secondary border-b border-separator">
                <th className="px-3.5 py-2.5 font-normal">Kontakt</th>
                {columns.map((name) => (
                  <th key={name} className="px-3.5 py-2.5 font-mono font-normal">
                    {name}
                  </th>
                ))}
                <th className="px-3.5 py-2.5 font-normal">Telefon</th>
                <th className="px-3.5 py-2.5 font-normal">Kelgan oqim</th>
                <th className="px-3.5 py-2.5 font-normal">Oxirgi faollik</th>
                <th className="px-3.5 py-2.5 font-normal">Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((contact) => (
                <tr key={contact.id} className="border-b border-separator last:border-0 hover:bg-fill">
                  <td className="px-3.5 py-2.5">
                    <Link href={`/contacts/${contact.id}`} className="block">
                      <span className="t-subhead block font-medium text-text">{contact.displayName}</span>
                      <span className="t-footnote t-tertiary block">
                        {contact.username ? `@${contact.username}` : contact.botId}
                      </span>
                    </Link>
                  </td>
                  {columns.map((name) => (
                    <td key={name} className="t-footnote px-3.5 py-2.5">
                      {contact.variables[name] ?? <span className="t-tertiary">—</span>}
                    </td>
                  ))}
                  <td className="t-footnote px-3.5 py-2.5 tabular-nums">
                    {contact.phone || contact.variables.mijoz_telefoni || "—"}
                  </td>
                  <td className="t-footnote t-secondary px-3.5 py-2.5">{contact.sourceFlowName || "—"}</td>
                  <td className="t-footnote t-secondary px-3.5 py-2.5">{contact.lastSeenAt}</td>
                  <td className="px-3.5 py-2.5">
                    {contact.isBlocked ? <Badge tone="danger">Bloklangan</Badge> : <Badge tone="success">Faol</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
