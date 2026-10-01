"use client";

import { useEffect, useRef, useState } from "react";
import { askConfirm } from "@/components/ui/confirm-store";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils/cn";
import { useMainButtonStore } from "./main-button-store";
import { call, haptic, webApp, whenReady, type TelegramWebApp } from "./webapp";

/**
 * The screen's one primary action, in the place Telegram keeps it.
 *
 * Inside a Telegram client this renders *nothing*: it drives the client's own
 * MainButton — the wide button pinned below the sheet, outside the page, which
 * is where a Mini App reader looks for "Saqlash" or "Ulash" without being
 * taught to. Outside Telegram (an ordinary browser, or the desktop studio)
 * there is no such button, so the same call site draws one against the bottom
 * of the viewport instead.
 *
 * One per screen, which is the point: the audit found five filled blue buttons
 * competing on one page, and a component that can only exist once is the
 * cheapest way for that not to happen again. Every other action on the screen
 * becomes a list row or a plain text button.
 */
export function MainButton({
  text,
  onClick,
  disabled = false,
  loading = false,
  /** Hidden without unmounting — a save bar that only appears once a field changed. */
  visible = true,
  /**
   * Draw the browser stand-in inside the document instead of pinned to the
   * viewport. For a screen whose whole content is one short card: pinned, the
   * button ends up in the far corner of a 2000px window with a thousand empty
   * pixels between it and the field it submits, which reads as belonging to
   * the page rather than to the form. Long or scrolling screens keep the
   * pinned bar — that is what it is for. Inside Telegram this changes nothing:
   * the client draws its own button either way.
   */
  inline = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  visible?: boolean;
  inline?: boolean;
}) {
  const [app, setApp] = useState<TelegramWebApp | undefined>(undefined);
  // The click is read through a ref so re-rendering with a new closure does not
  // mean unsubscribing and resubscribing on the client's button every keystroke.
  const handler = useRef(onClick);
  useEffect(() => {
    handler.current = onClick;
  }, [onClick]);

  useEffect(() => {
    let cancelled = false;
    void whenReady().then((ready) => {
      if (!cancelled && ready?.initData) setApp(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!app) return;
    const button = app.MainButton;
    const fire = () => {
      haptic("medium");
      handler.current();
    };
    button.onClick(fire);
    return () => {
      button.offClick(fire);
      button.hide();
    };
  }, [app]);

  // Announced so the dock can step aside — see [[useMainButtonStore]] for why
  // there is no layout answer to this. Only inside a real client: in a browser
  // the stand-in bar below already sits clear of the dock.
  const announce = useMainButtonStore((state) => state.setVisible);
  useEffect(() => {
    if (!app) return;
    announce(visible);
    return () => announce(false);
  }, [app, visible, announce]);

  useEffect(() => {
    if (!app) return;
    const button = app.MainButton;
    button.setText(text);
    if (disabled || loading) button.disable();
    else button.enable();
    if (loading) button.showProgress(false);
    else button.hideProgress();
    if (visible) button.show();
    else button.hide();
  }, [app, text, disabled, loading, visible]);

  // Inside Telegram the button is the client's, drawn outside our document.
  if (app || !visible) return null;

  const button = (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => {
        haptic("medium");
        onClick();
      }}
      className={cn(
        // Deliberately *not* `.oq-island`: that class sets its own background
        // and would beat the accent fill, turning the screen's one action into
        // another piece of glass. It borrows the geometry of the dock beside it
        // and nothing else.
        "oq-press t-headline flex h-[56px] w-full cursor-pointer items-center justify-center gap-2 rounded-[28px] bg-accent-700 text-white shadow-lg",
        // A button, not a bar: on a desktop it hugs its own label rather than
        // stretching across the window.
        "md:h-11 md:w-auto md:rounded-[12px] md:px-6 md:text-[15px]",
        "disabled:cursor-default disabled:opacity-40",
      )}
    >
      {/*
        The label stays and a spinner joins it. It used to be replaced by a lone
        "…", which at 40% opacity is a button that looks broken rather than busy
        — and a reader who reads it that way presses again. The press is already
        harmless (`disabled` covers the second one), but "harmless" is not the
        same as "legible".
      */}
      {loading && <Spinner size={17} className="md:h-3.5 md:w-3.5" />}
      {text}
    </button>
  );

  // In the document, where the form is. Full width on a phone — the thumb
  // reaches a wide target more reliably than a small one — and its own width
  // from `md` up, where the pointer is precise and a stretched button only
  // makes the card look empty.
  if (inline) return <div className="flex md:contents">{button}</div>;

  return (
    <>
      {/* Reserves the strip the fixed bar covers, so the last row of a list is
          not permanently underneath it. Phone only: on a desktop the button is
          a small thing in the corner, not a bar across the bottom. */}
      <div aria-hidden className="h-[88px] md:hidden" />
      {/* A capsule, not a full-width footer: it sits directly above the floating
          dock, and a bordered strip stacked on a floating capsule reads as two
          design languages at once. Above `md` `.oq-actionbar` spans the window
          again, where there is no dock and a footer is the right shape. */}
      <div className="oq-actionbar z-30">{button}</div>
    </>
  );
}

/**
 * "Are you sure?", asked by the client.
 *
 * Telegram draws a native confirmation over the whole app; a dialog of our own
 * inside the sheet reads as part of the page it is asking about, which is
 * exactly the wrong thing for an action nobody can undo. That is still the
 * first choice, and inside Telegram it is the only one.
 *
 * Outside Telegram this used to be `window.confirm`, on the same reasoning —
 * native, and not ours. The reasoning was right and the mechanism was not: a
 * browser may decline to draw that dialog and the call returns anyway, so the
 * caller reads an answer nobody gave. "Loyihani o'chirish" went straight through
 * to the delete with no question asked. `askConfirm` is a dialog this app draws
 * itself, which is worse-looking and cannot be skipped.
 */
export function confirmAction(message: string, confirmText = "Davom etish"): Promise<boolean> {
  const app = webApp();
  if (!app?.initData) {
    return askConfirm({ message, confirmText, destructive: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    call("6.2", (tg) =>
      tg.showConfirm(message, (confirmed) => {
        haptic(confirmed ? "medium" : "light");
        done(confirmed);
      }),
    );
    // A client too old for `showConfirm` never calls back, and an unanswered
    // promise is a button that silently does nothing.
    setTimeout(() => {
      if (!settled && !app.isVersionAtLeast("6.2")) {
        askConfirm({ message, confirmText, destructive: false }).then(done);
      }
    }, 0);
  });
}

/**
 * The same question with a destructive answer marked as one — red, and second,
 * so the reflex tap is the one that cancels.
 */
export function confirmDestructive(params: {
  title?: string;
  message: string;
  /** The label on the red button; "Bekor qilish" is always the other one. */
  confirmText: string;
}): Promise<boolean> {
  const app = webApp();
  if (!app?.initData) {
    return askConfirm({ ...params, destructive: true });
  }
  if (!app.isVersionAtLeast("6.2")) return confirmAction(params.message, params.confirmText);
  return new Promise((resolve) => {
    call("6.2", (tg) =>
      tg.showPopup(
        {
          title: params.title,
          message: params.message,
          buttons: [
            { id: "cancel", type: "cancel" },
            { id: "go", type: "destructive", text: params.confirmText },
          ],
        },
        (id) => {
          haptic(id === "go" ? "heavy" : "light");
          resolve(id === "go");
        },
      ),
    );
  });
}
