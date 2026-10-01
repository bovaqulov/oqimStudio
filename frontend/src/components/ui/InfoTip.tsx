"use client";

import { useState } from "react";
import { call, haptic, webApp } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";
import { Icon, type IconName } from "./Icon";

/**
 * The one sentence a screen is still allowed, one tap away.
 *
 * This is what replaced the grey paragraph under every field. The rule that
 * comes with it: at most one of these on a screen. An (i) beside every label is
 * the same wall of explanation, just folded.
 *
 * Inside Telegram the tap opens the *client's* own alert rather than a bubble
 * of ours. A popover anchored inside a 390px sheet either covers the field it
 * is explaining or hangs off the edge; the client's dialog is centred, sized to
 * its text, and dismissed the way every other dialog in Telegram is. Outside
 * Telegram it stays a hover/pin popover, which is the right thing on a mouse.
 */
export function InfoTip({
  text,
  tone = "info",
  align = "center",
  size = 15,
  className,
}: {
  text: string;
  /** `warning` marks a permission or action worth a second look before granting. */
  tone?: "info" | "warning";
  /** Which edge the bubble lines up with — `end` keeps it inside a right-hand panel. */
  align?: "center" | "start" | "end";
  size?: number;
  className?: string;
}) {
  const [pinned, setPinned] = useState(false);
  const icon: IconName = tone === "warning" ? "warning" : "info";

  function open(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (webApp()?.initData) {
      haptic("light");
      call("6.2", (tg) => tg.showAlert(text));
      return;
    }
    setPinned((value) => !value);
  }

  return (
    <span className={cn("group relative inline-flex flex-none align-middle", className)}>
      <button
        type="button"
        aria-label={text}
        aria-expanded={pinned}
        onClick={open}
        className={cn(
          // `oq-tap` widens the hit box to 44px on a phone; the drawn circle
          // stays `size + 4` so nothing in a dense row shifts.
          "oq-tap relative flex cursor-help items-center justify-center rounded-full transition-colors",
          tone === "warning" ? "text-warning-fg" : "text-neutral-500 hover:text-neutral-300",
        )}
        style={{ width: size + 4, height: size + 4 }}
      >
        <Icon name={icon} size={size} />
      </button>
      <span
        aria-hidden
        className={cn(
          "t-footnote pointer-events-none absolute top-full z-30 mt-1 w-[236px] rounded-[12px] bg-neutral-950 px-3 py-2.5 whitespace-pre-line text-neutral-200 shadow-lg transition-opacity duration-100",
          align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2",
          pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {text}
      </span>
    </span>
  );
}
