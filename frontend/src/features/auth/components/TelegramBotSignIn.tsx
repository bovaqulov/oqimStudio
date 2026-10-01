"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { telegramBotStartAction, telegramBotStatusAction } from "../actions";
import { landingPathFor, persistSession } from "../session-client";
import { FormAlert } from "./FormAlert";

/** How often to ask whether the person has pressed Start yet. */
const POLL_INTERVAL_MS = 1000;
/**
 * The slowest the poll backs off to after asks that come back with nothing.
 *
 * Backing off matters more here than it looks: the status endpoint is rate
 * limited by client address, and the panel calls the backend *server-side*, so
 * every waiting browser in the deployment arrives from the same address and
 * shares one budget. A second person waiting has to slow this poll down — the
 * alternative is two browsers beating on a door that is already refusing them.
 */
const MAX_RETRY_INTERVAL_MS = 8000;
/** Unanswered asks in a row before the wait is called off rather than hidden. */
const MAX_MISSES = 10;
/** Only used if the backend opened an attempt without naming its lifetime. */
const FALLBACK_TTL_SECONDS = 5 * 60;

const EXPIRED_TEXT = "Havola muddati tugadi. «Telegram orqali kirish» tugmasini qaytadan bosing.";

/** One login attempt, as the browser has to remember it while it waits. */
interface Attempt {
  nonce: string;
  url: string;
  /** Wall-clock deadline, so the wait can end by itself instead of spinning. */
  expiresAt: number;
}

/**
 * "Telegram orqali kirish" without a registered domain.
 *
 * Opens the bot on `t.me`, then waits: the person presses Start in Telegram,
 * the bot's update approves the attempt, and the next poll comes back with a
 * session. The waiting state keeps the link visible because a popup blocker
 * eats `window.open` often enough that "nothing happened" has to have an
 * answer on screen.
 *
 * Nothing here may end in a spinner. The two halves of this flow live in
 * different apps, so every way the second half can fail — never pressed, link
 * gone stale, nonce already spent, backend not answering — leaves the button
 * back on screen with a sentence saying which of those happened.
 *
 * The button is a filled *surface*, not a filled blue: the form's own submit
 * is this screen's one primary action, and two blue blocks stacked on a login
 * card is the pattern this pass exists to remove. The Telegram mark carries
 * the recognition the colour used to.
 */
export function TelegramBotSignIn({ next }: { next?: string | null }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    // Opened *before* the await, not after it, and this is the whole reason the
    // first press used to do nothing. A browser only honours `window.open`
    // while it is still inside the click that asked for it; once execution has
    // resumed from an `await` that credit is spent and the popup blocker eats
    // it silently. The gap here is a server action, so the first press of a
    // session pays for a cold round trip and is exactly the one that loses the
    // race — press again and the warm call returns fast enough to slip through,
    // which is what made this look intermittent instead of broken.
    //
    // So the tab is claimed in the click and pointed at the bot once the URL
    // arrives. `noopener` cannot be passed as a feature here — it makes
    // `window.open` return null and there would be nothing left to steer — so
    // the same protection is applied by hand on the handle below.
    const popup = window.open("about:blank", "_blank");
    const opened = await telegramBotStartAction();
    setBusy(false);
    if (!opened) {
      popup?.close();
      setError("Telegram orqali kirishni boshlab bo'lmadi. Birozdan so'ng urinib ko'ring.");
      return;
    }
    if (popup && !popup.closed) {
      popup.opener = null;
      popup.location.replace(opened.url);
    }
    // A blocked or closed popup is not a failure: the waiting state below keeps
    // «Telegramni qo'lda ochish» on screen, which is the way through.
    setAttempt({
      nonce: opened.nonce,
      url: opened.url,
      // The backend owns the deadline and says how long it gave us; keeping a
      // copy of it here is what lets the wait end with a sentence rather than
      // outliving the nonce it is asking about.
      expiresAt: Date.now() + (opened.expiresIn || FALLBACK_TTL_SECONDS) * 1000,
    });
  }, []);

  useEffect(() => {
    if (!attempt) return;

    // Cancellation is scoped to this attempt, not to the component. A ref that
    // is only ever *cleared* — on unmount, never set back on mount — reads
    // "dead" from the second render onwards under Strict Mode, which mounts an
    // effect, tears it down and mounts it again: every answer was then thrown
    // away before it could reschedule, so the wait asked exactly once and spun
    // forever. A local flag cannot outlive the attempt it belongs to.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Consecutive unanswered asks. Reset by any real answer, because a backend
    // that blinked once is not a backend that is down.
    let misses = 0;
    // One ask at a time. The nonce buys exactly one session, so two answers
    // arriving together would mean one of them reading "already used" and
    // overwriting the one that actually signed somebody in.
    let asking = false;

    const stop = (message: string) => {
      setAttempt(null);
      setError(message);
    };

    async function ask() {
      if (cancelled || asking) return;
      if (Date.now() >= attempt!.expiresAt) {
        // Telegram would refuse this nonce now anyway; saying so is kinder
        // than asking about it until the tab closes.
        stop(EXPIRED_TEXT);
        return;
      }

      asking = true;
      let result: Awaited<ReturnType<typeof telegramBotStatusAction>>;
      try {
        result = await telegramBotStatusAction(attempt!.nonce);
      } finally {
        asking = false;
      }

      if (result.status === "approved" && result.session) {
        // Kept even when this effect has been torn down: the nonce is spent
        // the moment the backend answers with a session, and dropping it here
        // would leave somebody signed in on the server with no session in the
        // browser and no second nonce to ask for. Only the redirect is held
        // back — sending a page somewhere it no longer belongs is the part
        // that would actually be wrong.
        persistSession(result.session, true);
        if (!cancelled) router.replace(landingPathFor(result.session, next));
        return;
      }

      if (cancelled) return;

      switch (result.status) {
        case "expired":
          stop(EXPIRED_TEXT);
          return;
        case "consumed":
          // Somebody else's tab — or a reload of this one — already exchanged
          // this nonce. It is worth exactly one session and that one is gone.
          stop("Bu havola allaqachon ishlatilgan. Qaytadan urinib ko'ring.");
          return;
        case "approved":
          // Approved, and yet no session came with it. The nonce cannot be
          // exchanged twice, so no amount of further asking would fix this.
          stop("Kirishni yakunlab bo'lmadi. Qaytadan urinib ko'ring.");
          return;
        case "error":
          misses += 1;
          if (misses >= MAX_MISSES) {
            stop("Server javob bermadi. Birozdan so'ng qaytadan urinib ko'ring.");
            return;
          }
          // Each miss doubles the pause. A backend that is merely busy — or a
          // rate limit shared with another waiting browser — gets room to
          // answer, while a backend that is genuinely gone still runs out of
          // tries in about a minute instead of spinning until the tab closes.
          timer = setTimeout(ask, Math.min(POLL_INTERVAL_MS * 2 ** misses, MAX_RETRY_INTERVAL_MS));
          return;
        default:
          // "pending": nobody has pressed Start yet. Ask again shortly.
          misses = 0;
          timer = setTimeout(ask, POLL_INTERVAL_MS);
      }
    }

    // Coming back to the browser is the one moment the answer is most likely
    // to have changed — it is what the bot's own message asks the person to do
    // once they have pressed Start. It is also the moment a timer can least be
    // relied on: a tab a phone put in the background has its timers slowed
    // down or frozen outright, so waiting for the next tick can mean waiting
    // for the next time the person looks at the screen.
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      timer = setTimeout(ask, 0);
    };
    document.addEventListener("visibilitychange", wake);

    // Scheduled rather than called: under Strict Mode the first mount is torn
    // down within the same tick, and a request fired straight from the effect
    // body would be a second poll racing the real one for a one-use nonce.
    timer = setTimeout(ask, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [attempt, next, router]);

  if (attempt) {
    return (
      <div className="flex flex-col gap-2 rounded-[12px] bg-neutral-800 p-3.5">
        <div className="t-subhead flex items-center gap-2.5">
          <Spinner size={17} />
          Telegramda «Start» tugmasini bosing
        </div>
        {/* Kept because a blocked popup leaves nothing on screen to press. */}
        <a
          href={attempt.url}
          target="_blank"
          rel="noopener noreferrer"
          className="t-footnote flex min-h-11 items-center text-accent-400"
        >
          Telegramni qo&apos;lda ochish
        </a>
        <button
          type="button"
          onClick={() => setAttempt(null)}
          className="t-footnote t-secondary min-h-11 cursor-pointer self-start"
        >
          Bekor qilish
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <FormAlert>{error}</FormAlert>}
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="oq-press t-headline flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[12px] bg-neutral-800 text-text disabled:cursor-default disabled:opacity-40"
      >
        <Icon name="telegram-logo" size={20} className="text-accent-400" /> Telegram orqali kirish
      </button>
    </div>
  );
}
