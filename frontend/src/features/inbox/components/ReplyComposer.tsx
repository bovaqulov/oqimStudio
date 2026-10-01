"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { sendReplyAction } from "../actions";

/**
 * The line at the bottom of a thread.
 *
 * A client component and not a plain form action, for the two things a chat box
 * has to do that a page reload cannot: keep the draft when the send fails, and
 * clear it when the send lands. Enter sends, Shift+Enter breaks the line —
 * the shape everyone already has in their fingers from Telegram.
 */
export function ReplyComposer({ contactId, blocked }: { contactId: string; blocked: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function send() {
    const draft = text.trim();
    if (!draft || busy) return;
    setError(null);
    startTransition(async () => {
      const result = await sendReplyAction({ contactId, text: draft });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setText("");
    });
  }

  if (blocked) {
    return (
      <div className="t-footnote t-tertiary flex items-center gap-2 rounded-[12px] bg-neutral-900 px-3.5 py-3">
        <Icon name="warning" size={14} className="flex-none text-danger-fg" />
        Bu foydalanuvchi botni bloklagan — xabar yetib bormaydi.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={text}
          disabled={busy}
          placeholder="Xabar yozing…"
          aria-label="Xabar"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-[132px] min-h-[44px] flex-1 resize-none rounded-[12px] border-0 bg-neutral-800 px-3.5 py-3 text-[17px] text-text outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset disabled:opacity-60 md:text-[15px]"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          aria-label="Yuborish"
          className="oq-press flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full bg-accent-700 text-white disabled:cursor-default disabled:opacity-40"
        >
          <Icon name="paper-plane-tilt" size={17} />
        </button>
      </div>
      {error && (
        <span role="alert" className="t-footnote text-danger-fg">
          {error}
        </span>
      )}
    </div>
  );
}
