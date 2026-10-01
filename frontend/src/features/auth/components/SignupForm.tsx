"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { authRepository } from "../data/auth-repository";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import { landingPathFor, persistSession } from "../session-client";
import type { SignupInput } from "../types";
import type { SignupOutcome } from "../action-types";
import { validateConfirmation, validateEmail, validateName, validatePassword } from "../validate";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { TelegramSignIn } from "./TelegramSignIn";
import type { TelegramSignInConfig } from "../types";
import { AuthField, AuthInput } from "./AuthField";
import { FormAlert } from "./FormAlert";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";
import { useAuthForm } from "./useAuthForm";

interface SignupValues extends Record<string, string | boolean> {
  name: string;
  email: string;
  password: string;
  confirm: string;
  terms: boolean;
}

export function SignupForm({ telegram }: { telegram?: TelegramSignInConfig | null }) {
  const router = useRouter();

  const signup = useAuthAction<SignupInput, SignupOutcome>(
    useCallback((input) => authRepository.signup(input), []),
  );

  const form = useAuthForm<SignupValues>({
    initial: { name: "", email: "", password: "", confirm: "", terms: false },
    validate: useCallback(
      (values: SignupValues) => ({
        name: validateName(values.name) ?? undefined,
        email: validateEmail(values.email) ?? undefined,
        password: validatePassword(values.password, { strict: true }) ?? undefined,
        confirm: validateConfirmation(values.password, values.confirm) ?? undefined,
        terms: values.terms ? undefined : AUTH_COPY.errors.termsRequired,
      }),
      [],
    ),
  });

  const handleSubmit = form.submit(async (values) => {
    const outcome = await signup.run({
      name: values.name.trim(),
      email: values.email.trim(),
      password: values.password,
    });
    if (!outcome) return;
    const { session, devCode } = outcome;
    persistSession(session);

    // An address the backend already accepted as confirmed (a test environment
    // with no inbox) has nothing to wait for.
    if (session.emailVerified) {
      router.replace(landingPathFor(session));
      return;
    }
    // `code` is only ever set where the backend hands the confirmation code
    // back, which is development — it saves a tester hunting through a log.
    const query = new URLSearchParams({ email: session.email });
    if (devCode) query.set("code", devCode);
    router.replace(`/verify-email?${query.toString()}`);
  });

  return (
    <AuthCard
      title={AUTH_COPY.signup.title}
      shakeKey={form.shakeKey}
      footer={
        <>
          {AUTH_COPY.signup.haveAccount}
          <Link href="/login" className={authLinkClasses}>
            {AUTH_COPY.signup.loginLink}
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {signup.error && <FormAlert>{signup.error.message}</FormAlert>}

        <TelegramSignIn config={telegram} />

        <AuthField id="name" label={AUTH_COPY.signup.name} error={form.errors.name} required>
          <AuthInput
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            placeholder={AUTH_COPY.signup.namePlaceholder}
            value={form.values.name}
            invalid={Boolean(form.errors.name)}
            aria-describedby={form.errors.name ? "name-error" : undefined}
            onChange={(event) => form.setValue("name", event.target.value)}
            onBlur={() => form.validateField("name")}
          />
        </AuthField>

        <AuthField id="email" label={AUTH_COPY.common.email} error={form.errors.email} required>
          <AuthInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={AUTH_COPY.common.emailPlaceholder}
            value={form.values.email}
            invalid={Boolean(form.errors.email)}
            aria-describedby={form.errors.email ? "email-error" : undefined}
            onChange={(event) => form.setValue("email", event.target.value)}
            onBlur={() => form.validateField("email")}
          />
        </AuthField>

        {/* The one (i) on this screen. The rule behind the strength bar is the
            only thing here a reader cannot work out from the label. */}
        <PasswordField
          id="password"
          label={AUTH_COPY.common.password}
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
          label={AUTH_COPY.signup.confirm}
          autoComplete="new-password"
          value={form.values.confirm}
          error={form.errors.confirm}
          onChange={(value) => form.setValue("confirm", value)}
          onBlur={() => form.validateField("confirm")}
        />

        <div className="flex flex-col gap-1">
          {/* The terms link sits beside the consent row rather than inside its
              label: nested inside, one tap both toggled the box and navigated
              away, and the link itself was 18px of a 44px row. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <label htmlFor="terms" className="t-subhead flex min-h-11 cursor-pointer items-center gap-2.5">
              <input
                id="terms"
                type="checkbox"
                checked={form.values.terms}
                aria-invalid={Boolean(form.errors.terms) || undefined}
                aria-describedby={form.errors.terms ? "terms-error" : undefined}
                onChange={(event) => form.setValue("terms", event.target.checked)}
                className="h-[18px] w-[18px] flex-none accent-[var(--color-accent-700)]"
              />
              {AUTH_COPY.signup.terms}
            </label>
            {/* `/terms`, not `/help`: the help centre is inside the app shell,
                which resolves a session before it renders, so the one required
                link on this form used to send a signed-out reader to /login
                and take the half-filled form with it. */}
            <Link href="/terms" className={authLinkClasses}>
              {AUTH_COPY.signup.termsLink}
            </Link>
          </div>
          {form.errors.terms && (
            <p id="terms-error" role="alert" className="t-footnote text-danger-fg">
              {form.errors.terms}
            </p>
          )}
        </div>

        <SubmitButton label={AUTH_COPY.signup.submit} loading={signup.loading} />
      </form>
    </AuthCard>
  );
}
