"use client";

import { useEffect } from "react";
import { call } from "./webapp";

/**
 * "You have unsaved changes" — asked by the client, on the gesture that would
 * lose them.
 *
 * A Mini App is closed by swiping the sheet down or tapping the client's own
 * ✕, neither of which is a navigation our code ever sees. `beforeunload` does
 * not fire for it either. `enableClosingConfirmation` is the only hook there
 * is, and it is a mode rather than a callback: switched on while a form is
 * dirty, off again the moment it is saved.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    call("6.2", (tg) => tg.enableClosingConfirmation());
    return () => call("6.2", (tg) => tg.disableClosingConfirmation());
  }, [dirty]);
}
