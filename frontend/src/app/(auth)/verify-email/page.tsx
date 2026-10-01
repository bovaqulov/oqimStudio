import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailPanel } from "@/features/auth/components/VerifyEmailPanel";

export const metadata: Metadata = {
  title: "Emailni tasdiqlash · Oqim Studio",
  description: "Email manzilini tasdiqlash bosqichi.",
};

/**
 * Rendered per request rather than prerendered: everything on this screen comes
 * from the query string — the address being confirmed, the code from the
 * emailed link — and a static shell would send the reader an empty card that
 * only fills in after hydration.
 */
export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailPanel />
    </Suspense>
  );
}
