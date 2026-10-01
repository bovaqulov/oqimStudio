"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * The header's overflow, phone only.
 *
 * A long bot name plus two buttons plus four utility icons does not fit 390px,
 * and what fell off the edge was the theme switch, help and the profile link.
 * They are all still here — one tap further in, which is the right depth for
 * controls nobody presses twice a day.
 *
 * This is the *only* "⋯" the header has: a screen's own overflow rows are
 * handed down as `menuActions` and land in the same sheet rather than beside it,
 * because two identical overflow buttons on one row is a coin toss for the
 * reader. It sits in the right-hand capsule, whose 36px trigger and 44px hit box
 * are set by `PageHeader`, and the panel below hangs off the glass rather than
 * out of it.
 */
export function HeaderMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex-none md:hidden">
      {/* 36 to match the bell beside it in the capsule; the 44px target `oq-tap`
          draws is a pseudo-element, so it overflows the glass instead of
          stretching it. */}
      <IconButton
        icon="dots-three"
        label={t.chrome.moreActions}
        size={36}
        active={open}
        className="oq-tap relative"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        // Anything pressed in here has done its job by the time the click
        // bubbles out, so the menu can close on the way past.
        //
        // Opaque, and the one piece of chrome up here that is: a list of rows
        // has to be read, not glimpsed through. What it does borrow from the
        // capsule it hangs from is the gap (it floats clear of the glass rather
        // than growing out of it), the corner radius and `--color-separator`,
        // which is a hairline in either theme — the neutral border it used to
        // carry was a dark-theme value that disappeared in the light one.
        //
        // The width is capped against the viewport — 240px plus the 12px the
        // capsule is inset by is already over the edge of a 320px screen — in
        // the same shape the notification panel next to it uses, so the two
        // popovers cannot disagree about where the edge is.
        <div
          onClick={() => setOpen(false)}
          className="animate-rise absolute top-full right-0 z-40 mt-2.5 flex w-[min(240px,calc(100vw-24px))] flex-col gap-1 rounded-[16px] border border-separator bg-overlay p-1.5 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
