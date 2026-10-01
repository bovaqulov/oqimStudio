"use client";

import { ErrorState } from "@/components/layout/ErrorState";

export default function FlowEditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col bg-bg text-text">
      <ErrorState
        title="Oqimni ochib bo'lmadi"
        description="Saqlangan grafik o'qilmadi. Qayta urinib ko'ring — muammo saqlansa, oqimni bo'limlar ro'yxatidan qayta oching."
        error={error}
        reset={reset}
      />
    </div>
  );
}
