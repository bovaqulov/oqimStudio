"use client";

import { useSyncExternalStore } from "react";

/** Nothing ever changes, so a subscriber never has to be told anything. */
const subscribe = () => () => {};

/**
 * Whether React has taken over the markup on this page yet.
 *
 * A button rendered by the server looks finished long before its `onClick`
 * exists, and a click in that gap is swallowed with no feedback at all — which
 * reads as "the button is broken", and is exactly what QA saw: the first press
 * of "Yangi oqim" after a fresh load did nothing, the second worked.
 *
 * `useSyncExternalStore` rather than an effect: it returns the server value
 * during hydration and the client one immediately after, without a render pass
 * that sets state on itself.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
