import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { FlowStudio, StudioLink, TemplateStrip } from "@/features/flow-kit";
import { flowsRepository, isFlowEnabled, type ModuleKey } from "@/features/flows";
import { botsRepository } from "../data/bots-repository";
import { DEFAULT_MODULE_KEY, getModuleDefinition, moduleHref } from "../modules";
import type { Bot } from "../types";
import { BotModuleRow } from "./BotModuleRow";
import { BusinessConnectionPanel } from "./BusinessConnectionPanel";
import { ModuleFlowCard } from "./ModuleFlowCard";
import { NewFlowMainButton } from "./NewFlowMainButton";

/**
 * A bot, opened: its flows.
 *
 * The second and third navigation rows used to live here — a module bar, and
 * under it a strip carrying "3/5 faol", "Shablonlar" and "+ Yangi oqim". The
 * module bar moved into Sozlamalar; the count became the grey number beside the
 * section heading, where a count belongs; "Shablonlar" is the first row of the
 * chooser that "+ Yangi oqim" opens, so it was already one tap away and did not
 * need a second button of its own; and creating a flow is the screen's one
 * action, which puts it on Telegram's MainButton.
 *
 * The bot's own URL is the default module's page, and `/bots/<id>/modules/<key>`
 * renders this same screen for any other one.
 */
export async function BotModulePanel({ bot, moduleKey }: { bot: Bot; moduleKey: ModuleKey }) {
  const moduleDef = getModuleDefinition(moduleKey);
  // A module that has not shipped yet stays reachable — nothing 404s — but it
  // owns no flows, so nothing below the head is fetched or offered for it.
  const comingSoon = moduleDef.comingSoon === true;
  // "Bot ichida" always has an entry point: /start is answered by a main flow
  // that exists with the module rather than being the author's first chore.
  // render-effect-ok: this POSTs during a render, which is normally the
  // /join bug — but the backend holds the "exactly one main flow" rule, so a
  // prefetch, a double render and a refresh all land on the same row.
  if (moduleKey === "dms") {
    await flowsRepository.ensureMainFlow({ workspaceId: bot.workspaceId, projectId: bot.projectId, botId: bot.id });
  }
  // Whole records, not summaries: the card runs the flow in its test chat, and a
  // simulator cannot walk a graph it was never given.
  const flows = comingSoon ? [] : await flowsRepository.listRecordsByModule(bot.workspaceId, bot.id, moduleKey);
  // Only asked for on the module that shows them, and normally empty: most
  // bots are never attached to a Business account. The panel below used to be
  // drawn from a fixture, so every bot claimed a connection it did not have.
  const businessConnections =
    moduleKey === "business" && !comingSoon
      ? await botsRepository.listBusinessConnections(bot.workspaceId, bot.id)
      : [];
  const liveCount = flows.filter(isFlowEnabled).length;
  const stopped = bot.status.tone !== "success";

  if (comingSoon) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
          <Icon name="clock" size={26} />
        </span>
        <p className="t-headline m-0">«{moduleDef.name}» tez orada</p>
        <Link
          href={moduleHref(bot.id, DEFAULT_MODULE_KEY)}
          className="oq-press t-body min-h-[44px] flex items-center px-2 text-accent-400"
        >
          Bot ichiga qaytish
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Only when something is wrong. A bot that is running says so by
          answering messages, not by a green strip on its own page. */}
      {stopped && (
        <div className="flex items-center gap-2.5 rounded-[12px] bg-warning-bg px-3.5 py-3">
          <Icon name="warning" size={17} className="flex-none text-warning-fg" />
          <span className="t-subhead min-w-0 flex-1 text-warning-fg">{bot.status.label}</span>
        </div>
      )}

      <BotModuleRow botId={bot.id} current={moduleKey} />

      {/* The one fault a flow author cannot see from the canvas: a module that
          is off is refused by `matching.find_trigger` *before* it looks for a
          flow, so everything below can be drawn, switched on and ignored. An
          empty list is not off — the runtime reads that as "nobody has
          configured this yet" and answers dms. */}
      {bot.enabledModules.length > 0 && !bot.enabledModules.includes(moduleKey) && (
        <Link
          href={`/bots/${bot.id}/settings`}
          className="oq-press flex items-center gap-2.5 rounded-[12px] bg-warning-bg px-3.5 py-3"
        >
          <Icon name="warning" size={17} className="flex-none text-warning-fg" />
          <span className="t-subhead min-w-0 flex-1 text-warning-fg">
            «{moduleDef.name}» bo&apos;limi o&apos;chirilgan — bu oqimlar ishlamaydi. Yoqish →
          </span>
        </Link>
      )}

      {/* Everything that creates a flow — chooser, gallery, wizard — lives in
          one mounted component; the MainButton below only opens it. */}
      <FlowStudio moduleKey={moduleKey} projectId={bot.projectId} botId={bot.id} />

      {businessConnections.map((connection) => (
        <BusinessConnectionPanel key={connection.id} connection={connection} />
      ))}

      {flows.length === 0 ? (
        <div className="flex flex-col gap-5 py-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-900 text-accent-200">
              <Icon name="flow-arrow" size={26} />
            </span>
            <p className="t-headline m-0">Hali oqim yo&apos;q</p>
            <StudioLink target="gallery" className="t-body min-h-[44px] bg-transparent px-2 text-accent-400">
              Tayyor shablonlardan boshlash
            </StudioLink>
          </div>
          <TemplateStrip moduleKey={moduleKey} projectId={bot.projectId} botId={bot.id} />
        </div>
      ) : (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2 px-1">
            <h2 className="t-headline m-0 flex-1">Oqimlar</h2>
            <span className="t-footnote t-tertiary tabular-nums">
              {liveCount}/{flows.length} faol
            </span>
          </div>
          <ListGroup inset="icon" className="pt-1">
            {flows.map((flow) => (
              <ModuleFlowCard key={flow.id} flow={flow} />
            ))}
          </ListGroup>
        </section>
      )}

      {/* The screen's one action, under the list it adds to. */}
      <NewFlowMainButton inline />

      {/* «Ko'rsatkichlar va faoliyat» folded away here, under the flows. Both
          halves were in the wrong place. The counters were an hour's
          conversations printed next to a link to `/analytics`, which answers
          that question properly and over a range the reader picks — a summary
          worth two `COUNT`s on every read of a bot and worth nobody's attention
          on the screen they came to for flows. The trail underneath them is a
          fact about the bot rather than about its flows, so it is on the bot's
          Sozlamalar screen with the rest of them. */}
    </div>
  );
}
