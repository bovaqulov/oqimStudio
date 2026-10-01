"use client";

import { ErrorState } from "@/components/layout/ErrorState";

/**
 * The boundary above the app shell.
 *
 * `(app)/error.tsx` catches what a *page* throws, but React error boundaries
 * do not catch their own layout — so when `(app)/layout.tsx` fails to load the
 * session, the failure lands here instead. Without this file it went one level
 * further, to `global-error.tsx`, which replaces the whole document and reads
 * as "the application is broken" for what is usually a backend that is still
 * starting up.
 */
export default function AppShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-bg text-text">
      <ErrorState
        title="Panelni ochib bo'lmadi"
        description="Server javob bermadi. U qayta ishga tushayotgan bo'lishi mumkin — bir necha soniyadan keyin «Qayta urinish» ni bosing."
        error={error}
        reset={reset}
      />
    </div>
  );
}
