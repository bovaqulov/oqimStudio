import { permanentRedirect } from "next/navigation";

/**
 * «Guruhlar» is part of Sozlamalar now.
 *
 * A redirect rather than a deleted route: the section had its own tab for long
 * enough to be bookmarked, and it is the destination `BotChatRow`'s findings
 * and any older link point at. A 404 here would read as the group management
 * having been removed, which is not what happened to it.
 */
export default async function BotChatsPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  permanentRedirect(`/bots/${botId}/settings`);
}
