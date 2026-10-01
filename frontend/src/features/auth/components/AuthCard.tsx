"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { AUTH_COPY } from "../messages";

/**
 * A plain accent text button — every clickable thing on these screens that is
 * not the one filled action: "Parolni unutdingizmi?", the switch between
 * sign-in and sign-up, "Qayta yuborish", "Kirishga qaytish".
 *
 * Exported rather than repeated because the 44px target is the part that kept
 * being dropped: written inline, a link in a sentence is 18px tall and a finger
 * misses it. One size for all of them (15px) is also what keeps the single
 * 17px filled button reading as the screen's action.
 */
export const authLinkClasses =
  "oq-press t-subhead inline-flex min-h-11 cursor-pointer items-center rounded-[8px] px-1 text-accent-400";

/** The centred column, shared by the card and by the skeleton that stands in for it. */
const shellClasses = "flex min-h-svh w-full flex-col items-center justify-center gap-5 px-4 py-10";

/*
 * The card.
 *
 * Glass on true black, not a panel: `.oq-island` is the same fill and the same
 * half-pixel hairline the app's floating chrome is made of, so the one screen a
 * signed-out visitor sees is built from the same material as the app behind it.
 * What it replaces is an opaque `bg-surface` box with a `shadow-md` under it —
 * a shadow that is invisible on #000 and a hard edge that is wrong on #fff.
 *
 * At the 16px card radius rather than the 20px chrome radius: this is content
 * the reader works inside, not a capsule floating over a scrolling page.
 */
const cardClasses = "oq-island w-full rounded-[16px] p-5 sm:p-6";

/** Logo and wordmark, at a 44px target because it is a link home. */
function BrandMark() {
  return (
    <Link
      href="/"
      aria-label={`${AUTH_COPY.brand.name} ${AUTH_COPY.brand.suffix}`}
      className="oq-press flex min-h-11 items-center gap-2.5 px-2"
    >
      <span
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
        style={{ background: "linear-gradient(180deg, var(--color-brand-from), var(--color-brand-to))" }}
      >
        <Icon name="flow-arrow" size={17} weight="fill" className="text-white" />
      </span>
      {/* One line, at a size a phone can read. The 10px uppercase "STUDIO"
          that used to sit under the name was the smallest text in the app. */}
      <span className="t-headline text-text">
        {AUTH_COPY.brand.name} {AUTH_COPY.brand.suffix}
      </span>
    </Link>
  );
}

/**
 * The single-column shell every auth screen renders into: logo, one card,
 * nothing else. No sidebar and no dashboard chrome — the only decision on
 * these pages is the form in front of you.
 *
 * There is deliberately no `subtitle` any more. Every one of them restated the
 * title in a sentence ("Ish maydoningizga kiring va oqimlarni davom ettiring."
 * under "Kirish"), which is a paragraph the reader has to get past to reach the
 * first field. What a screen wants is said by its title, its labels and its
 * button; a screen that genuinely needs a sentence puts it on a field's (i).
 */
export function AuthCard({
  title,
  children,
  footer,
  shakeKey = 0,
  width = 420,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Bumped by `useAuthForm` on every rejected submit. */
  shakeKey?: number;
  width?: number;
}) {
  const cardRef = useRef<HTMLElement>(null);

  /*
   * Replaying the shake without remounting the card.
   *
   * This used to be a React `key` on the card, which does replay the animation
   * — by throwing away the whole form and building it again. That takes the
   * focus `useAuthForm` has just moved to the first bad field (the one thing a
   * keyboard user has to have after a rejected submit) along with the reveal
   * toggle's own state. Dropping the class, reading a layout property to flush
   * the change, and putting it back restarts the same animation on the same
   * DOM node.
   */
  useEffect(() => {
    const node = cardRef.current;
    if (!node || shakeKey === 0) return;
    node.classList.remove("animate-shake");
    node.getBoundingClientRect();
    node.classList.add("animate-shake");
  }, [shakeKey]);

  return (
    <div className={shellClasses}>
      <BrandMark />

      <main
        ref={cardRef}
        className={cn(cardClasses, shakeKey > 0 && "animate-shake")}
        style={{ maxWidth: width }}
      >
        <h1 className="t-title2 m-0 mb-5">{title}</h1>
        {children}
      </main>

      {footer && (
        <div className="t-subhead t-secondary flex max-w-[420px] flex-wrap items-center justify-center gap-x-1.5 text-center">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * What stands on the screen while the sign-in card is still being rendered.
 *
 * The pages await the Telegram widget's configuration from the backend, which
 * is a round trip nobody should watch a blank page for — so the shell streams
 * first and this holds its place. Same column, same card, same proportions, so
 * the real form does not move anything when it arrives; the blocks breathe the
 * way `TelegramWebAppGate`'s skeleton does, so both loading states read as one
 * product.
 */
export function AuthCardSkeleton({ fields = 2, width = 420 }: { fields?: number; width?: number }) {
  return (
    <div className={shellClasses} aria-busy aria-label={AUTH_COPY.common.loading}>
      <BrandMark />

      <div className={cn(cardClasses, "flex flex-col gap-4")} style={{ maxWidth: width }}>
        {/* Title, then one block per label-and-field pair (13 + 8 + 44 ≈ 64),
            then the submit at its own 48. */}
        <div className="animate-pulse-soft h-7 w-2/5 rounded-[8px] bg-surface" />
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="animate-pulse-soft h-16 rounded-[12px] bg-surface" />
        ))}
        <div className="animate-pulse-soft h-12 rounded-[12px] bg-surface" />
      </div>

      <div className="animate-pulse-soft h-5 w-48 rounded-[8px] bg-surface" />
    </div>
  );
}
