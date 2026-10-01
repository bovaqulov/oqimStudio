"use client";

import { Icon } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useNavStore } from "./nav-store";

/**
 * Collapse and expand, as a row rather than as a handle on the sidebar's edge.
 * The edge already belongs to the border, the page's scrollbar and the resize
 * cursor, and a control floating over all three is missed as often as it is
 * hit; a row in the shape of the links above it is reachable by Tab in the
 * order the reader already walks the column.
 *
 * Below `lg` it is not drawn at all — the drawer and the phone sheet have no
 * rail to be in, so a control that says they do is a lie the reader can click.
 */
export function SidebarRailToggle() {
  const rail = useNavStore((state) => state.rail);
  const toggle = useNavStore((state) => state.toggleRail);
  const t = useT();
  const label = rail ? t.chrome.expandSidebar : t.chrome.collapseSidebar;

  return (
    <button
      type="button"
      onClick={toggle}
      // Both, the way every icon button in the product carries them: the label
      // is the name, the title is the bubble that explains the arrow once it is
      // the only thing left in the rail.
      aria-label={label}
      title={label}
      // `aria-expanded` on the sidebar's own control rather than an
      // `aria-pressed` toggle: what changes is how much of the column is shown,
      // not whether a switch is on.
      aria-expanded={!rail}
      className="oq-rail-row t-subhead mx-2.5 mb-1 hidden cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-100 lg:flex"
    >
      <Icon name={rail ? "arrow-right" : "arrow-left"} size={16} className="flex-none" />
      <span className="oq-rail-hide flex-1 truncate text-left">{t.chrome.collapse}</span>
    </button>
  );
}
