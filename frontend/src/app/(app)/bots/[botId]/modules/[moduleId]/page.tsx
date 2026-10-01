import { notFound } from "next/navigation";
import { BotModulePanel } from "@/features/bots/components/BotModulePanel";
import { MODULE_DEFINITIONS, botsRepository } from "@/features/bots";
import type { ModuleKey } from "@/features/flows";
import { getSession } from "@/features/workspace/session";

function isModuleKey(value: string): value is ModuleKey {
  return MODULE_DEFINITIONS.some((module) => module.key === value);
}

/**
 * One module of one bot. The same screen the bot's own URL renders — this route
 * stays because links to it were saved, shared and bookmarked before the
 * default module moved up to `/bots/<id>`.
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ botId: string; moduleId: string }>;
}) {
  const { botId, moduleId } = await params;
  if (!isModuleKey(moduleId)) notFound();

  const { workspace } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();

  return <BotModulePanel bot={bot} moduleKey={moduleId} />;
}
