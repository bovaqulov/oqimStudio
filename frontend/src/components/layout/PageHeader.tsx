import Link from "next/link";
import { Children, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { notificationsRepository } from "@/features/notifications/data/notifications-repository";
import { getSession } from "@/features/workspace/session";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";
import { backTarget, Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import { HeaderMenu } from "./HeaderMenu";
import { HelpButton } from "./HelpButton";
import { MENU_ROW_CLASS } from "./menu-row";
import { NavMenuButton } from "./NavMenuButton";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The glass the top of the screen is made of: 40px tall, fully round, the same
 * `.oq-island` as the dock at the bottom and deliberately lighter than its 56px
 * — the dock is where the thumb lives and the bar is what it reads past, so the
 * two ends of the screen read as one system at two weights rather than as two
 * panels that happen to be round. Sharing the string is what stops the capsules
 * up here drifting apart the next time one of them is touched.
 */
const ISLAND = "oq-island pointer-events-auto flex h-10 flex-none items-center rounded-[var(--island-radius)]";

/**
 * A 36px icon button inside a 40px capsule.
 *
 * `IconButton` draws itself 44px square below `md` and cannot know it has been
 * put inside a capsule, where 44px bursts the glass. The size is taken back from
 * the parent — the bell lives in `features/notifications` and has no prop for
 * this — and `oq-tap`, which both triggers already carry, puts the 44px target
 * back as a pseudo-element that overflows the glass without changing a pixel of
 * what is drawn. A descendant selector is what makes that possible at all: it
 * outranks the utility on the button itself, which a second class in the same
 * `class` attribute would not.
 *
 * `> div > button` rather than `button`: both triggers hang their popover inside
 * the same wrapper, and a rule that reached into those would shrink every row of
 * the menu along with the button that opens it.
 */
const CAPSULE_TRIGGERS = "max-md:[&>div>button]:size-9";

export async function PageHeader({
  title,
  subtitle,
  /** Where this page sits. Rendered above the title so every screen states its own path. */
  breadcrumbs,
  actions,
  /** Actions that only ever live behind "⋯" — an export, a rarely-used switch. */
  menuActions,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  menuActions?: ReactNode;
}) {
  const t = await getT();
  const { user, workspace } = await getSession();
  const notifications = await notificationsRepository.list(workspace.id);
  // The same trail the breadcrumbs draw, read for the one thing a phone needs
  // from it: where "back" goes. Both readers land on the same cached project
  // layer, so asking twice costs one request rather than two.
  const back = await backTarget(breadcrumbs);

  // 390px fits one action next to a bot name. The rest are not dropped — they
  // move under "⋯", where a phone can still reach them and a desktop never
  // has to look.
  const [primaryAction, ...overflowActions] = Children.toArray(actions);

  return (
    /*
     * Two headers, one component. From `md:` up this is the bar it has always
     * been: a full-width row with a hairline under it, welded to the top of the
     * page. Below `md` it is three separate things floating over the page — a
     * back button (or the page's one action), the title, and the cluster of
     * utilities — with the content scrolling underneath. That is what the blur
     * is for; glass over an opaque strip is just a bar with round corners.
     *
     * `pointer-events-none` on the row and back on for each capsule: the row
     * spans the full width but only three parts of it are drawn, and the gaps
     * between them belong to the page scrolling underneath, not to a transparent
     * box that would swallow the tap.
     *
     * `oq-island-top` unprefixed, with only `md:pb-1.5` to go with it: where
     * there is no safe area and no Telegram inset the class resolves to a plain
     * 6px, which is exactly the top padding the bar had before. One declaration
     * covers both shapes instead of two that have to be kept equal by hand.
     *
     * `z-30`, and a position to hang it on: this element's own backdrop-blur
     * makes it a stacking context, so without a z-index of its own the
     * notification popover inside it would be painted under the page content
     * that follows it in the DOM. Below `md` it goes one higher, because the
     * section-tab strip (`.oq-island-tabs`) is also fixed at `z-30` and comes
     * later in the DOM — at equal weight it would paint its glass straight over
     * a popover hanging down from this bar. The dock is `z-40` and later still,
     * which is the right way round: nothing should cover the dock.
     */
    <header
      className={cn(
        "oq-island-top z-30 flex items-center",
        "max-md:pointer-events-none max-md:fixed max-md:inset-x-[var(--island-inset)] max-md:top-0 max-md:z-40 max-md:gap-2",
        "md:relative md:min-h-[52px] md:flex-none md:gap-3 md:border-b md:border-separator md:bg-overlay/70 md:px-[18px] md:pb-1.5 md:backdrop-blur-[20px] md:backdrop-saturate-150",
      )}
    >
      <NavMenuButton />

      {/* A phone draws no breadcrumbs and has no sidebar, so the trail has to
          become a control instead: the last crumb above this page that names
          somewhere to go is the only thing "back" can honestly mean, and it is
          drawn as the circle Telegram puts in the same corner. A screen with no
          such crumb — the dashboard, any tab destination — gets no back button
          at all, which is better than a chevron that pops the reader somewhere
          they never came from. */}
      {back && (
        <Link
          href={back.href}
          title={back.label}
          aria-label={t.chrome.back(back.label)}
          className={cn(ISLAND, "oq-press oq-tap relative w-10 justify-center text-accent-400 md:hidden")}
        >
          {/* The registry has no left caret, and a full arrow is a heavier mark
              than a navigation bar wants; the right one turned around is the
              chevron every phone reader already knows. */}
          <Icon name="caret-right" size={20} weight="bold" className="rotate-180" />
        </Link>
      )}

      {/*
        The title floats on nothing at all — no capsule, no scrim — which is the
        point of the shape and also the one thing on this row with content
        sliding under it. The halo is what makes it survive that: two blurred
        copies of the page's own background colour, so it thickens over a busy
        list, disappears over an empty one, and needs no second token to do it in
        the light theme.

        The avatar beside it is the workspace's, not the reader's — the profile
        link lives in the menu — because what a title needs at this size is the
        mark that says *whose* Bosh sahifa this is, which a phone has nowhere
        else to say now that the sidebar's footer is gone. It is a mark and not a
        control, so it is not a link and owes nobody a 44px target.
      */}
      <div className="flex min-w-0 flex-1 items-center gap-2 max-md:justify-center md:flex-col md:items-stretch md:gap-0">
        <Avatar name={workspace.name} size={28} className="md:hidden" />
        <div className="flex min-w-0 flex-col leading-tight">
          {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
          {/* The padding is the halo's room to exist: `truncate` means
              `overflow: hidden`, which clips a text-shadow at the line box, so
              the box is grown by 4px and the margin takes the 4px back. Nothing
              moves; the glow simply stops being cut off square. */}
          <span className="t-headline truncate max-md:-mx-1 max-md:-my-0.5 max-md:px-1 max-md:py-0.5 max-md:[text-shadow:0_1px_10px_var(--color-bg),0_0_4px_var(--color-bg)]">
            {title}
          </span>
          {/* Phone: the title alone. A gloss under every title on every screen is
              a line of chrome the reader pays for once per page. */}
          {subtitle && <span className="t-footnote t-tertiary hidden truncate md:block">{subtitle}</span>}
        </div>
      </div>

      <div className="flex flex-none items-center gap-1.5 md:gap-2">
        {/* `contents` so the wrapper that hides these below `md` does not
            become a flex item of its own at wider widths — the buttons keep
            the exact spacing they had before there was anything to hide. */}
        <div className="hidden md:contents">{primaryAction}</div>
        <div className="hidden md:contents">{overflowActions}</div>

        {/*
          The third floating element: one capsule around everything left over,
          which on a phone is the bell and the "⋯" and nothing else.

          `md:contents` is what lets a desktop keep the row it has. An element
          with `display: contents` generates no box at all, so the fill, the
          hairline and the blur are simply not painted, and the buttons inside
          become children of the cluster again at exactly the spacing they had.
        */}
        <div className={cn(ISLAND, CAPSULE_TRIGGERS, "gap-0 px-0.5 md:contents")}>
          {/* The page's one action, on the right, in the same capsule as the
              bell — where iOS puts "+" and where it cannot push the title off
              centre. It used to be a pill of its own on the left: a wide
              "+ Yangi oqim" there shoved the title halfway across the screen,
              and the left is where "back" lives anyway.

              Rendered here for a phone and again below for `md:` up, because
              flex `order` cannot lift a child out of the cluster it is nested
              in and promoting the desktop copy would change the spacing that
              row has today. `[&>*]:size-9` takes the caller's own 44px back
              inside the glass; `oq-tap` on their node puts the target back as a
              pseudo-element that overflows it. */}
          {primaryAction && (
            <div className="flex items-center max-md:[&>*]:size-9 max-md:[&>form>button]:size-9 md:hidden">
              {primaryAction}
            </div>
          )}
          <NotificationBell items={notifications} />
          <div className="hidden md:contents">
            <ThemeToggle />
            <HelpButton />
            {/* The avatar is the one header control with no icon to read — it says
                who is signed in, and clicking it lands on that account. */}
            <Link href="/settings" title={t.chrome.profileOf(user.name)} aria-label={t.chrome.profile}>
              <Avatar name={user.name} size={26} />
            </Link>
          </div>
          {/* Desktop keeps them in the open; a phone finds them here. */}
          {menuActions && <div className="hidden md:contents">{menuActions}</div>}
          <HeaderMenu>
            {(overflowActions.length > 0 || menuActions) && (
              <div className="flex flex-col gap-1 pb-1">
                {overflowActions}
                {menuActions}
              </div>
            )}
            <ThemeToggle variant="row" />
            <HelpButton variant="row" />
            <Link href="/settings" className={MENU_ROW_CLASS}>
              <Icon name="user-circle" size={17} className="flex-none text-neutral-500" />
              <span className="min-w-0 flex-1 truncate">{t.chrome.profile}</span>
            </Link>
          </HeaderMenu>
        </div>
      </div>
    </header>
  );
}
