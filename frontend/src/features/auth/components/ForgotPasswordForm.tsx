"use client";

import Link from "next/link";
import { useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { authRepository } from "../data/auth-repository";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import { validateEmail } from "../validate";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { AuthField, AuthInput } from "./AuthField";
import { FormAlert } from "./FormAlert";
import { SubmitButton } from "./SubmitButton";
import { useAuthForm } from "./useAuthForm";

interface ForgotValues extends Record<string, string | boolean> {
  email: string;
}

export function ForgotPasswordForm() {
  const request = useAuthAction<string, { demoToken: string | null }>(
    useCallback((email: string) => authRepository.requestPasswordReset(email), []),
  );

  const form = useAuthForm<ForgotValues>({
    initial: { email: "" },
    validate: useCallback((values: ForgotValues) => ({ email: validateEmail(values.email) ?? undefined }), []),
  });

  const handleSubmit = form.submit(async (values) => {
    await request.run(values.email.trim());
  });

  // Success is intentionally identical whether or not the address exists —
  // "no such account" here is a free list of valid emails for an attacker.
  if (request.data) {
    return (
      <AuthCard title={AUTH_COPY.forgot.successTitle}>
        <div className="flex flex-col gap-4">
          <FormAlert tone="success">{AUTH_COPY.forgot.successBody}</FormAlert>

          {/* Development only: with no mail server there is no inbox to open,
              so the link the mail would have carried is printed here instead. */}
          {request.data.demoToken && (
            <Link
              href={`/reset-password/${request.data.demoToken}`}
              className="t-footnote flex min-h-11 items-center rounded-[12px] bg-neutral-800 px-3.5 font-mono break-all text-accent-400"
            >
              /reset-password/{request.data.demoToken}
            </Link>
          )}

          {/* No filled button on this screen: nothing here is the action, the
              reader's next step is in their inbox. */}
          <button
            type="button"
            onClick={() => request.reset()}
            className={cn(authLinkClasses, "w-full justify-center")}
          >
            {AUTH_COPY.forgot.resend}
          </button>
          <Link href="/login" className={cn(authLinkClasses, "w-full justify-center")}>
            {AUTH_COPY.forgot.backToLogin}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={AUTH_COPY.forgot.title}
      shakeKey={form.shakeKey}
      footer={
        <Link href="/login" className={authLinkClasses}>
          {AUTH_COPY.forgot.backToLogin}
        </Link>
      }
    >
      <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {request.error && <FormAlert>{request.error.message}</FormAlert>}

        <AuthField id="email" label={AUTH_COPY.common.email} error={form.errors.email} required>
          <AuthInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder={AUTH_COPY.common.emailPlaceholder}
            value={form.values.email}
            invalid={Boolean(form.errors.email)}
            aria-describedby={form.errors.email ? "email-error" : undefined}
            onChange={(event) => form.setValue("email", event.target.value)}
            onBlur={() => form.validateField("email")}
          />
        </AuthField>

        <SubmitButton label={AUTH_COPY.forgot.submit} loading={request.loading} />
      </form>
    </AuthCard>
  );
}
