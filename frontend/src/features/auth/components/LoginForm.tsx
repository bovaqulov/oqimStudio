"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { authRepository } from "../data/auth-repository";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import { landingPathFor, persistSession } from "../session-client";
import type { AuthSession, LoginInput } from "../types";
import { validateEmail, validatePassword } from "../validate";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { TelegramSignIn } from "./TelegramSignIn";
import type { TelegramSignInConfig } from "../types";
import { AuthField, AuthInput } from "./AuthField";
import { FormAlert } from "./FormAlert";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";
import { useAuthForm } from "./useAuthForm";

interface LoginValues extends Record<string, string | boolean> {
  email: string;
  password: string;
  remember: boolean;
}

/** Why the reader was sent here, when they did not arrive on purpose. */
const REASON_MESSAGE: Record<string, string> = {
  expired: AUTH_COPY.login.expired,
  logout: AUTH_COPY.login.loggedOut,
  auth: AUTH_COPY.login.signInFirst,
  verify: AUTH_COPY.login.verifiedFirst,
};

export function LoginForm({ telegram }: { telegram?: TelegramSignInConfig | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const reason = params.get("reason");

  const login = useAuthAction<LoginInput, AuthSession>(
    useCallback((input) => authRepository.login(input), []),
  );

  const form = useAuthForm<LoginValues>({
    initial: { email: "", password: "", remember: true },
    validate: useCallback(
      (values: LoginValues) => ({
        email: validateEmail(values.email) ?? undefined,
        password: validatePassword(values.password) ?? undefined,
      }),
      [],
    ),
  });

  const handleSubmit = form.submit(async (values) => {
    const session = await login.run({
      email: values.email.trim(),
      password: values.password,
      remember: values.remember,
    });
    if (!session) return;
    persistSession(session, values.remember);
    router.replace(landingPathFor(session, next));
  });

  return (
    <AuthCard
      title={AUTH_COPY.login.title}
      shakeKey={form.shakeKey}
      footer={
        <>
          {AUTH_COPY.login.noAccount}
          <Link href="/signup" className={authLinkClasses}>
            {AUTH_COPY.login.signupLink}
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {reason && REASON_MESSAGE[reason] && <FormAlert tone="info">{REASON_MESSAGE[reason]}</FormAlert>}
        {login.error && <FormAlert>{login.error.message}</FormAlert>}

        <TelegramSignIn config={telegram} next={next} />

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

        <PasswordField
          id="password"
          label={AUTH_COPY.login.passwordLabel}
          autoComplete="current-password"
          value={form.values.password}
          error={form.errors.password}
          onChange={(value) => form.setValue("password", value)}
          onBlur={() => form.validateField("password")}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* `htmlFor`/`id` rather than wrapping alone: a screen reader read
              the wrapped version as "on", which names the state and not the
              choice. */}
          <label htmlFor="remember" className="t-subhead flex min-h-11 cursor-pointer items-center gap-2.5">
            <input
              id="remember"
              type="checkbox"
              name="remember"
              checked={form.values.remember}
              onChange={(event) => form.setValue("remember", event.target.checked)}
              className="h-[18px] w-[18px] accent-[var(--color-accent-700)]"
            />
            {AUTH_COPY.login.remember}
          </label>
          <Link href="/forgot-password" className={authLinkClasses}>
            {AUTH_COPY.login.forgot}
          </Link>
        </div>

        <SubmitButton label={AUTH_COPY.login.submit} loading={login.loading} />
      </form>
    </AuthCard>
  );
}
