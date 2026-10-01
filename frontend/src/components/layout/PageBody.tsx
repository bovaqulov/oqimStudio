import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The one scrollable content region every non-editor page renders into (DRY).
 *
 * On a phone the chrome floats over this rather than sitting above it: the top
 * bar and, on a screen that has them, the section tabs are `fixed` capsules
 * with the page sliding underneath. That is what the blur is for — a glass
 * panel with an opaque strip behind it is just a bar with round corners. The
 * cost is that this container has to leave room for what it scrolls under,
 * which is what `chrome` decides. From `md:` up the header is a real row again
 * and the padding drops to zero.
 */
export function PageBody({
  children,
  maxWidth,
  chrome = "bar",
}: {
  children: ReactNode;
  maxWidth?: number;
  /** `tabs` for a screen whose header carries a section strip under it. */
  chrome?: "bar" | "tabs";
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {/* 22px of gutter on each side of a 390px screen is 11% of it — a phone
          gets 16px and hands the rest back to the content. */}
      <div
        className={cn(
          // No `pt-*` here, in either direction. The top padding is the one
          // number on this element that changes with the breakpoint, and
          // `oq-scroll-under` already owns it at both — including the air a
          // desktop gets between the header's hairline and the first card. A
          // utility cannot take it back: that class is unlayered CSS and every
          // Tailwind utility sits in `@layer utilities`, which loses to it
          // whatever the source order says. A top padding was written here
          // once, in that losing form, and never applied on a single page.
          "absolute inset-0 overflow-x-hidden overflow-y-auto px-4 pb-[30px] md:px-[22px]",
          chrome === "tabs" ? "oq-scroll-under-tabs" : "oq-scroll-under",
        )}
      >
        <div className="animate-rise" style={maxWidth ? { maxWidth } : undefined}>
          {children}
        </div>
      </div>

      {/*
        The ground the floating chrome floats on.

        Everything above is drawn as capsules with `backdrop-filter` on them,
        and that only ever covers the capsules: the strip they sit in is mostly
        gaps — between the back button and the bell, above and below the tab
        pill, and the 12px of `--island-inset` down each side. On a short page
        nothing is behind those gaps and the shape reads exactly as intended. On
        a long one the page scrolls through them at full contrast, and the worst
        place it lands is the title, which has no capsule at all: two blurred
        copies of `--color-bg` behind the text were the whole of its background,
        and a paragraph sliding under it wins. Reported from the Kod screen and
        the table settings screen, which are simply the two longest.

        So the strip gets a ground of its own — the page's own colour, solid
        where the title and the tab pill are and dissolving before the first row
        of content. A gradient rather than a bar because the shape is the point:
        an opaque strip with an edge is the welded header this chrome was drawn
        to replace, and the fade means there is no line anywhere for the reader
        to see the chrome end at.

        Its height is the clearance class the scroller above already carries,
        applied to an empty box so the padding *is* the height. That is the one
        thing here that must not drift: the number is `env(safe-area-inset-top)`
        plus Telegram's inset plus 58 or 106 depending on the tabs, and a second
        copy of that arithmetic would be wrong on exactly the devices nobody
        tests on. `md:hidden`, because from there up the header is a real row
        with its own fill and a hairline under it, and nothing scrolls beneath it.

        `z-10` puts it over the scroller and under the chrome (`z-30` for the
        tabs, `z-40` for the bar and the dock) — all four are positioned in the
        root stacking context, so those numbers are directly comparable.
      */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-bg to-transparent md:hidden",
          // Where the solid part ends, as a share of each clearance: 62% of
          // 106px clears the tab pill's top edge, 76% of 58px clears the bar's
          // bottom edge. Below that the fade has the rest of the band to finish
          // in, which is the air the first row was already given.
          chrome === "tabs" ? "oq-scroll-under-tabs from-[62%]" : "oq-scroll-under from-[76%]",
        )}
      />
    </div>
  );
}
