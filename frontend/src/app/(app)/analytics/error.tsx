"use client";

import { ErrorState } from "@/components/layout/ErrorState";

export default function AnalyticsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Hisobotni tayyorlab bo'lmadi"
      description="Analitika xizmati javob bermadi. Davrni qisqartirib yoki filtrni tozalab qayta urinib ko'ring."
      error={error}
      reset={reset}
    />
  );
}
