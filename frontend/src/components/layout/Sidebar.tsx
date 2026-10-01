import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import type { NavModel } from "./nav-config";
import { SidebarNav } from "./SidebarNav";
import { SidebarRailToggle } from "./SidebarRailToggle";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarShell } from "./SidebarShell";

/**
 * Tablet drawer and desktop column — same markup, `SidebarShell` decides which
 * one this width gets. The model and the workspace footer are handed down from
 * the app shell so the phone's "Yana" sheet can be built from the same reads.
 */
export function Sidebar({ model, summary }: { model: NavModel; summary: ReactNode }) {
  return (
    <SidebarShell>
      <div className="oq-rail-row flex items-center gap-2.5 px-4 pt-4 pb-3.5">
        <span
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(180deg, var(--color-brand-from), var(--color-brand-to))",
          }}
        >
          <Icon name="flow-arrow" size={14} weight="fill" className="text-white" />
        </span>
        {/* One line. "Studio" under "Oqim" in 10px uppercase at 40% ink was the
            lowest-contrast text in the product and said half a word. The mark
            stays in the rail and the words go: it is the only thing in the
            column that still reads at 26px. */}
        <span className="oq-rail-hide text-[17px] font-semibold tracking-tight">Oqim Studio</span>
      </div>

      <SidebarSearch />
      <SidebarNav model={model} />
      {/* Under the nav and above the workspace: last in the tab order, next to
          the other control that changes the column rather than the page. */}
      <SidebarRailToggle />
      {summary}
    </SidebarShell>
  );
}
