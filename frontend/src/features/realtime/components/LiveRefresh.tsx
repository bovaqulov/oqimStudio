"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useRealtime } from "../useRealtime";

/**
 * Re-reads the screen when the server says something on it has changed.
 *
 * Dropped into a server-rendered page, it is the whole of "live" for that page:
 * the event says *that* something moved, and `router.refresh()` asks the server
 * what it is now. Nothing here holds a second copy of the data.
 *
 * That is a deliberate trade against patching rows from the payload. Patching
 * is faster, and it is also a second implementation of every list in the
 * product kept in step with the first by hand — and the first one is a database
 * query with filters, permissions and ordering in it. The refresh costs a round
 * trip and cannot drift.
 *
 * Coalesced, because a flow that sends three messages publishes three events
 * inside a second, and three refreshes of one screen is two wasted.
 */
export function LiveRefresh({
  events,
  quietMs = 400,
}: {
  /** Which events touch this screen. Empty means every event. */
  events: readonly string[];
  /** How long to wait for a burst to finish before asking. */
  quietMs?: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onEvent = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), quietMs);
  }, [router, quietMs]);

  useRealtime(events, onEvent);
  return null;
}
