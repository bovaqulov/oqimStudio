import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { Tone } from "@/components/ui/types";
import { cn } from "@/lib/utils/cn";
import type { Bot } from "../types";

/** The status, as a colour. The word is next to it — this is what makes it findable. */
const DOT: Record<Tone, string> = {
  success: "bg-success-fg",
  warning: "bg-warning-fg",
  danger: "bg-danger-fg",
  neutral: "bg-neutral-600",
  accent: "bg-accent-400",
};

/**
 * The workspace's bots, as one inset list.
 *
 * Built the way a phone list is built rather than the way a table is: a round
 * avatar carries the kind, the row's second line carries everything the row
 * used to spread across three columns, and a chevron says it opens. The
 * separator starts at the text so the rows read as one object.
 *
 * The same grouped-list shell every other list in the product uses
 * (`.oq-group`). It had a blurred translucent one of its own, which made sense
 * against the old panel-coloured page and stopped making sense the moment the
 * ground went black and the *chrome* became the thing that blurs.
 */
export function BotListPanel({ bots }: { bots: Bot[] }) {
  return (
    <div className="oq-group">
      {bots.map((bot, index) => (
        <Link
          key={bot.id}
          href={`/bots/${bot.id}`}
          className={cn(
            "oq-hairline relative flex min-h-[64px] items-center gap-3 px-4 py-2.5 transition-colors active:bg-neutral-800/50 md:hover:bg-neutral-800/40",
            // The inset separator lines up with the text, past the avatar.
            index > 0 ? "before:left-[60px]" : "before:hidden",
          )}
        >
          <span
            className={cn(
              "flex h-11 w-11 flex-none items-center justify-center rounded-full",
              bot.kind === "bot"
                ? "bg-accent-800/70 text-accent-200"
                : "bg-neutral-tone-bg text-neutral-tone-fg",
            )}
          >
            <Icon name={bot.kind === "bot" ? "robot" : "user-circle"} size={21} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="t-headline truncate">{bot.handle}</div>
            <div className="t-footnote t-secondary mt-0.5 flex items-center gap-1.5">
              <span className={cn("h-[7px] w-[7px] flex-none rounded-full", DOT[bot.status.tone])} />
              <span className="truncate">{bot.status.label}</span>
              {/* Everything the row used to carry is still here — behind `md`,
                  where there is width for it rather than a second wrapped line. */}
              <span className="hidden truncate text-neutral-600 md:inline">
                {/* No count here. It read `bot.metrics[0]`, which this list has
                    never been sent — `BotListSerializer` carries nothing that
                    costs a query per row — so the clause was dead for as long
                    as it existed and rendered nothing either way. */}
                · {bot.kind === "bot" ? "Telegram bot" : "Userbot"} · {bot.updatedAt}
              </span>
            </div>
          </div>

          <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
        </Link>
      ))}
    </div>
  );
}
