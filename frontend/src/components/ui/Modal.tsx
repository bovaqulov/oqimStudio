"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { cn } from "@/lib/utils/cn";

/** Everything the browser would hand a Tab press, in document order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every dialog currently open, innermost last. Both listeners of a nested pair
 * sit on `window`, and `stopPropagation` does not silence a sibling listener on
 * the same target — so which dialog owns Escape and Tab is decided here
 * instead: the top of the stack, and only it.
 */
const openDialogs: { id: symbol; close: () => void }[] = [];

/** Fires whenever a dialog opens or closes — what the Telegram bridge watches. */
const dialogListeners = new Set<() => void>();

function notifyDialogListeners(): void {
  for (const listener of dialogListeners) listener();
}

export function subscribeDialogs(listener: () => void): () => void {
  dialogListeners.add(listener);
  return () => {
    dialogListeners.delete(listener);
  };
}

export function hasOpenDialog(): boolean {
  return openDialogs.length > 0;
}

/**
 * Closes the innermost open dialog — `false` when there is none.
 *
 * This is Escape, for callers that are not a keyboard: inside Telegram the
 * client's own back arrow must peel one layer, not navigate the page the
 * dialog is standing on out from under it.
 */
export function closeTopDialog(): boolean {
  const top = openDialogs[openDialogs.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/**
 * Centered overlay dialog. Closes on Escape or a backdrop click, locks body
 * scroll while open so the page behind cannot drift, and keeps Tab inside
 * itself — a dialog that leaks focus back to the canvas behind it strands a
 * keyboard user on controls they cannot see.
 *
 * On a phone it is a full-screen sheet instead — the one window shape the
 * product has there (`MOBILE.md` §4). A centred dialog is a window onto a page
 * you can still see around; on a 390px screen there is no "around" — the dialog
 * covers everything anyway, and pretending otherwise only spends the width on a
 * backdrop and rounds off corners nobody can see.
 *
 * The sheet draws the grab handle, takes the full `100dvh` and keeps its bottom
 * clear of the home indicator; what pins a title row and an action bar is the
 * flex column, so a caller gets both for free by laying itself out the way they
 * all already do:
 *
 *   header  `flex-none`
 *   body    `min-h-0 flex-1 overflow-y-auto`
 *   footer  `flex-none`   — one primary action, and never a destructive one:
 *                           the bottom strip is where a thumb rests.
 *
 * A body that does not take `flex-1` still reads, but its footer stops halfway
 * up the screen instead of sitting at the bottom of it.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  className,
  detent = "full",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element naming the dialog, for screen readers. */
  labelledBy?: string;
  /**
   * How tall the phone sheet is.
   *
   * `full` is the default and the right shape for a sheet with a list, a form
   * or a conversation in it. `medium` sizes to its own content and sits against
   * the bottom edge with its corners showing — iOS's medium detent. A sheet
   * holding one text field does not need the whole screen, and taking it
   * leaves four fifths of the display empty above the thing being edited.
   */
  detent?: "full" | "medium";
  /**
   * Desktop geometry — the width cap, the corner it aligns to. A sheet that is
   * the whole screen has none of those, so on a phone it is deliberately not
   * applied rather than fought with a second class.
   */
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const phone = usePhoneViewport();

  /*
   * `onClose` through a ref, because the effect below must not re-run when it
   * changes identity.
   *
   * Most callers write `onClose={() => setX(false)}`, which is a new function
   * on every render of the component holding the dialog. With `onClose` in the
   * dependency list, any state change up there tore the trap down and built it
   * again — and the teardown ends `opener?.focus?.()`, the rebuild begins
   * `dialog?.focus()`. So a dialog containing a field that writes to a store
   * the opener also reads took exactly one character: the keystroke re-rendered
   * the parent, the effect cycled, and focus left the input for the dialog
   * itself. The field was never unmounted, which is why it looked like a
   * remount and was not one.
   *
   * The effect only ever *calls* `onClose` — for Escape, and for the dialog
   * stack `closeTopDialog` reads — so the latest one through a ref is the same
   * behaviour without the identity.
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    // Where focus came from, so closing the dialog puts it back rather than
    // dropping the caller at the top of the document.
    const opener = document.activeElement as HTMLElement | null;
    dialog?.focus();
    const id = Symbol("dialog");
    openDialogs.push({ id, close: () => closeRef.current() });
    notifyDialogListeners();

    function onKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1]?.id !== id) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null || item === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // Only the two edges need handling — in between, the browser's own order
      // is the right one and stays untouched.
      if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    }

    // Capture phase so the editor's own Escape shortcut does not also fire.
    window.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const index = openDialogs.findIndex((entry) => entry.id === id);
      if (index >= 0) openDialogs.splice(index, 1);
      notifyDialogListeners();
      // An outer dialog is still open, so the scroll lock it set stays in force.
      if (!openDialogs.length) document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm",
        // cn-override-ok: `phone` and `!phone` guard these two, so only one is
        // ever emitted. The check cannot see that a condition and its negation
        // are exclusive, and teaching it to would mean evaluating expressions.
        !phone && "items-center justify-center p-4",
        phone && detent === "medium" && "items-end",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Focus starts on the dialog itself rather than on its first control,
        // so a screen reader reads the title before the field.
        tabIndex={-1}
        className={cn(
          "flex w-full flex-col overflow-hidden bg-overlay",
          // `--tg-viewport` is Telegram's `viewportStableHeight` — the sheet
          // minus the on-screen keyboard. Sizing to it is what keeps a pinned
          // bottom row above the keyboard instead of under it; outside Telegram
          // the variable is unset and `100dvh` stands.
          phone
            ? detent === "medium"
              ? "animate-sheet max-h-[86%] rounded-t-[22px]"
              : "animate-sheet oq-viewport"
            : "animate-rise max-h-full rounded-[16px] shadow-lg",
          !phone && className,
        )}
        // `dvh` and not `vh`: a browser's own chrome slides in and out of the
        // viewport as the page scrolls, and `100vh` is the height it has when
        // that chrome is gone — which is exactly the strip a footer pinned to
        // the bottom disappears into. The inset keeps it clear of a phone's
        // home indicator too, and the sheet's own background fills the gap.
        style={phone ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
      >
        {/* Says "sheet" before a word is read, which is what tells somebody the
            screen they were on is still underneath rather than gone. Drawn
            here, once, so every dialog in the product wears the same one. */}
        {phone && (
          <div aria-hidden className="flex flex-none justify-center pt-2 pb-1">
            <span className="h-1 w-9 rounded-full bg-neutral-700" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
