import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/features/auth/components/AuthCard";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { TelegramWebAppGate } from "@/features/auth/components/TelegramWebAppGate";
import { telegramConfigAction } from "@/features/auth/actions";

export const metadata: Metadata = {
  title: "Kirish · Oqim Studio",
  description: "Oqim Studio ish maydoniga kirish.",
};

/**
 * Which bot the login widget belongs to — the backend holds the token that
 * verifies its signature, so it is also what names it.
 *
 * It is its own component so that the round trip that answers it (~1s against
 * Django) sits inside a Suspense boundary instead of in front of the document.
 * Inside a Mini App that wait bought nothing at all: the config only names the
 * bot behind the login *widget*, the widget lives in the password form, and the
 * Mini App never renders the form — so every launch paid a second of white
 * screen for markup it then hid.
 */
async function LoginFormSection() {
  const telegram = await telegramConfigAction();
  return <LoginForm telegram={telegram} />;
}

/** `useSearchParams` needs a boundary — the form reads `next` and `reason` from the URL. */
export default function LoginPage() {
  return (
    <Suspense>
      {/* Both are rendered; CSS picks, before the first paint. Inside Telegram
          nobody is asked for a password they were never given — outside it,
          this markup is exactly the login screen it has always been. */}
      <div data-tg-hide>
        <Suspense fallback={<AuthCardSkeleton fields={2} />}>
          <LoginFormSection />
        </Suspense>
      </div>
      <div data-tg-only>
        {/* No fallback: the gate is not waiting on us, and it draws a skeleton
            of its own while it verifies the client's signature. */}
        <TelegramWebAppGate />
      </div>
    </Suspense>
  );
}
