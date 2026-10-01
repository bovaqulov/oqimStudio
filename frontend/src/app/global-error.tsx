"use client";

import { ErrorState } from "@/components/layout/ErrorState";
import "./globals.css";

/** Last resort: the root layout itself failed, so this renders its own document. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="uz">
      <body>
        <div className="flex min-h-screen w-full flex-col bg-bg text-text">
          <ErrorState
            title="Ilovada kutilmagan xatolik"
            description="Sahifani qayta yuklang. Muammo takrorlansa, xato ID sini yordam markaziga yuboring."
            error={error}
            reset={reset}
          />
        </div>
      </body>
    </html>
  );
}
