"use client";

import { useSyncExternalStore } from "react";

/**
 * Tailwind's `md` breakpoint, read from the other side — the phone/dialog line
 * `MOBILE.md` sets for the whole product. One number for both halves of the
 * answer, so a `max-md:` class and a JavaScript decision can never disagree
 * about where a phone stops being a phone.
 */
const PHONE_QUERY = "(max-width: 767.98px)";

let query: MediaQueryList | null = null;

function media(): MediaQueryList | null {
  if (!query && typeof window !== "undefined") query = window.matchMedia(PHONE_QUERY);
  return query;
}

function subscribe(onChange: () => void): () => void {
  const list = media();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/**
 * Whether this is a phone-sized screen.
 *
 * Most of what a phone needs is said in CSS, and should be — but some of it
 * cannot be. A dialog that turns into a full-screen sheet has to *drop* the
 * width its caller asked for rather than override it, and the canvas has to be
 * left unmounted rather than hidden, or its fifteen keyboard shortcuts and its
 * fit-to-view are still running behind a list nobody can see them from. Those
 * are render decisions, and a render decision needs the answer in JavaScript.
 *
 * `useSyncExternalStore` rather than an effect, for the reason `useHydrated`
 * gives: it hands back the server value during hydration and the real one
 * immediately after, with no render pass that sets state on itself. The server
 * has no viewport to measure, so it answers "not a phone" and the first paint
 * on a phone is the desktop reading for a frame — cheaper than guessing from a
 * user-agent string and being wrong on a narrow desktop window.
 */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
