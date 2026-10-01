"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "./socket-store";
import type { RealtimeEvent } from "./types";

/**
 * Calls `handler` when one of `events` arrives on the workspace socket.
 *
 * The handler is held in a ref rather than in the effect's dependencies, so a
 * component that re-renders on every keystroke does not tear the socket down
 * and build it again — which, with the reference counting in `socket-store`,
 * would be a real reconnect and not just churn.
 */
export function useRealtime(events: readonly string[], handler: (event: RealtimeEvent) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  // `join`, so a caller may write the array inline without re-subscribing on
  // every render. The list is short and made of literals.
  const key = events.join(",");
  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    return subscribe((event) => {
      if (wanted.size && !wanted.has(event.event)) return;
      latest.current(event);
    });
  }, [key]);
}
