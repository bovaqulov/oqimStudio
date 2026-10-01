"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { telegramLoginAction } from "../actions";
import { AUTH_COPY } from "../messages";
import { landingPathFor, persistSession } from "../session-client";
import type { TelegramSignInConfig } from "../types";
import { FormAlert } from "./FormAlert";
import { TelegramBotSignIn } from "./TelegramBotSignIn";
import { TelegramLoginButton, type TelegramAuthPayload } from "./TelegramLoginButton";

/**
 * "Telegram orqali kirish", with the divider that separates it from the
 * password form.
 *
 * Two ways in, and the screen picks rather than asking. The widget is one tap
 * and never leaves the page, so it wins wherever Telegram honours it — which
 * is only the domain registered with @BotFather, and only while their script
 * loads. Everywhere else the bot link is offered instead: one app switch, but
 * it works from any address.
 *
 * Three states, and each one owes the reader something: while the widget is
 * still coming there is a placeholder of its exact size (a button that pops in
 * late moves the form under the cursor), when it fails the bot link takes its
 * place, and when neither can work the whole block — divider included —
 * disappears rather than framing an empty gap.
 */
export function TelegramSignIn({ config, next }: { config?: TelegramSignInConfig | null; next?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [widget, setWidget] = useState<"loading" | "ready" | "failed">(
    config?.widget ? "loading" : "failed",
  );

  const handleReady = useCallback(() => setWidget("ready"), []);
  const handleUnavailable = useCallback(() => setWidget("failed"), []);

  async function signIn(payload: TelegramAuthPayload) {
    setError(null);
    const result = await telegramLoginAction(payload as unknown as Record<string, unknown>);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Telegram has already established who this is, so there is no inbox to
    // confirm — the only stop left is picking a workspace.
    persistSession(result.data, true);
    router.replace(landingPathFor(result.data, next));
  }

  const usesWidget = Boolean(config?.widget) && widget !== "failed";
  const usesBotLink = !usesWidget && Boolean(config?.botFlow);

  // Nothing Telegram-shaped can work here. Say nothing rather than framing an
  // empty space with a divider that promises a choice.
  if (!usesWidget && !usesBotLink) return null;

  return (
    <div className="flex flex-col gap-4">
      {error && <FormAlert>{error}</FormAlert>}

      {usesWidget && (
        <div className="relative min-h-[44px]">
          {widget === "loading" && (
            <div
              aria-hidden
              className="absolute inset-0 animate-pulse rounded-[12px] bg-neutral-800"
            />
          )}
          <TelegramLoginButton
            botUsername={config!.botUsername}
            onAuth={(payload) => void signIn(payload)}
            onReady={handleReady}
            onUnavailable={handleUnavailable}
          />
        </div>
      )}

      {usesBotLink && <TelegramBotSignIn next={next} />}

      <div className="t-footnote t-tertiary flex items-center gap-3">
        <span className="h-px flex-1 bg-separator" />
        {AUTH_COPY.common.or}
        <span className="h-px flex-1 bg-separator" />
      </div>
    </div>
  );
}
