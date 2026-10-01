"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { isNavItemActive, isSectionActive, type NavModel, type NavSection } from "./nav-config";
import { NavGroupRow } from "./NavGroupRow";
import { NavLinkRow } from "./NavLinkRow";
import { useNavStore } from "./nav-store";

export function SidebarNav({ model }: { model: NavModel }) {
  const pathname = usePathname();
  const t = useT();
  // Only the sections the reader has actually clicked are remembered. Anything
  // untouched follows the route, so "Ko'proq" is open whenever you are inside
  // it and shut the rest of the time without an effect having to notice.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const rail = useNavStore((state) => state.rail);
  const drawer = useNavStore((state) => state.drawer);
  const expandRail = useNavStore((state) => state.expandRail);
  /*
   * Only the project tree folds now.
   *
   * «Ko'proq» folded too, and on a screen with room for every row that is a
   * click charged for nothing: the reader pays it to see four destinations
   * that were always going to fit. A project list is different — it grows with
   * the workspace and genuinely has to be foldable — so it keeps the
   * disclosure and the rest are drawn as ordinary rows below it.
   *
   * The phone keeps its own «Ko'proq» sheet either way: a tab bar holds three
   * or four things and the sheet is where the rest live, which is a different
   * problem with a different right answer (`MobileNav`).
   */
  const sections = [model.projects].filter((section): section is NavSection => section !== null);

  // The position a section starts from, before anyone has touched it. Written
  // once because the row needs it to draw and the toggle needs it to invert.
  const startOpen = (section: NavSection) => section.defaultOpen || isSectionActive(pathname, section);

  /*
   * The rail hides a section's children outright, so a row that only flipped
   * them would be a click with nothing to show for it. There it does the thing
   * the reader was reaching for instead: gives the column back, with the
   * section they asked for already open.
   *
   * `!drawer` is what keeps this to the desktop without measuring the viewport.
   * Below `lg` these rows can only be reached through the drawer, and the rail
   * is an `lg+` rule — so an open drawer is exactly the case where `rail` is
   * stored but not on screen.
   */
  function toggleSection(section: NavSection) {
    if (rail && !drawer) {
      expandRail();
      setToggled((state) => ({ ...state, [section.key]: true }));
      return;
    }
    setToggled((state) => ({ ...state, [section.key]: !(state[section.key] ?? startOpen(section)) }));
  }

  return (
    <nav
      aria-label={t.chrome.mainNav}
      className="flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2.5 py-2"
    >
      {model.primary.map((item) => (
        <NavLinkRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon ?? "house"}
          active={isNavItemActive(pathname, item)}
        />
      ))}
      {sections.map((section) => (
        <NavGroupRow
          key={section.key}
          section={section}
          pathname={pathname}
          open={toggled[section.key] ?? startOpen(section)}
          onToggle={() => toggleSection(section)}
        />
      ))}
      {model.more.items.map((item) => (
        <NavLinkRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon ?? "dots-three"}
          active={isNavItemActive(pathname, item)}
        />
      ))}
    </nav>
  );
}
