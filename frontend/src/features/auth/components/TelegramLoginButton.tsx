"use client";

import { useEffect, useRef } from "react";

/** Telegram's own widget script. The version suffix is theirs, not ours. */
const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";
/** The widget calls a *global* function by name; this is the one we register. */
const CALLBACK_NAME = "onOqimTelegramAuth";

export interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * The "Log in with Telegram" button.
 *
 * Telegram renders it inside an iframe of its own, so it cannot be styled or
 * faked from here: what comes back is signed with the bot's token and is
 * verified on the server. The payload is passed on untouched — the signature
 * covers those exact fields.
 *
 * The bot's domain has to be registered with @BotFather (`/setdomain`) or the
 * button appears and then refuses to sign anybody in.
 */
/** How long the widget gets to render before the screen gives up on it. */
const LOAD_TIMEOUT_MS = 4000;

export function TelegramLoginButton({
  botUsername,
  onAuth,
  onReady,
  onUnavailable,
}: {
  botUsername: string;
  onAuth: (payload: TelegramAuthPayload) => void;
  /** Called once Telegram's iframe is actually on the page. */
  onReady?: () => void;
  /** Called when Telegram's iframe never arrives — the screen shows its own message instead. */
  onUnavailable?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // Kept in a ref so a re-render with a new handler does not tear the widget
  // down and rebuild it — the iframe would flicker on every keystroke elsewhere.
  const handler = useRef(onAuth);
  const fallback = useRef(onUnavailable);
  const ready = useRef(onReady);
  useEffect(() => {
    handler.current = onAuth;
    fallback.current = onUnavailable;
    ready.current = onReady;
  }, [onAuth, onUnavailable, onReady]);

  useEffect(() => {
    const host = container.current;
    if (!host || !botUsername) return;

    const globals = window as unknown as Record<string, unknown>;
    globals[CALLBACK_NAME] = (payload: TelegramAuthPayload) => handler.current(payload);

    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-onauth", `${CALLBACK_NAME}(user)`);
    script.addEventListener("error", () => fallback.current?.());
    host.appendChild(script);

    // The iframe is inserted by their script whenever it gets around to it,
    // so the screen watches for it rather than guessing at a delay: the button
    // is announced the moment it is actually drawn.
    //
    // Drawn, not present. Announcing it on the existence of an `<iframe>` is
    // what put a bare "yoki" divider on the sign-up screen with nothing above
    // it: Telegram inserts the element first and gives it a size when it has
    // decided it will render, and for a bot whose domain is not registered
    // that second half never comes. A 44px hole then read as a button that had
    // failed to paint. Height is the only thing that distinguishes the two,
    // and it is measured on a timer rather than watched for, because the size
    // arrives from inside the frame without touching anything this observer
    // could be pointed at.
    let settled = false;
    const drawn = () => {
      const frame = host.querySelector("iframe");
      return Boolean(frame && frame.getBoundingClientRect().height > 0);
    };
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      (ok ? ready.current : fallback.current)?.();
    };
    const poll = setInterval(() => {
      if (drawn()) settle(true);
    }, 150);

    // The script comes from telegram.org, which an ad blocker, a firewall or a
    // flaky network can stop. Nothing renders in that case, and an empty gap
    // above the password form explains itself to nobody — so the last word is
    // the same measurement, and a frame that never took a size counts as no
    // button at all.
    const timer = setTimeout(() => settle(drawn()), LOAD_TIMEOUT_MS);

    return () => {
      clearInterval(poll);
      clearTimeout(timer);
      host.replaceChildren();
      delete globals[CALLBACK_NAME];
    };
  }, [botUsername]);

  return <div ref={container} className="flex justify-center" />;
}
