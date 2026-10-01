"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The scrollable middle of a thread, opened at its end.
 *
 * A chat is read from its last line — a server-rendered scroll container
 * starts at the top, which on a long conversation is the greeting from last
 * week. `stamp` is the newest message's id, so a reply landing re-runs the
 * effect and the view follows the conversation down.
 */
export function ThreadScroller({ stamp, children }: { stamp: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [stamp]);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3.5">
      {children}
    </div>
  );
}
