import { notFound } from "next/navigation";
import { BotModulePanel } from "@/features/bots/components/BotModulePanel";
import { DEFAULT_MODULE_KEY, botsRepository } from "@/features/bots";
import { getSession } from "@/features/workspace/session";

/**
 * A bot's own page is its default module's page. Opening a bot used to land on
 * a summary of how it is connected, with the flows one tab further in.
 */
export default async function BotPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const { workspace } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();

  return <BotModulePanel bot={bot} moduleKey={DEFAULT_MODULE_KEY} />;
}
