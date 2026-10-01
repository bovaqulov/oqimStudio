import { PageBody } from "@/components/layout/PageBody";
import { LiveRefresh } from "@/features/realtime/components/LiveRefresh";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConversationListPane } from "@/features/inbox/components/ConversationListPane";
import { botsRepository } from "@/features/bots/data/bots-repository";
import { inboxRepository } from "@/features/inbox/data/inbox-repository";
import { projectsRepository } from "@/features/projects";
import { getSession } from "@/features/workspace/session";

export const metadata = { title: "Suhbatlar · Oqim Studio" };

/**
 * Every conversation a bot is having, newest first — and on a desktop, the
 * empty right half a thread will fill, the way Telegram's own client sits.
 * The page used to be one 820px column against a black void ("tiqilib
 * qolgan"); the width belongs to the layout now, not to a cap.
 *
 * The search is a GET, so a filtered list is a URL somebody can send to the
 * colleague who has to answer it.
 */
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string): string => (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";
  const query = read("q");
  const projectId = read("projectId");
  const botId = read("botId");

  const { workspace } = await getSession();
  const [conversations, projects, bots] = await Promise.all([
    inboxRepository.listConversations(workspace.id, { q: query, projectId, botId }),
    projectsRepository.list(workspace.id),
    botsRepository.list(workspace.id),
  ]);

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Suhbatlar" }]} title="Suhbatlar" subtitle={workspace.name} />
      <PageBody>
        <div className="flex h-full min-h-[60vh] items-stretch gap-4">
          <div className="flex min-h-0 w-full flex-col md:max-w-[400px] md:flex-none">
            {/* The one line that makes this screen live. `message.new` is
                raised wherever a message is filed — a customer's, a block's or
                an operator's — so the list moves for all three. */}
            <LiveRefresh events={["message.new"]} />
            <ConversationListPane
              conversations={conversations}
              query={query}
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              bots={bots.map((bot) => ({ id: bot.id, handle: bot.handle }))}
              projectId={projectId}
              botId={botId}
            />
          </div>
          {/* The other half of the screen, honest about being empty: pick a
              chat and the thread opens here. Hidden on a phone, where the
              list is the whole screen and a thread is its own page. */}
          <div className="hidden min-w-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-separator md:flex">
            <EmptyState icon="chat-circle" title="Suhbatni tanlang" description="Yozishma shu yerda ochiladi." />
          </div>
        </div>
      </PageBody>
    </>
  );
}
