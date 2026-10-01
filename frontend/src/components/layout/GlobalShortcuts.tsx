"use client";

import { useEffect } from "react";
import { useHelpDialogStore } from "./help-store";

/** App-wide "?" and Escape handling for the help dialog. Mounted once by AppShell. */
export function GlobalShortcuts() {
  const toggle = useHelpDialogStore((state) => state.toggle);
  const hide = useHelpDialogStore((state) => state.hide);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === "Escape") hide();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, hide]);

  return null;
}
