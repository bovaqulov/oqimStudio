import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { FlowBotOption } from "../data";

/** The same geometry every segmented control in the app uses — see `ui/Segmented`. */
const TRACK = "no-scrollbar flex h-8 w-max max-w-full items-stretch gap-0.5 overflow-x-auto rounded-full bg-neutral-800 p-0.5";
const SEGMENT =
  "flex flex-none items-center rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors";

/**
 * Which bot's flows the home screen is listing.
 *
 * This list is the one place in the product that puts flows from every bot next
 * to each other, so it is the only place where a flow's name alone does not say
 * which bot would send it. That used to be answered per row, by a project/bot
 * chain printed under every name — five rows, five copies of an answer the
 * reader wanted once. Asking it once at the top answers it for the whole list
 * and gives back the line under each name.
 *
 * A link and a query rather than local state: a filtered home screen is worth
 * bookmarking and sending, and the page reads flows on the server anyway.
 *
 * Drawn only when there is a choice to make — one bot's worth of flows is not
 * a list anybody needs narrowed.
 */
export function FlowBotFilter({ bots, active }: { bots: FlowBotOption[]; active?: string }) {
  if (bots.length < 2) return null;
  const current = bots.some((bot) => bot.id === active) ? active : undefined;

  return (
    <nav aria-label="Botlar bo'yicha filtr" className={TRACK}>
      <Option href="/dashboard" label="Barchasi" active={!current} />
      {bots.map((bot) => (
        <Option key={bot.id} href={`/dashboard?botId=${encodeURIComponent(bot.id)}`} label={bot.handle} active={bot.id === current} />
      ))}
    </nav>
  );
}

function Option({ href, label, active }: { href: string; label: string; active: boolean }) {
  // The current one is still a link: it is where the reader already is, but
  // unlike a module row this is a filter — pressing the active option to clear
  // a half-typed URL or a stale query is a reasonable thing to try.
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        SEGMENT,
        active ? "bg-surface-raised text-text shadow-md" : "oq-press text-neutral-500 hover:text-neutral-200",
      )}
    >
      {label}
    </Link>
  );
}
