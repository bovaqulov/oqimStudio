import type { IconName } from "@/components/ui/Icon";
import type { StatusLabel } from "@/components/ui/types";
import { agentsRepository } from "@/features/agents/data/agents-repository";
import { MODULE_DEFINITIONS, botsRepository } from "@/features/bots";
import { flowStatus, flowsRepository, isFlowEnabled } from "@/features/flows";
import { tablesRepository } from "@/features/tables/data/tables-repository";

export interface ProjectResourceRow {
  id: string;
  href: string;
  name: string;
  icon: IconName;
  /**
   * The row's one secondary line. It used to be two — a `meta` and a `stat` in
   * a 150px right-hand column — which on a 390px screen is a sentence in a
   * gutter. Whatever is worth saying under the name is composed here, once.
   */
  meta: string;
  /**
   * The badge, and only for a resource that is not simply running. Absent on a
   * row that is a destination rather than a thing with a state — a link to the
   * contact list is neither on nor off, and inventing a "Faol" for it would put
   * a word in the row that answers no question the reader asked.
   */
  status?: StatusLabel;
}

export interface ProjectResourceGroup {
  title: string;
  /**
   * The add row, when the group is something this page can add to. Left out by
   * the group of destinations at the bottom: a contact is written by a bot
   * being talked to, so a button there could only lie about what it does.
   */
  addLabel?: string;
  /** Where the add button leads — the screen that really creates one of these. */
  addHref?: string;
  /**
   * The workspace-wide list this group is a filtered view of, when there is
   * one. Only Data has it, and only because a table can be filed under no
   * project at all: without a way through to that list, such a table is
   * reachable from nowhere in the product.
   */
  allHref?: string;
  allLabel?: string;
  rows: ProjectResourceRow[];
}

/**
 * The project detail page's "Resources" tab is a view over other features'
 * data — bots, flows, agents, tables — and not a domain of its own, so it lives
 * as a composition function rather than bloating any of those repositories with
 * cross-feature knowledge (keeps each repository single-purpose).
 *
 * **The flow list is here again.** It was taken out once, on the grounds that a
 * bot already lists its own flows under its modules and that two copies of one
 * list is one that goes stale in the reader's head. What that missed is that
 * the second copy is only redundant to somebody who already knows a flow lives
 * inside a bot's module: the first reader to open their project looking for
 * their flows found Botlar, Agentlar and Ma'lumotlar, and no way in at all —
 * the home screen and the bot were the only two doors, and neither is where
 * somebody who thinks in projects goes first. What is below is not that list
 * twice over: it is this project's flows across every bot in it, each row
 * naming the bot and the module it answers in, and it links straight into the
 * editor rather than trying to be a second place to work on them.
 *
 * **Data is here**, though, and for the opposite reason to the flow list: a
 * price list is not reachable through anything else. It belongs to the business
 * this project *is* — the same way its bots do — rather than to the workspace,
 * which may hold three unrelated businesses.
 */
export async function getProjectResourceGroups(
  workspaceId: string,
  projectId: string,
): Promise<ProjectResourceGroup[]> {
  const [bots, agents, tables, workspaceFlows] = await Promise.all([
    botsRepository.listByProject(workspaceId, projectId),
    agentsRepository.listByProject(workspaceId, projectId),
    tablesRepository.list(workspaceId, { projectId }),
    // `FlowsRepository` has no by-project read: until this list existed, every
    // caller reached flows through a bot or through the workspace. So the
    // workspace's flows are narrowed here instead — `projectId` is already on
    // the summary, so the filter costs no second request, only the rows of
    // other projects travelling to be dropped. The day a workspace holds enough
    // flows for that to be measurable, this becomes a `listByProject` and the
    // filter below goes away.
    flowsRepository.list(workspaceId),
  ]);

  const flows = workspaceFlows.filter((flow) => flow.projectId === projectId);
  const handleOf = new Map(bots.map((bot) => [bot.id, bot.handle]));

  const connectBotHref = `/bots/new?projectId=${encodeURIComponent(projectId)}`;

  // A flow is created inside a bot, on the module screen `/bots/<id>` opens on
  // — there is no "new flow" screen that stands on its own. So the add row
  // leads there when the project has a bot; with none it names the step that
  // has to happen first rather than opening a screen that could only refuse.
  // With more than one bot the choice is not this row's to make silently, so
  // the handle it picked is written into the label.
  const [firstBot] = bots;
  let addFlowLabel = "Avval bot ulang";
  if (firstBot) addFlowLabel = bots.length > 1 ? `Oqim yaratish · ${firstBot.handle}` : "Oqim yaratish";

  return [
    {
      title: `Botlar (${bots.length})`,
      addLabel: "Bot qo'shish",
      addHref: connectBotHref,
      rows: bots.map((bot) => ({
        id: bot.id,
        href: `/bots/${bot.id}`,
        name: bot.handle,
        icon: (bot.kind === "bot" ? "robot" : "user-circle") satisfies IconName,
        // What it is. It used to try to add "what it has done" from
        // `bot.metrics[0]`, which this list has never been sent —
        // `BotListSerializer` carries nothing that costs a query per row — so
        // the clause was dead for as long as it existed and always joined an
        // empty string. The counters themselves are gone with the section that
        // was their only reader; `/analytics` answers that question.
        meta: bot.kind === "bot" ? "Telegram bot" : "Userbot",
        status: bot.status,
      })),
    },
    // Under the bots, because a flow belongs to one: the reader meets the bot
    // whose name is on every row below before the rows themselves.
    //
    // Not filtered by `ModuleDefinition.comingSoon`, unlike the bot's own tabs.
    // That flag hides a *surface* that is not finished; it does not stop the
    // runtime answering, so a flow filed under one and left switched on is live
    // and shown on no screen at all. This list is the only place it surfaces,
    // which is the same argument the Data group's "Hamma ma'lumotlar" row is
    // built on.
    {
      title: `Oqimlar (${flows.length})`,
      addLabel: addFlowLabel,
      addHref: firstBot ? `/bots/${firstBot.id}` : connectBotHref,
      rows: flows.map((flow) => ({
        id: flow.id,
        href: `/flows/${flow.id}`,
        name: flow.name,
        icon: "flow-arrow" satisfies IconName,
        // Where it answers, not what it says. A workspace's flows are called
        // "Asosiy oqim" and "Nomsiz oqim" several times over — one per bot, one
        // per module — so on a list mixing bots the bot and the module are the
        // only things telling two identical names apart. The same line the
        // search palette prints under a flow, for the same reason.
        meta: [
          handleOf.get(flow.botId),
          MODULE_DEFINITIONS.find((module) => module.key === flow.moduleKey)?.name,
        ]
          .filter(Boolean)
          .join(" · "),
        // The switch, read the one way the whole product reads it — `enabled`
        // where it exists, the label where it does not. A flow that is off
        // answers nobody, and that is the single fact worth a badge here; the
        // agent rows below carry theirs for the same reason.
        status: flowStatus(isFlowEnabled(flow)),
      })),
    },
    // What everything above it produced, and the answer to the question this
    // page could not answer at all: a flow collects a phone number and the
    // owner had nowhere in their project to read it back. Both screens have
    // existed the whole time — the note above `primaryNav` in
    // `components/layout/nav-config.ts` keeps them out of the sidebar precisely
    // because they belong to a project, and says in as many words that the row
    // comes back the day it has a home here. This is that home; until it
    // existed, ⌘K was the only door.
    //
    // Placed under the flows and above the agents because it reads as the
    // sentence the page is: these bots, these flows, and then the people they
    // talked to. The tools for building come after the thing built.
    //
    // `?projectId=` is a filter both screens genuinely apply — `/contacts`
    // hands it to `contactsRepository.list` and `/chats` to
    // `listConversations`, and the backend narrows on `bot__project_id` — so
    // these rows open this project's people rather than the workspace's list
    // with a decorative parameter on it. Each screen's own filter control shows
    // the project selected, which is what lets a reader widen it back out
    // instead of wondering why somebody is missing.
    {
      title: "Mijozlar",
      rows: [
        {
          id: "contacts",
          href: `/contacts?projectId=${encodeURIComponent(projectId)}`,
          name: "Kontaktlar",
          icon: "address-book" satisfies IconName,
          meta: "Oqim yig'gan javoblar va mijozlar ro'yxati",
        },
        {
          id: "chats",
          href: `/chats?projectId=${encodeURIComponent(projectId)}`,
          name: "Suhbatlar",
          icon: "chat-circle" satisfies IconName,
          meta: "Botlar bilan bo'lgan yozishmalar",
        },
      ],
    },
    {
      title: `Agentlar (${agents.length})`,
      addLabel: "Agent yaratish",
      // The project travels with the link, because an agent belongs to one and
      // the create screen has no other way to know which — the same shape as
      // "Bot qo'shish" above.
      addHref: `/agents/new?projectId=${encodeURIComponent(projectId)}`,
      rows: agents.map((agent) => ({
        id: agent.id,
        href: `/agents/${agent.id}`,
        name: agent.name,
        icon: "robot",
        // The persona is what the author wrote for themselves about this
        // agent; with none, what it can do is the next most useful thing to
        // say — the same fallback the agent list used.
        meta:
          agent.persona ||
          (agent.tools.length ? `${agent.tools.length} ta vosita` : "Vositasiz — faqat ko'rsatma"),
        // An agent has no status label of its own; the one thing worth a badge
        // is the switch, because a disabled agent answers nothing and the row
        // otherwise looks like the others.
        status: agent.enabled
          ? { label: "Yoqilgan", tone: "success" }
          : { label: "O'chirilgan", tone: "neutral" },
      })),
    },
    {
      title: `Ma'lumotlar (${tables.length})`,
      addLabel: "Ma'lumot qo'shish",
      addHref: `/tables/new?projectId=${encodeURIComponent(projectId)}`,
      // The way to a table that belongs to no project. This group lists only
      // what is filed here, and a table made before the create form learned to
      // pass a project is filed nowhere — visible on that list and on no other
      // screen.
      allHref: "/tables",
      allLabel: "Hamma ma'lumotlar",
      rows: tables.map((table) => ({
        id: table.id,
        href: `/tables/${table.id}`,
        name: table.name,
        icon: "table" satisfies IconName,
        // The size, and not the key beside it. The key is derived from the
        // name and is shown nowhere the reader types — see `ColumnFields` and
        // `TableSettingsForm` — so a mono string under every row was the one
        // place it survived, saying nothing about the table itself.
        meta: `${table.rowCount} ta qator`,
        status: { label: `${table.columns.length} ustun`, tone: "neutral" },
      })),
    },
  ];
}
