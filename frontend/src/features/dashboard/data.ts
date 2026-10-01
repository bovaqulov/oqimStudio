import type { IconName } from "@/components/ui/Icon";
import type { StatusLabel } from "@/components/ui/types";
import { botsRepository } from "@/features/bots";
import { MODULE_DEFINITIONS } from "@/features/bots/modules";
import { flowsRepository, type FlowSummary, type ModuleKey } from "@/features/flows";

export interface ChannelStatus {
  name: string;
  icon: IconName;
  status: StatusLabel;
  href: string;
}

export interface ActivityItem {
  text: string;
  time: string;
  /** Where the event happened — an event you cannot open is a dead end. */
  href: string;
}

/** What the dashboard's "create" button needs to make a flow without asking any questions. */
export interface QuickCreateTarget {
  projectId: string;
  botId: string;
  botHandle: string;
  moduleKey: ModuleKey;
}

/** One option in the home screen's bot filter. */
export interface FlowBotOption {
  id: string;
  handle: string;
}

export interface DashboardOverview {
  channels: ChannelStatus[];
  activity: ActivityItem[];
  recentFlows: FlowSummary[];
  /**
   * The bots the filter offers — only the ones that own a flow.
   *
   * A workspace's full bot list would put options in the row that empty the
   * list when picked, which is a control teaching the reader that it is
   * broken. Ordered as the bot list is, so the row does not reshuffle itself
   * between visits.
   */
  flowBots: FlowBotOption[];
  /** How many flows the current filter matched — what the section heading counts. */
  shownFlowCount: number;
  /** `null` when the workspace has no bot yet — the CTA then points at connecting one. */
  quickCreate: QuickCreateTarget | null;
  botCount: number;
  flowCount: number;
}

/** The module a "new flow" lands in when nobody has said which one. */
const DEFAULT_MODULE: ModuleKey = "dms";
/** How many events the feed shows before it stops being a glance. */
const ACTIVITY_LIMIT = 6;

function moduleName(key: ModuleKey): string {
  return MODULE_DEFINITIONS.find((module) => module.key === key)?.name ?? key;
}

/**
 * Tells apart the rows that carry the same name.
 *
 * Every bot gets an "Asosiy oqim" of its own and every module can have one, so
 * a home screen mixing them lists two identical rows one under the other with
 * nothing on either to say which is which — and the reader has to open one to
 * find out. The row itself deliberately shows only the name (see `FlowRow`),
 * and the bot filter answers "whose is this" once for the whole list, so this
 * says the one thing left over: what makes these two different from each
 * other, and nothing when they are already distinct.
 *
 * Which fact that is depends on the collision — the bot when they are on
 * different bots, the module when they are on the same one. A workspace with a
 * single bot, which is where this reads worst, is the second case.
 */
function withNamesThatDiffer(flows: FlowSummary[], handleOf: Map<string, string>): FlowSummary[] {
  const sameName = new Map<string, FlowSummary[]>();
  for (const flow of flows) {
    const group = sameName.get(flow.name);
    if (group) group.push(flow);
    else sameName.set(flow.name, [flow]);
  }

  return flows.map((flow) => {
    const group = sameName.get(flow.name)!;
    if (group.length === 1) return flow;
    const acrossBots = group.some((other) => other.botId !== flow.botId);
    const qualifier = acrossBots ? handleOf.get(flow.botId) : moduleName(flow.moduleKey);
    return qualifier ? { ...flow, name: `${flow.name} · ${qualifier}` } : flow;
  });
}

/**
 * Everything the dashboard shows, composed from the workspace's own projects,
 * bots and flows. Nothing here is a fixture: an empty workspace produces empty
 * lists, which is exactly what its owner should see on day one.
 */
export async function getDashboardOverview(
  workspaceId: string,
  /** Narrow the list to one bot. Anything unrecognised shows everything. */
  botId?: string,
): Promise<DashboardOverview> {
  const [bots, flows] = await Promise.all([
    botsRepository.list(workspaceId),
    flowsRepository.list(workspaceId),
  ]);

  const channels: ChannelStatus[] = bots.map((bot) => ({
    name: bot.handle,
    icon: (bot.kind === "bot" ? "telegram-logo" : "user-circle") as IconName,
    status: bot.status,
    href: `/bots/${bot.id}`,
  }));

  // The feed is the bots' own activity trail, newest first as stored, capped so
  // the panel stays a summary.
  const activity: ActivityItem[] = bots
    .flatMap((bot) => bot.activity.map((entry) => ({ text: entry.text, time: entry.when, href: `/bots/${bot.id}` })))
    .slice(0, ACTIVITY_LIMIT);

  // Only the bots that own something. Offering the rest would put options in
  // the filter that empty the list when picked.
  const botsWithFlows = new Set(flows.map((flow) => flow.botId));
  const flowBots: FlowBotOption[] = bots
    .filter((bot) => botsWithFlows.has(bot.id))
    .map((bot) => ({ id: bot.id, handle: bot.handle }));

  // An id for a bot that owns nothing — a stale link, a deleted bot — shows
  // everything rather than an empty list under a filter naming something the
  // reader cannot see in the row above.
  const filtering = Boolean(botId) && botsWithFlows.has(botId!);
  const matched = filtering ? flows.filter((flow) => flow.botId === botId) : flows;

  const firstBot = bots[0];
  return {
    channels,
    activity,
    // Capped at four unfiltered — the home screen is a glance, and "Barcha
    // oqimlar" is under it. Picking a bot is asking for that bot's flows, so
    // the cap lifts: a list the reader narrowed themselves and that still
    // hides half of what matched is a filter that cannot be trusted.
    //
    // Names are disambiguated after the cap, against what is actually on
    // screen: two flows sharing a name are only a problem when both of them
    // are drawn.
    recentFlows: withNamesThatDiffer(
      filtering ? matched : matched.slice(0, 4),
      new Map(bots.map((bot) => [bot.id, bot.handle])),
    ),
    flowBots,
    shownFlowCount: matched.length,
    quickCreate: firstBot
      ? {
          projectId: firstBot.projectId,
          botId: firstBot.id,
          botHandle: firstBot.handle,
          moduleKey: DEFAULT_MODULE,
        }
      : null,
    botCount: bots.length,
    flowCount: flows.length,
  };
}
