"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useNavStore } from "./nav-store";

/**
 * The sidebar's three lives, decided in CSS so a mouse user never sees a frame
 * of the wrong one:
 *
 * - phone (`< md`): not drawn at all. A 228px column inside a 390px screen left
 *   the page 162px, which is the single worst thing about the product on a
 *   phone; the bottom tab bar carries navigation there instead.
 * - tablet (`md`–`lg`): a drawer, off-canvas until the header's menu button
 *   asks for it. `invisible` rather than a transform alone, so the links behind
 *   the edge of the screen are out of the tab order too.
 * - desktop (`lg+`): back in the row, always open, no drawer state to speak of
 *   — but narrowable to a 56px rail, which is the one piece of this the reader
 *   chooses. `oq-sidebar` is the hook that rule hangs off; the state behind it
 *   is `rail` in `nav-store.ts`.
 */
export function SidebarShell({ children }: { children: ReactNode }) {
  const open = useNavStore((state) => state.drawer);
  const close = useNavStore((state) => state.closeDrawer);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={close}
          className="fixed inset-0 z-40 bg-neutral-950/60 backdrop-blur-[2px] lg:hidden"
        />
      )}
      <aside
        // A link means the reader is leaving; the workspace switcher inside the
        // same panel does not, so the drawer only closes for anchors.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) close();
        }}
        className={cn(
          // `lg:transition-[width]` replaces the drawer's transform transition
          // rather than adding to it: at this width the panel cannot slide, and
          // a transform still on the list would animate the breakpoint itself
          // when a window is dragged across it.
          "oq-sidebar fixed inset-y-0 left-0 z-50 hidden w-[228px] flex-none flex-col border-r border-separator bg-overlay transition-transform duration-200 md:flex lg:static lg:visible lg:translate-x-0 lg:shadow-none lg:transition-[width]",
          open ? "visible translate-x-0 shadow-lg" : "invisible -translate-x-full",
        )}
      >
        {children}
      </aside>
    </>
  );
}
