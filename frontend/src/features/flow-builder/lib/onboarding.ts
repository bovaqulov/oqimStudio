"use client";

import { useSyncExternalStore } from "react";

/**
 * One-time hints, remembered per browser.
 *
 * `useSyncExternalStore` rather than an effect: the server has no localStorage,
 * so its snapshot says "already dismissed" and the hint appears only after
 * hydration — no mismatch, and no state written from inside an effect.
 */
const STORAGE_PREFIX = "oqim:hint:";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

export function dismissHint(key: string): void {
  try {
    window.localStorage.setItem(storageKey(key), "1");
  } catch {
    // A browser with storage disabled simply shows the hint again next time.
  }
  listeners.forEach((listener) => listener());
}

export function useHintDismissed(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(storageKey(key)) === "1";
      } catch {
        return false;
      }
    },
    // Server render: never paint the hint, so hydration has nothing to disagree with.
    () => true,
  );
}
