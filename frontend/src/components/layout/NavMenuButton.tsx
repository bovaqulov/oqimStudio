"use client";

import { useT } from "@/lib/i18n/LocaleProvider";
import { useNavStore } from "./nav-store";

/**
 * The tablet's way back to the sidebar. Hidden on a phone (the bottom tab bar
 * is the navigation there) and on desktop (the sidebar never left).
 *
 * The bars are drawn rather than imported: the icon registry has no hamburger,
 * and three rules do not need one.
 */
export function NavMenuButton() {
  const open = useNavStore((state) => state.openDrawer);
  const t = useT();

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t.chrome.openMenu}
      title={t.chrome.menu}
      className="oq-tap relative hidden h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 md:flex lg:hidden"
    >
      <span aria-hidden className="flex h-[11px] w-[15px] flex-col justify-between">
        <span className="h-[1.5px] w-full rounded-full bg-current" />
        <span className="h-[1.5px] w-full rounded-full bg-current" />
        <span className="h-[1.5px] w-full rounded-full bg-current" />
      </span>
    </button>
  );
}
