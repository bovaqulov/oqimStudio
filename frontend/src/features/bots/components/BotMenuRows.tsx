import { Icon } from "@/components/ui/Icon";
import { MENU_ROW_CLASS } from "@/components/layout/menu-row";
import { cn } from "@/lib/utils/cn";

/**
 * What a bot's header "⋯" can actually do — which turned out to be one thing.
 *
 * It held two rows and neither of them did anything at all.
 *
 * «To'xtatish» asked for confirmation with *"Bot to'xtatiladi va xabarlarga
 * javob bermaydi"*, showed a red toast saying the bot had stopped, and sent no
 * request anywhere. There was no column to write and nothing in the runtime
 * read one, so the bot went on answering customers while the panel agreed it
 * had been stopped — the single most expensive lie a screen in this product
 * could tell. It is a real switch now, in Sozlamalar, next to the other things
 * that decide whether the bot answers at all: `Bot.is_paused`, which
 * `Bot.module_enabled` reads and therefore `matching.find_trigger` obeys.
 *
 * «Telegramda ochish» said "Telegramda ochilmoqda" and opened nothing. It is a
 * link now, which is all it ever needed to be — and being a link rather than a
 * button is why this file no longer needs to be a client component.
 *
 * A userbot's handle is a masked phone number rather than an `@username`, and
 * there is no `t.me` address for one, so the row is simply not offered.
 */
export function BotMenuRows({ handle }: { handle: string }) {
  if (!handle.startsWith("@")) return null;

  return (
    <a
      href={`https://t.me/${handle.slice(1)}`}
      target="_blank"
      rel="noreferrer"
      className={cn(MENU_ROW_CLASS, DESKTOP_COMPACT)}
    >
      <Icon name="telegram-logo" size={17} className="flex-none text-accent-400" />
      <span className="min-w-0 flex-1 truncate md:hidden">Telegramda ochish</span>
      <span className="hidden md:inline">Telegramda</span>
    </a>
  );
}

/**
 * The same row, once there is width for a toolbar instead of a menu. `PageHeader`
 * renders these twice — inline above `md`, and inside the sheet below it — so
 * one class list has to read correctly in both places.
 */
const DESKTOP_COMPACT =
  "md:min-h-0 md:w-auto md:flex-none md:rounded-[10px] md:bg-neutral-800 md:px-3 md:py-1.5 md:text-[13px]";
