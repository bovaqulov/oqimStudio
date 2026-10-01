"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { createWorkspaceForUserAction, joinWorkspaceWithCodeAction } from "../actions";
import { useAuthAction } from "../hooks/useAuthAction";
import { AUTH_COPY } from "../messages";
import { persistSession, readSession } from "../session-client";
import { AuthFailure } from "../data/auth-repository";
import { normalizeInviteCode, validateInviteCode, validateWorkspaceName } from "../validate";
import { AuthCard, authLinkClasses } from "./AuthCard";
import { AuthField, AuthInput } from "./AuthField";
import { FormAlert } from "./FormAlert";
import { SubmitButton } from "./SubmitButton";
import { useAuthForm } from "./useAuthForm";

const LOCALES = [
  { value: "uz-UZ", label: "O'zbekcha" },
  { value: "ru-RU", label: "Русский" },
  { value: "en-US", label: "English" },
];

interface JoinValues extends Record<string, string | boolean> {
  code: string;
}
interface CreateValues extends Record<string, string | boolean> {
  workspaceName: string;
  locale: string;
}

/**
 * The step between "account exists" and "there is something to work on".
 *
 * Two ways in, because both are common on day one: join the team that invited
 * you, or start your own. Whichever runs, the result is the same — a workspace
 * id on the session, which is what every tenant-scoped screen needs.
 *
 * The picker is the segmented control the rest of the app uses, at two words
 * per segment rather than four: "Taklif kodi bilan qo'shilish" does not fit a
 * half-width segment on a 390px screen without shrinking below reading size.
 *
 * `adding` is the same screen opened on purpose from the workspace switcher by
 * somebody who already has one. Two things change, and neither is the form:
 * the tab opens on "Yaratish", because "+ Yangi ish maydoni" already said which
 * half they wanted, and there is a way out — a mandatory step has nowhere to
 * cancel to, this does, and a screen that traps someone who was only curious
 * costs more than the line it takes to let them leave.
 */
export function WorkspaceOnboarding({ adding = false }: { adding?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"join" | "create">(adding ? "create" : "join");

  // Neither action is told who is asking: the session cookie carries that, and
  // a client that could name a different user would be a client that could
  // join somebody else's workspace.
  const join = useAuthAction<JoinValues, { workspaceId: string }>(
    useCallback(async (values: JoinValues) => {
      // Normalised again here and not only in the validator: the validator says
      // yes or no, this is what actually travels, and what the reader pasted was
      // most likely the whole `/join/<code>` link.
      const result = await joinWorkspaceWithCodeAction({ code: normalizeInviteCode(values.code) });
      // `AuthFailure` and not a plain `Error`: `toAuthError` reads the type to
      // decide whether the throw carries a sentence worth showing. A plain
      // `Error` was treated as an unrecognised failure, so "Taklif kodi yaroqsiz
      // yoki muddati tugagan" reached the reader as "Aloqa uzildi. Internetni
      // tekshirib, qayta urinib ko'ring." — advice to check the wifi over a typo.
      if ("error" in result) throw new AuthFailure("invalid_token", result.error, "code");
      return result;
    }, []),
  );

  const create = useAuthAction<CreateValues, { workspaceId: string }>(
    useCallback(async (values: CreateValues) => {
      const result = await createWorkspaceForUserAction({
        name: values.workspaceName.trim(),
        locale: values.locale,
      });
      if ("error" in result) throw new AuthFailure("server_error", result.error);
      return result;
    }, []),
  );

  const joinForm = useAuthForm<JoinValues>({
    initial: { code: "" },
    validate: useCallback((values: JoinValues) => ({ code: validateInviteCode(values.code) ?? undefined }), []),
  });

  const createForm = useAuthForm<CreateValues>({
    initial: { workspaceName: "", locale: "uz-UZ" },
    validate: useCallback(
      (values: CreateValues) => ({ workspaceName: validateWorkspaceName(values.workspaceName) ?? undefined }),
      [],
    ),
  });

  function enterWorkspace(workspaceId: string) {
    const current = readSession();
    if (current) persistSession({ ...current, workspaceId }, true);
    router.replace("/dashboard");
  }

  /*
   * A failure belongs to the form that produced it. Switching tabs used to
   * leave the red banner standing over the other half — and switching back
   * brought it out again, still describing a submit from several minutes ago.
   */
  function switchTab(next: "join" | "create") {
    join.reset();
    create.reset();
    setTab(next);
  }

  const handleJoin = joinForm.submit(async (values) => {
    const result = await join.run(values);
    if (result) enterWorkspace(result.workspaceId);
  });

  const handleCreate = createForm.submit(async (values) => {
    const result = await create.run(values);
    if (result) enterWorkspace(result.workspaceId);
  });

  return (
    <AuthCard
      title={adding ? AUTH_COPY.workspace.addTitle : AUTH_COPY.workspace.title}
      shakeKey={tab === "join" ? joinForm.shakeKey : createForm.shakeKey}
      width={440}
      footer={
        adding ? (
          <Link href="/dashboard" className={authLinkClasses}>
            {AUTH_COPY.workspace.cancel}
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label={AUTH_COPY.workspace.title}
          options={[
            { value: "join", label: AUTH_COPY.workspace.joinTab },
            { value: "create", label: AUTH_COPY.workspace.createTab },
          ]}
          value={tab}
          onChange={switchTab}
        />

        {tab === "join" ? (
          <form method="post" onSubmit={handleJoin} noValidate className="flex flex-col gap-4">
            {/* Not `font-mono` upper-cased any more: the value is lower-case
                hex, and a full `/join/<code>` link pasted in whole is the
                commonest thing to arrive here — `normalizeInviteCode` takes the
                last segment out of it. */}
            <AuthField id="code" label={AUTH_COPY.workspace.code} error={joinForm.errors.code} required>
              <AuthInput
                id="code"
                name="code"
                autoFocus
                autoComplete="one-time-code"
                placeholder={AUTH_COPY.workspace.codePlaceholder}
                value={joinForm.values.code}
                invalid={Boolean(joinForm.errors.code)}
                aria-describedby={joinForm.errors.code ? "code-error" : undefined}
                onChange={(event) => joinForm.setValue("code", event.target.value)}
                onBlur={() => joinForm.validateField("code")}
                className="font-mono tracking-[.08em]"
              />
            </AuthField>
            <SubmitButton label={AUTH_COPY.workspace.join} loading={join.loading} />
            {/* Under the button, not over it. A banner appearing above the
                submit pushes the submit down by its own height, and the reader
                whose finger was already on the way presses whatever slid into
                that spot — reported as a click that "did nothing". Below it,
                the button never moves; `role="alert"` still speaks first. */}
            {join.error && <FormAlert>{join.error.message}</FormAlert>}
          </form>
        ) : (
          <form method="post" onSubmit={handleCreate} noValidate className="flex flex-col gap-4">
            <AuthField
              id="workspaceName"
              label={AUTH_COPY.workspace.name}
              error={createForm.errors.workspaceName}
              required
            >
              <AuthInput
                id="workspaceName"
                name="workspaceName"
                autoFocus
                autoComplete="organization"
                placeholder={AUTH_COPY.workspace.namePlaceholder}
                value={createForm.values.workspaceName}
                invalid={Boolean(createForm.errors.workspaceName)}
                aria-describedby={createForm.errors.workspaceName ? "workspaceName-error" : undefined}
                onChange={(event) => createForm.setValue("workspaceName", event.target.value)}
                onBlur={() => createForm.validateField("workspaceName")}
              />
            </AuthField>

            {/* One field, so no two-column grid. The currency that used to sit
                beside it is gone: nothing in the product read it except the
                revenue line on the analytics screens, and asking for it on the
                way in made a choice out of something the reader had no way to
                judge yet. */}
            <AuthField id="locale" label={AUTH_COPY.workspace.locale}>
              <Select
                id="locale"
                name="locale"
                value={createForm.values.locale}
                onChange={(event) => createForm.setValue("locale", event.target.value)}
              >
                {LOCALES.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </Select>
            </AuthField>

            <SubmitButton label={AUTH_COPY.workspace.create} loading={create.loading} />
            {create.error && <FormAlert>{create.error.message}</FormAlert>}
          </form>
        )}
      </div>
    </AuthCard>
  );
}
