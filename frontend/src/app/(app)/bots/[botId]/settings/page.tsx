import { notFound } from "next/navigation";
import { BotBusinessPanel } from "@/features/bots/components/BotBusinessPanel";
import { BotChatsPanel } from "@/features/bots/components/BotChatsPanel";
import { BotModuleSwitches } from "@/features/bots/components/BotModuleSwitches";
import { BotSettingsScreen } from "@/features/bots/components/settings/BotSettingsScreen";
import { botsRepository } from "@/features/bots";
import { projectsRepository } from "@/features/projects";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";

/**
 * Everything about the bot that is not a flow.
 *
 * The groups and channels used to be a section of their own («Guruhlar»). They
 * are here now, above the bot's own profile, because that is what was asked
 * for — and the section is gone rather than left empty, so there is one place
 * to look instead of two.
 *
 * The order is the order of the causes, which is the order somebody debugging a
 * silent bot works down. **Where it answers at all** comes first: the module
 * switches, the one fault no amount of Telegram rights can fix and the only one
 * on this screen that is entirely ours. Then each surface it answers on, with
 * what is wrong where something is — the Business accounts, then the groups and
 * channels. Then how the bot presents itself, and at the bottom the two things
 * that end it: stopping it, and disconnecting it.
 *
 * The switches were rendered from inside `BotChatsPanel` and are their own row
 * here now, because two panels below them report the same `module_off` about
 * two different surfaces and a switch list owned by one of them could only ever
 * sit above one of the two.
 *
 * Server components composed as siblings rather than nested: `BotChatsPanel`
 * and `BotBusinessPanel` each read on the server, and `BotSettingsScreen` is a
 * client component. Importing either panel *inside* the screen would pull a
 * `server-only` repository into the browser bundle and fail the build.
 */
export default async function BotSettingsPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const { workspace, role } = await getSession();
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) notFound();
  // Read here rather than inside the settings screen: that one is a client
  // component, and the repository it would need is `server-only`.
  const projects = await projectsRepository.list(workspace.id);

  return (
    <div className="flex flex-col gap-5">
      <BotModuleSwitches botId={bot.id} enabled={bot.enabledModules} canManage={canEditContent(role)} />
      <BotBusinessPanel bot={bot} />
      <BotChatsPanel bot={bot} canManage={canEditContent(role)} />
      <BotSettingsScreen
        bot={bot}
        role={role}
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
      />
    </div>
  );
}
