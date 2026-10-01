"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { hapticResult, initData, insideTelegram, webApp } from "@/lib/telegram/webapp";
import { telegramWebAppLoginAction } from "../actions";
import { landingPathFor, persistSession } from "../session-client";

/**
 * Signing in when the app was opened from inside Telegram.
 *
 * There is nothing to type and nothing to press. The client has already
 * established who this is and signed the claim with the bot's token, so the
 * only correct amount of login UI here is none: this posts the signed payload,
 * takes the session cookie back, and replaces itself with the app.
 *
 * Two things it deliberately does not do.
 *
 * It does not wait for `telegram-web-app.js`. The payload is in the launch
 * URL's fragment, written by the client before our first line of JavaScript
 * runs (see `initData`), so the sign-in can start on mount. Waiting for the SDK
 * is what broke this: on a slow connection the script missed a four-second
 * timeout, the gate concluded it was in an ordinary browser, and put an email
 * and password form in front of somebody Telegram had just identified.
 *
 * And it never falls back to that form. Inside a Mini App there is no browser
 * window, no password anybody was ever issued, and no second way in — so a
 * refused signature is an error with a retry, not an invitation to type.
 */
export function TelegramWebAppGate() {
  const router = useRouter();
  // The guard sends people here as `/login?next=…`; a Mini App opened on a
  // deep link should land where it was pointed, not on the dashboard.
  const next = useSearchParams().get("next");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const showPasswordForm = useCallback(() => {
    delete document.documentElement.dataset.tg;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // The pre-paint script guesses from the URL fragment. This is the same
      // question asked properly — and it does not need the SDK to answer,
      // because the fragment is the SDK's own source.
      if (!insideTelegram()) {
        // A guess that was wrong. Give the form back: this really is an
        // ordinary browser, and the form is the only way in there.
        showPasswordForm();
        return;
      }

      const result = await telegramWebAppLoginAction(initData());
      if (cancelled) return;

      if (!result.ok) {
        hapticResult("error");
        setFailed(true);
        return;
      }

      hapticResult("success");
      persistSession(result.data, true);
      // `startapp=` on the deep link that opened this. Unverified, but it only
      // chooses which of our own screens to land on, and `landingPathFor`
      // refuses anything that is not a same-origin path. Read from the SDK if
      // it has arrived by now and skipped if it has not: a start parameter
      // chooses a landing screen, and the sign-in must not wait on one.
      const startParam = webApp()?.initDataUnsafe.start_param;
      const target = next ?? (startParam ? `/${startParam.replace(/^\/+/, "")}` : null);
      router.replace(landingPathFor(result.data, target));
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, next, router, showPasswordForm]);

  if (failed) {
    return (
      <div className="oq-viewport flex flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-danger-fg">
          <Icon name="warning" size={26} />
        </span>
        <p className="t-headline m-0">Kirish amalga oshmadi</p>
        {/* What to do, not what went wrong: a signature the server refused is
            almost always a payload that has gone stale in a sheet left open,
            and reopening the bot mints a fresh one. */}
        <p className="t-subhead t-secondary m-0 max-w-[280px]">
          Telegramda botni qayta oching.
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
          className="oq-press t-body min-h-[44px] cursor-pointer px-2 text-accent-400"
        >
          Qayta urinish
        </button>
      </div>
    );
  }

  /*
   * A skeleton, not a spinner with a word under it.
   *
   * This is the first thing a Mini App shows and it should read as the app
   * arriving rather than as a process the reader is waiting on — the shapes are
   * the list that is about to be there. Telegram holds its own loading screen
   * over ours until `ready()`, so in practice most of this is never seen; what
   * it has to cover is the round trip that verifies the signature.
   */
  return (
    <div className="oq-viewport flex flex-col gap-3 px-4 pt-20" aria-busy aria-label="Kirilmoqda">
      <div className="animate-pulse-soft h-[92px] rounded-[16px] bg-surface" />
      <div className="animate-pulse-soft h-[168px] rounded-[16px] bg-surface" />
      <div className="animate-pulse-soft h-[56px] rounded-[16px] bg-surface" />
    </div>
  );
}
