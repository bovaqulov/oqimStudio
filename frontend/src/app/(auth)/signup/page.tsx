import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/features/auth/components/AuthCard";
import { SignupForm } from "@/features/auth/components/SignupForm";
import { TelegramWebAppGate } from "@/features/auth/components/TelegramWebAppGate";
import { telegramConfigAction } from "@/features/auth/actions";

export const metadata: Metadata = {
  title: "Ro'yxatdan o'tish · Oqim Studio",
  description: "Oqim Studio'da yangi hisob yaratish.",
};

/**
 * Which bot the sign-up widget belongs to. Awaited inside its own boundary for
 * the same reason as on the login page: it is a call to Django, and the shell
 * around it — logo, card, the shape of the form — owes the reader nothing but
 * itself and can be on screen while the answer is still coming.
 */
async function SignupFormSection() {
  const telegram = await telegramConfigAction();
  return <SignupForm telegram={telegram} />;
}

/**
 * Signing up, in a browser and inside Telegram — the same split the login page
 * makes, because inside a Mini App the two are one act. The client has already
 * identified the person and the backend creates the account the first time it
 * sees that Telegram id, so the gate is the whole screen: there is no password
 * anybody was issued to type into a form here.
 *
 * Nothing in the app links here from inside Telegram, but `startapp=signup` is
 * a URL somebody can send, and a form that cannot be completed is not a state
 * to leave reachable.
 */
export default function SignupPage() {
  return (
    <Suspense>
      {/* CSS picks between the two, before the first paint (see `app/layout.tsx`). */}
      <div data-tg-hide>
        <Suspense fallback={<AuthCardSkeleton fields={4} />}>
          <SignupFormSection />
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
