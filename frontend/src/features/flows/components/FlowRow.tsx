import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { isFlowEnabled } from "../state";
import type { FlowSummary } from "../types";
import { FlowEnableSwitch } from "./FlowEnableSwitch";

/**
 * One flow, as one row — everywhere a flow is listed.
 *
 * There used to be two of these: a tall card on the bot page (name, a
 * description under it, then a third line carrying the run count, "Sinash" and
 * a menu) and a compact row on the home screen. The same five objects looked
 * like two different kinds of thing depending on which way you arrived, which
 * is the sort of difference a reader has to spend attention resolving and gets
 * nothing back for. This is the row; the card is gone.
 *
 * Two questions are answered without opening anything: what it is called and
 * whether it is on. Everything that used to sit under the name is gone: the
 * generated trigger sentence restated in prose what opening the flow shows as a
 * graph, and down a list of five it was five sentences competing with the five
 * names that actually tell them apart; the run count was the tail of that same
 * line. A third answer lived there too — which project and bot the flow hangs
 * off, on the home screen, the one list that mixes bots together. That question
 * is now asked once at the top of that list, by its bot filter, instead of
 * being answered again on every row.
 *
 * Anything a flow can *do* goes in `trailing`, which on both lists is the same
 * "⋯" menu — [[FlowRowMenu]]. The home screen went without one for a while, on
 * the grounds that it is for reading; but it is also the screen the flows are
 * actually on, and "read-only" there meant opening a bot and then a module to
 * rename or delete a row already under the cursor.
 */
export function FlowRow({
  flow,
  empty = false,
  trailing,
}: {
  flow: FlowSummary;
  /** Switched on but carrying no blocks — it sends nothing, and the row should say so. */
  empty?: boolean;
  trailing?: ReactNode;
}) {
  const enabled = isFlowEnabled(flow);

  return (
    <div className="oq-row">
      <span
        className={cn(
          "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px]",
          enabled ? "bg-accent-900 text-accent-200" : "bg-neutral-800 text-neutral-600",
        )}
      >
        <Icon name="flow-arrow" size={16} />
      </span>

      {/* Stretched over the row: the switch and the menu keep their own clicks
          by being positioned, so anywhere else on the row opens the editor. */}
      <Link
        href={`/flows/${flow.id}`}
        className="min-w-0 flex-1 text-text after:absolute after:inset-0 after:content-['']"
      >
        <span className={cn("t-body block truncate", !enabled && "text-neutral-400")}>{flow.name}</span>
      </Link>

      {/* The module's entry point, marked where it is picked from. */}
      {flow.isMain && <Badge tone="accent">Asosiy</Badge>}
      {/* Enabled but empty is a real state to reach and looks like a working
          flow on a list. The badge is the whole message; what to do about it is
          what opening the flow shows. */}
      {empty && <Badge tone="warning">Bo&apos;sh</Badge>}

      <span className="relative flex flex-none">
        <FlowEnableSwitch flow={flow} enabled={enabled} />
      </span>

      {trailing && <span className="relative flex flex-none">{trailing}</span>}
    </div>
  );
}
