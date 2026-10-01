"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { Tone } from "@/components/ui/types";
import { cn } from "@/lib/utils/cn";
import { markAllNotificationsRead, markNotificationRead } from "../actions";
import type { NotificationItem } from "../types";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  neutral: "bg-neutral-tone-bg text-neutral-tone-fg",
  accent: "bg-accent-800 text-accent-200",
};

/**
 * Notification center. Lives in every page header, so the unread count is the
 * one place the app can say "something happened while you were on another
 * screen" — reading an entry is following it, which is why each row is a link
 * that marks itself read on the way out.
 *
 * The entries come from the server; the ids below are only what this tab has
 * marked read since it loaded, so the dot disappears on click instead of on
 * the next navigation.
 *
 * The rows are Telegram's chat-list shape rather than the three stacked lines
 * of 12/11/10.5px they were: icon, name and time on the first line, one clamped
 * line of what happened on the second. There is no chevron — the unread dot
 * holds the trailing edge, and a chat row has never needed one to say it opens.
 */
export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const isUnread = (item: NotificationItem) => !item.isRead && !readIds.includes(item.id);
  const unread = items.filter(isUnread).length;

  function markRead(id: string) {
    setReadIds((current) => (current.includes(id) ? current : [...current, id]));
    void markNotificationRead(id);
  }

  function markAllRead() {
    setReadIds(items.map((item) => item.id));
    void markAllNotificationsRead();
  }

  // A popover that outlives the click that dismissed it reads as a stuck menu.
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
    <div ref={rootRef} className="relative flex-none">
      {/* Inside the header's right-hand capsule the bell is drawn at 36px, so
          `oq-tap` is what still gives it a 44px hit box. */}
      <IconButton
        className="oq-tap relative"
        icon="bell-ringing"
        label={unread ? `Bildirishnomalar (${unread} ta o'qilmagan)` : "Bildirishnomalar"}
        active={open}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {unread > 0 && (
        // The phone offsets are tuned to the 36px the capsule draws the button
        // at, not to the 44px `IconButton` uses on its own — at the old 1.5 the
        // badge sat inside the corner instead of on it.
        <span className="t-caption pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-700 px-1 text-white tabular-nums max-md:top-0 max-md:right-0">
          {unread}
        </span>
      )}

      {open && (
        /*
         * Never wider than the screen it hangs off: at 390px a fixed 320px
         * panel plus the header's own gutter is already over the edge.
         *
         * `-right-10` on a phone because this hangs off the *bell*, which is
         * the left half of the header's right-hand capsule — aligning to the
         * bell's own edge stopped the panel ~40px short of the screen inset and
         * left it visibly off-centre under the capsule it belongs to.
         */
        <div className="animate-rise absolute top-full right-0 z-40 mt-2 w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-[16px] border border-separator bg-overlay shadow-lg max-md:-right-10 max-md:mt-2.5">
          <div className="flex items-center gap-2 border-b border-separator px-4 py-2">
            <span className="t-headline flex-1">Bildirishnomalar</span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="t-footnote min-h-11 cursor-pointer px-1 text-accent-400 disabled:cursor-default disabled:text-neutral-600"
            >
              Barchasini o&apos;qildim
            </button>
          </div>

          <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <EmptyState icon="bell-ringing" title="Bildirishnoma yo'q" />
            ) : (
              items.map((item) => {
                const unreadRow = isUnread(item);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => {
                      markRead(item.id);
                      setOpen(false);
                    }}
                    className="oq-row"
                  >
                    <span
                      className={cn(
                        "flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full",
                        toneClasses[item.tone],
                      )}
                    >
                      <Icon name={item.icon} size={19} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("t-headline min-w-0 flex-1 truncate", !unreadRow && "t-secondary")}>
                          {item.title}
                        </span>
                        <span className="t-caption t-tertiary flex-none">{item.time}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="t-footnote t-secondary min-w-0 flex-1 line-clamp-1">{item.text}</span>
                        {unreadRow && <span className="h-2 w-2 flex-none rounded-full bg-accent-500" />}
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
