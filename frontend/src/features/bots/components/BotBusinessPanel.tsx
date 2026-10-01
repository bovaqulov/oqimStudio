import { Icon } from "@/components/ui/Icon";
import { botsRepository } from "../data/bots-repository";
import type { Bot } from "../types";
import { BusinessConnectionPanel } from "./BusinessConnectionPanel";

/**
 * «Business akkauntlar» — which personal Telegram accounts have attached this
 * bot, and what their owners let it do.
 *
 * It was reachable from exactly one place: the `business` module's own page,
 * one tab and one module deep, which is not where anybody looks when a Business
 * bot is silent. It belongs on the same screen as the switch that decides
 * whether the module runs at all, next to the groups and channels, because the
 * question is the same question one surface over: *botim nega bu yerda
 * ishlamayapti*.
 *
 * The findings under each account are the reason it is worth a panel rather
 * than a line. Two of them the reader can act on here — the module being
 * switched off, and the bot being stopped. The rest are the account owner's own
 * decisions, taken in their Telegram: the Bot API gives a bot no way to grant
 * itself a right, so the panel reports and offers no control. `can_reply` is
 * the one that matters most and the one that has been invisible: without it the
 * bot cannot send a single message on that account, every flow ends in a
 * refusal, and nothing anywhere said so.
 *
 * Nothing on this screen creates a row. The owner attaches the bot in Telegram
 * under Settings → Business → Chatbots and the `business_connection` update
 * files it (`engine/dispatch.py`), which is why an empty list says what to do
 * over there rather than offering a button here.
 */
export async function BotBusinessPanel({ bot }: { bot: Bot }) {
  const connections = await botsRepository.listBusinessConnections(bot.workspaceId, bot.id);

  // No panel at all for a bot with the module off and no account attached:
  // that is most bots in the product, and an empty section repeated on every
  // settings screen is chrome, not information. A bot with the module *on* is
  // one whose owner is expecting this to work, so it gets the empty state.
  if (connections.length === 0 && !bot.enabledModules.includes("business")) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="t-headline m-0 flex-1">Business akkauntlar</h2>
        {connections.length > 0 && (
          <span className="t-footnote t-tertiary tabular-nums">{connections.length}</span>
        )}
      </div>

      {connections.length === 0 ? (
        <p className="t-footnote t-tertiary m-0 flex items-start gap-1.5 px-1">
          <Icon name="info" size={13} className="mt-[3px] flex-none" />
          <span>
            Hali hech qanday akkaunt ulanmagan. Telegramda: Sozlamalar → Business → Chatbots → shu botni
            tanlang va «Javob yozish» huquqini bering. Ro&apos;yxat o&apos;zi to&apos;ladi.
          </span>
        </p>
      ) : (
        connections.map((connection) => (
          <BusinessConnectionPanel key={connection.id} connection={connection} />
        ))
      )}
    </section>
  );
}
