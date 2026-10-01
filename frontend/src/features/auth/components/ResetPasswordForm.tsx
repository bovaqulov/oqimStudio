"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils/cn";
import { authRepository } from "../data/auth-repository";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import type { ResetPasswordInput, ResetTokenStatus } from "../types";
import { validateConfirmation, validatePassword } from "../validate";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { FormAlert } from "./FormAlert";
import { PasswordField } from "./PasswordField";
import { SubmitButton, authActionClasses } from "./SubmitButton";
import { useAuthForm } from "./useAuthForm";

interface ResetValues extends Record<string, string | boolean> {
  password: string;
  confirm: string;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<ResetTokenStatus | null>(null);
  const [done, setDone] = useState(false);

  // The link is checked before the form is offered: filling in a new password
  // and only then being told the link died is the worst version of this screen.
  useEffect(() => {
    let active = true;
    authRepository
      .checkResetToken(token)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) setStatus({ valid: false, reason: "invalid_token" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const reset = useAuthAction<ResetPasswordInput, void>(
    useCallback((input) => authRepository.resetPassword(input), []),
  );

  const form = useAuthForm<ResetValues>({
    initial: { password: "", confirm: "" },
    validate: useCallback(
      (values: ResetValues) => ({
        password: validatePassword(values.password, { strict: true }) ?? undefined,
        confirm: validateConfirmation(values.password, values.confirm) ?? undefined,
      }),
      [],
    ),
  });

  const handleSubmit = form.submit(async (values) => {
    const result = await reset.run({ token, password: values.password });
    if (result === null && reset.error) return;
    setDone(true);
  });

  if (!status) {
    return (
      <AuthCard title={AUTH_COPY.reset.title}>
        <div role="status" className="t-subhead t-secondary flex items-center gap-2.5 py-4">
          <Spinner size={17} /> {AUTH_COPY.reset.checking}
        </div>
      </AuthCard>
    );
  }

  if (!status.valid) {
    const expired = status.reason === "expired_token";
    return (
      <AuthCard title={expired ? AUTH_COPY.reset.expiredTitle : AUTH_COPY.reset.invalidTitle}>
        <div className="flex flex-col gap-4">
          <FormAlert>{expired ? AUTH_COPY.reset.expiredBody : AUTH_COPY.reset.invalidBody}</FormAlert>
          {/* Asking for a fresh link is the only thing left to do here, so it
              is the screen's one filled button. */}
          <Link href="/forgot-password" className={authActionClasses}>
            {AUTH_COPY.reset.requestNew}
          </Link>
          <Link href="/login" className={cn(authLinkClasses, "w-full justify-center")}>
            {AUTH_COPY.forgot.backToLogin}
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title={AUTH_COPY.reset.successTitle}>
        <div className="flex flex-col gap-4">
          <FormAlert tone="success">{AUTH_COPY.reset.successBody}</FormAlert>
          <button type="button" onClick={() => router.replace("/login")} className={authActionClasses}>
            {AUTH_COPY.reset.goToLogin}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={AUTH_COPY.reset.title} shakeKey={form.shakeKey}>
      <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {/* Which account this link belongs to — the masked address alone, with
            no sentence around it. Somebody who requested two resets needs it. */}
        {status.emailMasked && <p className="t-subhead t-secondary m-0">{status.emailMasked}</p>}

        {reset.error && <FormAlert>{reset.error.message}</FormAlert>}

        <PasswordField
          id="password"
          label={AUTH_COPY.reset.newPassword}
          autoComplete="new-password"
          showStrength
          info={AUTH_COPY.signup.passwordRule}
          value={form.values.password}
          error={form.errors.password}
          onChange={(value) => form.setValue("password", value)}
          onBlur={() => form.validateField("password")}
        />

        <PasswordField
          id="confirm"
          label={AUTH_COPY.reset.confirm}
          autoComplete="new-password"
          value={form.values.confirm}
          error={form.errors.confirm}
          onChange={(value) => form.setValue("confirm", value)}
          onBlur={() => form.validateField("confirm")}
        />

        <SubmitButton label={AUTH_COPY.reset.submit} loading={reset.loading} />
      </form>
    </AuthCard>
  );
}
