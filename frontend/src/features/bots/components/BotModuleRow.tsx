import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { COMING_SOON_MODULES, MODULE_DEFINITIONS, moduleHref, moduleNames } from "../modules";

/** The same geometry every segmented control in the app uses — see `ui/Segmented`. */
const TRACK = "no-scrollbar flex h-9 w-max max-w-full items-stretch gap-0.5 overflow-x-auto rounded-full bg-neutral-800 p-0.5";
const SEGMENT =
  "flex flex-none items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors";

/**
 * The bot's five surfaces, side by side above everything else on its page.
 *
 * A row rather than a list, and at the top rather than under the flows: this is
 * how you get from one surface's flows to another's, and a control you navigate
 * with belongs where you look first. It spent a while as a settings list on the
 * argument that four of the five are chosen once — true of the choice, but the
 * list is not the choice, it is the way back and forth.
 *
 * Drawn as the segmented control rather than as chips of its own invention. It
 * *is* a segmented control — one of a small set, exactly one of them current —
 * and inventing a second look for that idea is how a product ends up with two
 * of everything. Borrowing `ui/Segmented`'s geometry instead of the component
 * means these can be links: a segment that navigates has an address, and a
 * `<button>` firing `router.push` would throw away middle-click, "open in new
 * tab" and the status bar for nothing.
 *
 * The current module is a `<span>`, not a link to itself, so the row says where
 * you are as well as where you can go — and a "Tez orada" module stays visible
 * but unclickable, because a surface that is coming is worth knowing about and
 * a link to a page that says "tez orada" is not worth a tap.
 *
 * It scrolls sideways rather than wrapping: five segments do not fit a 390px
 * screen, and a row that becomes two rows stops reading as one control.
 *
 * The line under it is the reason the grey ones are grey. It was a `title`,
 * which is a tooltip a finger never sees and a pointer only finds by resting
 * on a segment that looks broken — so three of the five surfaces were dimmed
 * and unclickable with nothing anywhere saying why, and the nearest available
 * explanation ("Bot qayerda ishlaydi" in Sozlamalar) is about a different
 * thing entirely: those switches turn a *shipped* module off. These have not
 * shipped.
 */
export function BotModuleRow({ botId, current }: { botId: string; current: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <nav aria-label="Bo'limlar" className={TRACK}>
        {MODULE_DEFINITIONS.map((module) => {
          if (module.comingSoon) {
            return (
              <span
                key={module.key}
                title="Tez orada"
                aria-disabled
                className={cn(SEGMENT, "cursor-not-allowed text-neutral-700")}
              >
                <Icon name={module.icon} size={15} className="flex-none" />
                {module.name}
              </span>
            );
          }

          if (module.key === current) {
            return (
              <span
                key={module.key}
                aria-current="page"
                className={cn(SEGMENT, "bg-surface-raised text-text shadow-md")}
              >
                <Icon name={module.icon} size={15} className="flex-none" />
                {module.name}
              </span>
            );
          }

          return (
            <Link
              key={module.key}
              href={moduleHref(botId, module.key)}
              className={cn(SEGMENT, "oq-press text-neutral-500 hover:text-neutral-200")}
            >
              <Icon name={module.icon} size={15} className="flex-none" />
              {module.name}
            </Link>
          );
        })}
      </nav>
      {COMING_SOON_MODULES.length > 0 && (
        <p className="t-footnote t-tertiary m-0 px-1">{moduleNames(COMING_SOON_MODULES)} — tez orada.</p>
      )}
    </div>
  );
}
