"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closeTopDialog, hasOpenDialog, subscribeDialogs } from "@/components/ui/Modal";
import { paintTelegramChrome, syncTelegramTheme } from "./theme";
import { call, haptic, whenReady, type TelegramWebApp } from "./webapp";

/**
 * Screens that are the bottom of the stack — from here, back means leave.
 *
 * A path belongs here only while the navigation can put somebody on it without
 * a previous screen. `/contacts` was on this list and came off it when the
 * sidebar row did: it is now reached from a link or from ⌘K, so it always has
 * something behind it, and offering "leave the app" instead of "go back" would
 * strand the reader with only Telegram's close button.
 */
const ROOT_PATHS = new Set(["/dashboard", "/bots", "/flows", "/login", "/signup"]);

/**
 * The part of this application that is not the studio.
 *
 * Nothing is, today. `/webapp/<botId>` was — a bot's own Mini App, opened by a
 * *customer* from a chat, sharing this document and needing two of the five
 * controls below switched off: Telegram's gear would have pushed somebody with
 * no account into the panel's settings, and its back arrow would have offered
 * to navigate a stack of one page.
 *
 * The route is gone and this returns false everywhere. It is kept rather than
 * unpicked because the distinction it draws is real and outlives the one route
 * that needed it: this document is also served to people who are not signed in
 * to anything, and the next such surface will need exactly these two controls
 * off. Unpicking it means threading the same condition back through three
 * effects.
 */
function isCustomerSurface(pathname: string): boolean {
  return pathname === "/webapp" || pathname.startsWith("/webapp/");
}

/**
 * Makes the app behave like a Telegram Mini App rather than a website that
 * happens to be open inside one.
 *
 * Five things, none of which the page can do for itself:
 *
 * - **Tells the client we are painted.** Until `ready()` Telegram holds its own
 *   loading screen over ours, so this is what ends the double spinner.
 * - **Takes the whole sheet.** A Mini App opens at half height and stays there
 *   unless it asks; `disableVerticalSwipes` then stops a scroll gesture inside
 *   our list from being read as "drag the sheet closed".
 * - **Paints Telegram's own chrome to match.** The header and the background
 *   behind the bounce belong to the client, not to us, and a light strip above
 *   a dark app is the giveaway that nobody wired this up.
 * - **Publishes the insets.** On a fullscreen Mini App the client's own close
 *   button sits over our header; `--tg-inset-top` is what our layout offsets by.
 * - **Wires the client's back button.** Telegram draws one at the top left, and
 *   an app that ignores it leaves the reader with a button that does nothing.
 *
 * Renders nothing, and does nothing at all in an ordinary browser.
 */
export function TelegramWebAppBridge() {
  const router = useRouter();
  const pathname = usePathname();

  // Set once the SDK has landed, so the second effect re-runs with an API to
  // talk to rather than having missed its only chance.
  const [app, setApp] = useState<TelegramWebApp | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void whenReady().then((ready) => {
      // The SDK defines `window.Telegram.WebApp` in any browser once its
      // script runs; only a signed `initData` says we are actually inside a
      // client. Without this check the bridge repainted ordinary visitors'
      // theme with Telegram's defaults.
      if (!cancelled && ready?.initData) setApp(ready);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const customerSurface = isCustomerSurface(pathname);

  useEffect(() => {
    if (!app) return;

    document.documentElement.dataset.tgPlatform = app.platform;
    app.ready();
    app.expand();

    call("7.7", (tg) => tg.disableVerticalSwipes());

    const paint = () => {
      try {
        if (!localStorage.getItem("oqim:theme")) {
          if (app.colorScheme === "light") document.documentElement.dataset.theme = "light";
          else delete document.documentElement.dataset.theme;
        }
      } catch {
        // Storage can be walled off inside a webview; the default theme stands.
      }
      // Light/dark first, then the reader's actual colours over the top of it:
      // `syncTelegramTheme` writes onto the same `:root` the `data-theme` block
      // targets, and inline styles win, so the order here is the whole
      // difference between following the client and approximating it.
      syncTelegramTheme();
      paintTelegramChrome();
    };
    paint();

    const applyInsets = () => {
      const root = document.documentElement.style;
      const inset = app.contentSafeAreaInset ?? app.safeAreaInset;
      root.setProperty("--tg-inset-top", `${inset?.top ?? 0}px`);
      root.setProperty("--tg-inset-bottom", `${app.safeAreaInset?.bottom ?? 0}px`);
      // The sheet's height is not the window's: `viewportStableHeight` excludes
      // the on-screen keyboard, which is what a full-height panel must size to.
      root.setProperty("--tg-viewport", `${app.viewportStableHeight || window.innerHeight}px`);
    };
    applyInsets();

    app.onEvent("themeChanged", paint);
    app.onEvent("viewportChanged", applyInsets);
    app.onEvent("safeAreaChanged", applyInsets);
    app.onEvent("contentSafeAreaChanged", applyInsets);

    // Telegram draws a gear in its own menu; wiring it means the reader who
    // opens it lands on our settings instead of on nothing at all.
    const openSettings = () => {
      haptic("light");
      router.push("/settings");
    };
    if (!customerSurface) {
      call("6.10", (tg) => {
        tg.SettingsButton.onClick(openSettings);
        tg.SettingsButton.show();
      });
    }

    return () => {
      call("6.10", (tg) => {
        tg.SettingsButton.offClick(openSettings);
        tg.SettingsButton.hide();
      });
      app.offEvent("themeChanged", paint);
      app.offEvent("viewportChanged", applyInsets);
      app.offEvent("safeAreaChanged", applyInsets);
      app.offEvent("contentSafeAreaChanged", applyInsets);
    };
  }, [app, customerSurface, router]);

  // A sheet on screen changes what "back" means, so the button re-decides on
  // every open and close as well as on every navigation.
  const dialogOpen = useSyncExternalStore(subscribeDialogs, hasOpenDialog, () => false);

  // The back button belongs to the current route, so it is re-decided on every
  // navigation rather than wired once.
  useEffect(() => {
    if (!app) return;

    const goBack = () => {
      haptic("light");
      // Peel the innermost sheet first — the reader pressing back over a step
      // editor wants the step closed, not the whole flow gone from under it.
      if (closeTopDialog()) return;
      router.back();
    };

    if ((ROOT_PATHS.has(pathname) || customerSurface) && !dialogOpen) {
      app.BackButton.hide();
      return;
    }

    app.BackButton.onClick(goBack);
    app.BackButton.show();
    return () => {
      app.BackButton.offClick(goBack);
      app.BackButton.hide();
    };
  }, [app, customerSurface, dialogOpen, pathname, router]);

  return null;
}
