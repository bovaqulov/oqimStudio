import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup, ListLink, ListRow } from "@/components/ui/List";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { contactsRepository } from "@/features/contacts/data/contacts-repository";
import { CONVERSATION_STATUS } from "@/features/contacts/types";
import { getSession } from "@/features/workspace/session";
import { formatRelative } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";

/**
 * One person, and every word the bot exchanged with them.
 *
 * The transcript is the whole point: somebody at a front desk picking up a
 * conversation needs to see what was asked and what was answered, not a
 * summary of it — and the answers the flow stored are shown next to it, under
 * the names the flow gave them.
 *
 * The facts around it are a grouped list rather than a two-column board of
 * `<dl>` cards. Label left, value right, one row each, at reading size: the
 * card version drew all seven labels at 11.5px against a tracked-out uppercase
 * caption, which is a form of density a phone cannot spend. The two empty
 * states lost their explanations of what *would* be here for the same reason —
 * they were teaching the "Ma'lumotni saqlash" block (type `tag`) on a screen nobody edits
 * flows from.
 */
export default async function ContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { workspace } = await getSession();

  const contact = await contactsRepository.getById(workspace.id, contactId);
  if (!contact) notFound();

  const history = await contactsRepository.getHistory(workspace.id, contactId);
  const phone = contact.phone || contact.variables.mijoz_telefoni || "";
  const variables = Object.entries(contact.variables);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Kontaktlar", href: "/contacts" }, { label: contact.displayName }]}
        title={contact.displayName}
      />

      <PageBody maxWidth={720}>
        <div className="flex flex-col gap-6 pb-4">
          <header className="flex flex-col items-center gap-2 pt-2">
            <Avatar name={contact.displayName} size={72} />
            <h1 className="t-title2 m-0 text-center">{contact.displayName}</h1>
            {contact.username && <p className="t-subhead t-secondary m-0">@{contact.username}</p>}
          </header>

          <ListGroup>
            <ListRow label="Telefon" value={phone || "—"} />
            <ListRow label="Username" value={contact.username ? `@${contact.username}` : "—"} />
            <ListRow label="Telegram ID" value={String(contact.telegramUserId)} />
            {contact.sourceFlowId ? (
              <ListLink
                href={`/flows/${contact.sourceFlowId}`}
                label="Kelgan oqim"
                value={contact.sourceFlowName || "—"}
              />
            ) : (
              <ListRow label="Kelgan oqim" value={contact.sourceFlowName || "—"} />
            )}
            <ListRow label="Manba" value={contact.source || "—"} />
            <ListRow label="Birinchi murojaat" value={contact.firstSeenAt || "—"} />
            <ListRow label="Oxirgi faollik" value={contact.lastSeenAt || "—"} />
            <ListRow
              label="Holat"
              trailing={
                contact.isBlocked ? <Badge tone="danger">Bloklangan</Badge> : <Badge tone="success">Faol</Badge>
              }
            />
          </ListGroup>

          {/* The variable name leads to the list showing that variable as a
              column: what one person answered is usually asked right before
              "and what did everybody answer?". */}
          <ListGroup title="Oqim yiqqan ma'lumot">
            {variables.length === 0 ? (
              <ListRow>
                <span className="t-body t-secondary">Hali ma&apos;lumot yo&apos;q</span>
              </ListRow>
            ) : (
              variables.map(([name, value]) => (
                <ListLink
                  key={name}
                  href={`/contacts?columns=${encodeURIComponent(name)}`}
                  label={name}
                  value={String(value)}
                />
              ))
            )}
          </ListGroup>

          <section className="flex flex-col gap-2">
            <h2 className="t-headline m-0 px-1">Teglar</h2>
            {contact.tags.length === 0 ? (
              <p className="t-subhead t-secondary m-0 px-1">Teg yo&apos;q</p>
            ) : (
              <div className="flex flex-wrap gap-x-2">
                {contact.tags.map((tag) => (
                  // The 44px is the tap target, not the pill — a badge is 22px
                  // tall and a finger is not.
                  <Link
                    key={tag}
                    href={`/contacts?tag=${encodeURIComponent(tag)}`}
                    className="flex min-h-11 items-center px-1"
                  >
                    <Badge tone="accent">{tag}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="t-headline m-0 px-1">Suhbatlar</h2>

            {history.length === 0 ? (
              <Panel>
                <EmptyState icon="chats-circle" title="Hali suhbat bo'lmagan" />
              </Panel>
            ) : (
              history.map((run) => {
                const status = CONVERSATION_STATUS[run.status];
                return (
                  <Panel key={run.id} className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/flows/${run.flowId}`} className="t-headline flex min-h-11 items-center text-text">
                        {run.flowName}
                      </Link>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="flex-1" />
                      <span className="t-footnote t-tertiary">{formatRelative(run.startedAt)}</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {run.steps.map((step) => (
                        <div
                          key={step.id}
                          className={cn(
                            "t-subhead max-w-[88%] whitespace-pre-wrap",
                            step.actor === "user"
                              ? "self-end rounded-[16px] bg-accent-700 px-3 py-2 text-white"
                              : step.actor === "bot"
                                ? "self-start rounded-[16px] bg-neutral-800 px-3 py-2 text-text"
                                : "t-footnote t-tertiary self-center py-1 text-center",
                          )}
                        >
                          {step.text}
                        </div>
                      ))}
                    </div>

                    {run.error && (
                      <p className="t-footnote m-0 flex items-start gap-2 text-warning-fg">
                        <Icon name="warning" size={15} className="mt-px flex-none" />
                        {run.error}
                      </p>
                    )}
                  </Panel>
                );
              })
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
