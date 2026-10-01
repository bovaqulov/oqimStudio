"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { ListGroup, ListRow } from "@/components/ui/List";
import { cn } from "@/lib/utils/cn";
import { authRepository } from "../data/auth-repository";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import { clearSession, persistSession, readSession } from "../session-client";
import type { AuthSession } from "../types";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { AuthField } from "./AuthField";
import { FormAlert } from "./FormAlert";
import { SubmitButton, authActionClasses } from "./SubmitButton";

/** Long enough that a resend is a decision, short enough not to feel punitive. */
const COOLDOWN_SECONDS = 60;

export function VerifyEmailPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [resent, setResent] = useState(false);
  // The code, from the emailed link (`?token=`) or handed over by the backend
  // in development (`?code=`, and again with every "resend").
  const devCode = params.get("code") ?? "";
  const [code, setCode] = useState(params.get("token") ?? devCode);
  const [shownDevCode, setShownDevCode] = useState(devCode);

  // One interval, ticking down. The button is unavailable until it reaches 0,
  // which is what keeps a stuck inbox from turning into ten identical emails.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const resend = useAuthAction<void, { demoToken: string | null }>(
    useCallback(() => authRepository.resendVerification(), []),
  );
  const verify = useAuthAction<string, AuthSession>(
    useCallback((value: string) => authRepository.verifyEmail(value), []),
  );

  if (verify.data) {
    return (
      <AuthCard title={AUTH_COPY.verify.verifiedTitle}>
        <div className="flex flex-col gap-4">
          <FormAlert tone="success">{AUTH_COPY.verify.verifiedBody}</FormAlert>
          <button
            type="button"
            onClick={() => router.replace("/onboarding/workspace")}
            className={authActionClasses}
          >
            {AUTH_COPY.verify.continue}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={AUTH_COPY.verify.title}
      footer={
        // Both exits drop the session first: while the account is unverified
        // the guard sends every other route back here, so leaving has to
        // actually end the session rather than just navigate.
        <>
          <span>{AUTH_COPY.verify.wrongEmail}</span>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.replace("/signup");
            }}
            className={authLinkClasses}
          >
            {AUTH_COPY.verify.changeEmail}
          </button>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.replace("/login?reason=logout");
            }}
            className={authLinkClasses}
          >
            {AUTH_COPY.verify.otherAccount}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Which address the link went to, as a row rather than as a bordered
            box with a sentence in it. Stacked rather than label-left /
            value-right: a right-hand value truncates, and the whole point of
            this row is that the reader can check the address character by
            character. */}
        {email && (
          <ListGroup>
            <ListRow>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-footnote t-secondary">{AUTH_COPY.verify.sentTo}</span>
                <span className="t-body break-all">{email}</span>
              </span>
            </ListRow>
          </ListGroup>
        )}

        {/* Development only: the backend hands the code over when there is no
            inbox to open, and hiding it would make the flow untestable. It is
            never sent with DEBUG off, so this cannot appear in production. */}
        {shownDevCode && (
          <div className="rounded-[12px] bg-warning-bg px-3.5 py-3">
            <div className="t-footnote text-warning-fg">{AUTH_COPY.verify.devMode}</div>
            <code className="t-footnote mt-1 block font-mono break-all text-text">{shownDevCode}</code>
          </div>
        )}

        {resend.error && <FormAlert>{resend.error.message}</FormAlert>}
        {verify.error && <FormAlert>{verify.error.message}</FormAlert>}
        {resent && !resend.error && <FormAlert tone="success">{AUTH_COPY.verify.resent}</FormAlert>}

        {/* The link in the mail carries a code; pasting it here is the same
            confirmation, for a mailbox that is not on this device. The form's
            submit is the screen's one filled button, so resending is a plain
            accent text button above it. */}
        <button
          type="button"
          disabled={cooldown > 0 || resend.loading}
          onClick={async () => {
            const result = await resend.run();
            if (result !== null) {
              setResent(true);
              setCooldown(COOLDOWN_SECONDS);
              if (result.demoToken) {
                setCode(result.demoToken);
                setShownDevCode(result.demoToken);
              }
            }
          }}
          className={cn(authLinkClasses, "self-start disabled:cursor-default disabled:text-neutral-600")}
        >
          {cooldown > 0 ? AUTH_COPY.verify.resendIn(cooldown) : AUTH_COPY.verify.resend}
        </button>

        <form
          method="post"
          onSubmit={async (event) => {
            event.preventDefault();
            const session = await verify.run(code.trim());
            if (!session) return;
            const previous = readSession();
            persistSession({ ...session, workspaceId: previous?.workspaceId ?? session.workspaceId });
          }}
          className="flex flex-col gap-4"
        >
          {/* The one (i) here, and it answers the only real question on this
              screen: why is there a field at all when there is a link. */}
          <AuthField id="verify-code" label={AUTH_COPY.verify.codeLabel} info={AUTH_COPY.verify.codeInfo}>
            <Input
              id="verify-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              className="font-mono"
            />
          </AuthField>
          <SubmitButton label={AUTH_COPY.verify.continue} loading={verify.loading} disabled={!code.trim()} />
        </form>
      </div>
    </AuthCard>
  );
}
