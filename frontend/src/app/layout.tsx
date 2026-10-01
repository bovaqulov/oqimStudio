import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GlobalShortcuts } from "@/components/layout/GlobalShortcuts";
import { HelpDialog } from "@/components/layout/HelpDialog";
import { InlineScript } from "@/components/layout/InlineScript";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ToastViewport } from "@/components/ui/Toast";
import { TelegramWebAppBridge } from "@/lib/telegram/TelegramWebAppBridge";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Oqim Studio",
  description: "Telegram bot avtomatlashtirish va vizual oqim muharriri.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * `lang` is not decoration: it is what a screen reader picks a voice from and
   * what the browser hyphenates and spell-checks by, so a Russian interface
   * declared as Uzbek is read aloud in the wrong accent. It says the language
   * alone — the region in the stored tag ("ru-RU") tells a pronunciation
   * nothing it does not already know.
   *
   * Resolved here rather than in `(app)/layout.tsx` because `<html>` is drawn
   * here and nowhere else. `getLocale` answers without a redirect and without a
   * request for a signed-out visitor, which is what lets the sign-in screens —
   * which are still Uzbek — go through the same element.
   */
  const locale = await getLocale();

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint: without it the page renders dark and then
          jumps to light on hydration for anyone who chose light.
        */}
        <InlineScript html="try{var t=localStorage.getItem('oqim:theme');if(t==='light')document.documentElement.dataset.theme='light';}catch(e){}" />
        {/*
          Same reason, one column narrower: a reader who collapsed the sidebar
          would otherwise get the full 228px one until hydration and then watch
          the page jump sideways under it. The attribute is what `globals.css`
          draws the rail from — see the "Sidebar rail" block there, and
          `nav-store.ts` for the half that writes it back.
        */}
        <InlineScript html="try{if(localStorage.getItem('oqim:rail')==='1')document.documentElement.dataset.rail='1';}catch(e){}" />
        {/*
          Same reason, one screen further: inside Telegram the login form is
          never shown, and finding that out after hydration means showing it
          first. Telegram puts `tgWebAppData` in the launch URL's hash and older
          clients inject `TelegramWebviewProxy`, both readable here. It is only
          a guess — the gate checks `initData` properly and undoes this if the
          guess was wrong.
        */}
        <InlineScript html="try{if(window.TelegramWebviewProxy||location.hash.indexOf('tgWebAppData')>-1)document.documentElement.dataset.tg='1';}catch(e){}" />
        {/*
          Telegram's SDK, and the one place that decides whether this document
          gets it at all.

          It used to be a plain `<script async src>` on every route, which is
          how an ordinary visitor to the login screen ended up fetching 116KB
          from telegram.org and reading six `[Telegram.WebView] > postEvent`
          lines in their console. Those lines are the SDK's own boot — a bare
          page with nothing on it but this tag prints the same six — so no
          amount of guarding at our call sites would have removed one of them.
          The guard has to be on the load.

          The condition is "could this document be inside a client", asked the
          only three ways it can be answered before the SDK exists: the launch
          fragment Telegram writes into the URL, the `TelegramWebviewProxy` an
          older client injects, and the SDK's own `sessionStorage` carry-over,
          which is what keeps a Mini App working after it has navigated away
          from the launch URL and been reloaded. Nothing else can be inside
          Telegram: without one of those there is no `initData`, so
          `webApp().initData` is empty, every gate in `lib/telegram` answers
          false, and the file would have been dead weight anyway.

          Appended rather than written as a tag, so the condition can run at
          all — but from the same position in the head, so the download still
          starts as the parser goes past. That budget matters: `whenReady`
          waits four seconds before concluding there is no client on the other
          side, and it has been missed on a phone connection once already.

          Loaded on every route rather than only the app shell, because a Mini
          App lands on the sign-in screens too and `TelegramWebAppBridge` has
          to call `ready()` there, or Telegram holds its own loading screen
          over ours. The sign-in itself does not depend on this file —
          `TelegramWebAppGate` reads the launch fragment directly, for the
          reason written there.
        */}
        <InlineScript html="try{var p=null;try{p=JSON.parse(sessionStorage.getItem('__telegram__initParams')||'null');}catch(e){}if(window.TelegramWebviewProxy||location.hash.indexOf('tgWebAppData')>-1||(p&&p.tgWebAppData)){var s=document.createElement('script');s.src='https://telegram.org/js/telegram-web-app.js';s.async=true;document.head.appendChild(s);}}catch(e){}" />
      </head>
      <body>
        {/*
          The provider is here rather than in the app shell because two of the
          things it has to reach are mounted here: the help dialog and the toast
          viewport are app-wide singletons, and a provider one layout further in
          would leave them speaking Uzbek to a reader who chose Russian. The
          sign-in screens sit inside it too and are untranslated for now — they
          read `AUTH_COPY`, which still holds one language.
        */}
        <LocaleProvider locale={locale}>
          {children}
          <ToastViewport />
          <ConfirmDialog />
          <HelpDialog />
          <GlobalShortcuts />
          <TelegramWebAppBridge />
        </LocaleProvider>
      </body>
    </html>
  );
}
