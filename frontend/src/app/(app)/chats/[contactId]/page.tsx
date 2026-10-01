import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { contactsRepository } from "@/features/contacts/data/contacts-repository";
import { ConversationListPane } from "@/features/inbox/components/ConversationListPane";
import { MessageThread } from "@/features/inbox/components/MessageThread";
import { ReplyComposer } from "@/features/inbox/components/ReplyComposer";
import { ThreadScroller } from "@/features/inbox/components/ThreadScroller";
import { inboxRepository } from "@/features/inbox/data/inbox-repository";
import { LiveRefresh } from "@/features/realtime/components/LiveRefresh";
import { getSession } from "@/features/workspace/session";

/**
 * One conversation — beside the list on a desktop, alone on a phone.
 *
 * The composer writes through a `"use server"` action, never on the way in.
 * Opening a chat is a read, and a hover that prefetched this route must not put
 * anything in a customer's phone.
 */
export default async function ChatPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { workspace } = await getSession();
  // The contact first, alone: the thread endpoint 404s a foreign or deleted
  // contact by design, and inside a Promise.all that rejection reached the
  // error boundary before the notFound() below could run — a stale link
  // showed "something broke" instead of the 404 it deserves.
  const contact = await contactsRepository.getById(workspace.id, contactId);
  if (!contact) notFound();
  const [messages, conversations] = await Promise.all([
    inboxRepository.listMessages(workspace.id, contactId),
    inboxRepository.listConversations(workspace.id),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Suhbatlar", href: "/chats" }, { label: contact.displayName }]}
        title={contact.displayName}
        subtitle={[contact.username && `@${contact.username}`, contact.phone].filter(Boolean).join(" · ")}
      />
      <PageBody>
        <div className="flex h-full min-h-[60vh] items-stretch gap-4">
          {/* The list stays on screen while a thread is open — Telegram's own
              arrangement — and the open one is marked. On a phone the thread
              is the page, and the breadcrumb above is the way back. */}
          <div className="hidden min-h-0 w-full flex-col md:flex md:max-w-[400px] md:flex-none">
            <LiveRefresh events={["message.new"]} />
            <ConversationListPane conversations={conversations} query="" activeContactId={contactId} />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[16px] border border-separator bg-surface">
            {messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon="chat-circle"
                  title="Bu suhbatda hali xabar yo'q"
                  description="Yozgan zahoti shu yerda ko'rinadi."
                />
              </div>
            ) : (
              <ThreadScroller stamp={messages[messages.length - 1]?.id ?? ""}>
                <MessageThread messages={messages} timeZone={workspace.timezone} />
              </ThreadScroller>
            )}
            <div className="flex-none border-t border-separator p-3">
              <ReplyComposer contactId={contactId} blocked={contact.isBlocked} />
              <Link href={`/contacts/${contactId}`} className="t-footnote mt-1.5 inline-block px-1 text-accent-400">
                Kontakt kartasi
              </Link>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
