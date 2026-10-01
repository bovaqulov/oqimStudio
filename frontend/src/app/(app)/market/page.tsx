import { botsRepository } from "@/features/bots/data/bots-repository";
import { TemplateBrowser } from "@/features/marketplace/components/TemplateBrowser";
import { templatesRepository } from "@/features/marketplace/data/templates-repository";
import { getSession } from "@/features/workspace/session";

export default async function MarketTemplatesPage() {
  const { workspace } = await getSession();
  // A template becomes a flow, and a flow belongs to a bot — so the sheet
  // cannot install anything without knowing which one, and it is better to say
  // "no bot yet" on the button than to fail after the tap.
  const [templates, bots] = await Promise.all([
    templatesRepository.list(workspace.id),
    botsRepository.list(workspace.id),
  ]);

  return (
    <TemplateBrowser
      templates={templates}
      bots={bots.map((bot) => ({ id: bot.id, name: bot.handle }))}
    />
  );
}
