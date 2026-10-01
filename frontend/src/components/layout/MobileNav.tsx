"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useMainButtonStore } from "@/lib/telegram/main-button-store";
import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";
import { useCommandPaletteStore } from "./command-store";
import { isNavItemActive, type NavItem, type NavModel } from "./nav-config";
import { useNavStore } from "./nav-store";

interface Tab {
  label: string;
  href: string;
  icon: IconName;
}

/**
 * The dock's own destinations, plus "Yana" beside them — at most four, because
 * a fifth would be under 44px wide on a 320px screen. Everything the workspace
 * can do that is not one of these is one tap away in "Yana"; nothing lives only
 * in the sidebar.
 *
 * Their labels are shorter than the sidebar's and are their own dictionary
 * keys for it: "Bosh sahifa" does not fit under a 23px icon at 10.5px, which
 * is why this list never read from the nav model in the first place.
 *
 * "Suhbat" used to be the third, on the argument that a phone asks "what is
 * being said". It is gone with the sidebar's own «Suhbatlar» row and for that
 * row's reason, not for a layout one: a chat list spanning every bot in the
 * workspace is the flat shape the project layer corrects, and it is moving
 * inside the project page. The dock had to lose it at the same moment the
 * sidebar did — a destination that is a tab on a phone and nowhere on a desktop
 * is a product telling two stories about where its screens live. `/chats` still
 * renders and ⌘K still finds it.
 */
function tabs(t: Dictionary): Tab[] {
  return [
    { label: t.chrome.tabs.home, href: "/dashboard", icon: "house" },
    { label: t.chrome.tabs.bots, href: "/bots", icon: "robot" },
  ];
}


/**
 * The dock and the search circle are one shape at two widths: 56px tall, fully
 * round, the same glass as the bar at the top of the screen. Sharing the string
 * is what stops the pair drifting apart the next time one of them is touched —
 * a capsule and a circle that disagree by two pixels of radius read as a bug
 * nobody can name.
 *
 * 56px, plus the 12px it is lifted off the bottom edge, is also exactly what
 * `--oq-tabbar` reserves in globals.css. The two numbers are a pair, not a
 * coincidence: change one here and the page stops ending above the dock.
 */
const CAPSULE = "oq-island h-[56px] rounded-[28px]";

/**
 * iOS system blue, one value per theme.
 *
 * Deliberately *not* `--color-accent`: Telegram brand cyan is what a filled
 * primary button is made of here, and a dock that lights up in it competes with
 * every "Saqlash" on the screen. The dock is system chrome, so it takes the
 * system colour — #0A84FF on black, #007AFF on white, the pair the client
 * itself uses. The light value is scoped to the same `data-theme` attribute the
 * root layout writes before first paint, so there is no flash of the wrong one.
 */
const ACTIVE_INK = "text-[#0A84FF] [:root[data-theme=light]_&]:text-[#007AFF]";
const IDLE_INK = "text-[var(--island-muted)]";

/**
 * Icon over label, 23px and 10.5px, 3px apart: 36.5px of content centred in
 * 56px of capsule. The label size is written as `max-md:` rather than as a bare
 * `text-[10.5px]` on purpose — the phone font floor in globals.css lifts any
 * bare sub-13px utility to 13px and steps aside only for a call site that has
 * already decided its own phone size, which a tab label at iOS proportions has.
 * No base size is needed because the dock does not exist above `md`.
 */
const ITEM = "flex h-full min-w-[44px] flex-1 flex-col items-center justify-center gap-[3px] px-0.5";
const ITEM_LABEL = "max-w-full truncate leading-none font-medium max-md:text-[10.5px]";

function tabActive(pathname: string, tab: Tab): boolean {
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function MobileNav({ model, summary }: { model: NavModel; summary: ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const tabList = tabs(t);
  const open = useNavStore((state) => state.sheet);
  const openSheet = useNavStore((state) => state.openSheet);
  const closeSheet = useNavStore((state) => state.closeSheet);
  const showPalette = useCommandPaletteStore((state) => state.show);
  // Only ever true inside a real Telegram client — see [[useMainButtonStore]].
  // In a browser the stand-in action bar is already positioned above the dock,
  // so there is nothing to get out of the way of.
  const mainButtonUp = useMainButtonStore((state) => state.visible);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSheet();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeSheet]);

  // Whatever the tabs do not carry — today that is Analitika, which is read as
  // part of "Bosh" but still deserves a row that says its own name.
  const spillover = model.primary.filter((item) => !tabList.some((tab) => tab.href === item.href));
  const inSheet = [...spillover, ...model.more.items, ...model.utility];
  // Exactly one lit tab, always. Analitika used to be *covered* by "Bosh" and
  // also listed in the sheet, which lit both at once — a tab bar that says the
  // reader is in two places. A tab that owns the route wins; "Yana" answers for
  // everything no tab owns.
  const onTab = tabList.some((tab) => tabActive(pathname, tab));
  const sheetActive = open || (!onTab && inSheet.some((item) => isNavItemActive(pathname, item)));

  return (
    <>
      {/*
        The dock floats clear of all three edges instead of being welded to the
        bottom one: `--island-inset` at the sides, and the same 12px above
        whatever the home indicator claims, read the way `.oq-safe-bottom` reads
        it so Telegram fullscreen and a plain browser both land right.

        `absolute`, not `fixed` — the shell is sized to Telegram
        `viewportStableHeight`, so a dock positioned inside it rides up when the
        on-screen keyboard opens instead of ending up underneath it.

        `pointer-events-none` on the row and back on for each capsule: the row
        spans the full width but only two parts of it are drawn, and the 8px gap
        between them belongs to the page scrolling underneath, not to a
        transparent box that would swallow the tap.
      */}
      <div
        // `aria-hidden` and not just translated away: while the client's
        // MainButton is up the dock is not merely off-screen, it is out of the
        // conversation, and a screen reader should not offer destinations that
        // are not on offer.
        aria-hidden={mainButtonUp || undefined}
        className={cn(
          "pointer-events-none absolute z-40 flex gap-2 md:hidden",
          "inset-x-[var(--island-inset)] bottom-[calc(max(var(--tg-inset-bottom,0px),env(safe-area-inset-bottom))_+_12px)]",
          "transition-[transform,opacity] duration-200 ease-[var(--ease-standard)]",
          // Slides out rather than popping. `--oq-tabbar` deliberately does not
          // change with it: the page must not reflow because a save bar
          // appeared, and inside Telegram that reserved strip is exactly the
          // clearance the client's own button wants.
          mainButtonUp && "pointer-events-none translate-y-[calc(100%+24px)] opacity-0",
        )}
      >
        <nav
          data-bottom-nav
          aria-label={t.chrome.mainNav}
          className={cn(CAPSULE, "pointer-events-auto flex min-w-0 flex-1 px-1")}
        >
          {tabList.map((tab) => {
            const active = tabActive(pathname, tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => haptic("light")}
                aria-current={active ? "page" : undefined}
                // Named outright rather than left to the label underneath. The
                // label is `truncate` inside a ~68px share of the dock, and a
                // name computed from clipped text is a name at the mercy of the
                // screen width — the same reason `NavLinkRow` carries a `title`.
                aria-label={tab.label}
                className={cn(ITEM, active ? ACTIVE_INK : IDLE_INK)}
              >
                <Icon name={tab.icon} size={23} weight={active ? "fill" : "regular"} />
                <span className={ITEM_LABEL}>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              haptic("light");
              openSheet();
            }}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={t.chrome.tabs.more}
            className={cn(ITEM, "cursor-pointer", sheetActive ? ACTIVE_INK : IDLE_INK)}
          >
            <Icon name="dots-three" size={23} weight={sheetActive ? "fill" : "regular"} />
            <span className={ITEM_LABEL}>{t.chrome.tabs.more}</span>
          </button>
        </nav>

        {/*
          Search is a verb, not a destination, so it sits outside the <nav> and
          outside the dock, in a circle of its own. It is also the one control
          down here that acts on the screen rather than leaving it, which is why
          it takes the press shrink the tabs do not: a tab is acknowledged by the
          page that arrives, and a palette that opens over the top has to say
          something for itself at the moment of the tap.
        */}
        <button
          type="button"
          onClick={() => {
            haptic("light");
            showPalette();
          }}
          aria-label={t.chrome.search}
          className={cn(
            CAPSULE,
            IDLE_INK,
            "oq-press pointer-events-auto flex w-[56px] flex-none cursor-pointer items-center justify-center",
          )}
        >
          <Icon name="magnifying-glass" size={23} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col justify-end md:hidden">
          <div aria-hidden onClick={closeSheet} className="absolute inset-0 bg-neutral-950/70 backdrop-blur-[2px]" />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.chrome.tabs.more}
            /*
             * `bg-overlay`, not `bg-surface`. `--color-surface` is a 5% tint —
             * the fill that lifts a card off the page it is lying on — and this
             * is not lying on the page, it is covering it. At 5% the page came
             * straight through: the floating blue "Bot ulash" button sat over
             * the "Integratsiyalar" and "Sozlamalar" rows, which reads as a
             * z-index bug and is in fact a see-through cover. `--color-overlay`
             * exists for exactly this and says so where it is defined.
             */
            className="animate-sheet relative flex max-h-[85dvh] flex-col rounded-t-[22px] bg-overlay"
          >
            {/* Says "this came from the bottom edge and goes back there". */}
            <span aria-hidden className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-neutral-700" />

            <div className="flex flex-none items-center gap-2 px-4 py-3">
              <span className="t-headline flex-1">{t.chrome.tabs.more}</span>
              <IconButton icon="x" label={t.chrome.close} size={32} className="oq-tap relative" onClick={closeSheet} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-[calc(14px_+_env(safe-area-inset-bottom))]">
              <SheetRow icon="magnifying-glass" label={t.chrome.search} onClick={() => { closeSheet(); showPalette(); }} />

              {spillover.map((item) => (
                <SheetLink key={item.href} item={item} pathname={pathname} onNavigate={closeSheet} />
              ))}

              {model.projects && (
                <>
                  <SheetLabel>{model.projects.label}</SheetLabel>
                  {model.projects.items.map((item) => (
                    <SheetLink key={item.href} item={item} pathname={pathname} onNavigate={closeSheet} />
                  ))}
                </>
              )}

              <SheetLabel>{t.chrome.sheetWorkspace}</SheetLabel>
              {model.more.items.map((item) => (
                <SheetLink key={item.href} item={item} pathname={pathname} onNavigate={closeSheet} />
              ))}
              {model.utility.map((item) => (
                <SheetLink key={item.href} item={item} pathname={pathname} onNavigate={closeSheet} />
              ))}

              {/* Who you are working as, and the switcher — the sidebar's footer
                  has no other home at this width. */}
              <div className="mt-1">{summary}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SheetLabel({ children }: { children: ReactNode }) {
  return (
    <div className="t-footnote t-secondary px-4 pt-3 pb-1">{children}</div>
  );
}

const rowClass =
  "flex min-h-[48px] w-full items-center gap-3 rounded-[12px] px-3 text-left text-[17px] transition-colors";

function SheetLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isNavItemActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        rowClass,
        active
          ? "bg-accent-800 text-accent-200"
          : item.accent
            ? "bg-neutral-850 text-accent-300"
            : "bg-neutral-850 text-neutral-200",
      )}
    >
      {item.icon ? (
        <Icon name={item.icon} size={18} className="flex-none" />
      ) : (
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-neutral-600" />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
    </Link>
  );
}

function SheetRow({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(rowClass, "cursor-pointer bg-neutral-850 text-neutral-200")}>
      <Icon name={icon} size={18} className="flex-none" />
      <span className="min-w-0 flex-1 truncate">{label}</span>

    </button>
  );
}
