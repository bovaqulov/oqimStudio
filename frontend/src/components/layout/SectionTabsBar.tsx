import type { ReactNode } from "react";

/**
 * Where a screen's section strip lives.
 *
 * On a phone it is chrome: a fixed capsule parked under the floating top bar,
 * with the page scrolling beneath it. Inside the scroll container — which is
 * where it used to be — it scrolled away, so a reader three flows down the list
 * had no way back to "Sozlamalar" without scrolling up first.
 *
 * From `md:` up it drops back into the document, because a desktop header is a
 * real row and the strip belongs directly under it.
 *
 * Pair with `<PageBody chrome="tabs">`, which is what leaves the room this
 * covers.
 */
export function SectionTabsBar({ children }: { children: ReactNode }) {
  return <div className="oq-island-tabs mb-0 md:mb-4">{children}</div>;
}
