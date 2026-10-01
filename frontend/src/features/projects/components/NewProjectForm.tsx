"use client";

import Link from "next/link";
import { useActionState, useRef, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { MainButton } from "@/lib/telegram/MainButton";
import { NEW_PROJECT_IDLE } from "../action-types";
import { createProjectAction } from "../actions";

/**
 * "Yaratish", on Telegram's own button.
 *
 * `useFormStatus` only reports from inside the form, which is why the button
 * is a component and not a prop — the same shape `NewBotForm` uses.
 */
function SubmitButton({ formRef }: { formRef: RefObject<HTMLFormElement | null> }) {
  const { pending } = useFormStatus();
  return <MainButton text="Yaratish" loading={pending} inline onClick={() => formRef.current?.requestSubmit()} />;
}

/**
 * A project is a name. Everything else about it is decided later, by the bots
 * and flows that land in it.
 *
 * What this dropped: a numbered step chip for a one-step flow, a second title
 * inside the card repeating the one in the header, a decorative folder badge,
 * and two placeholders that instructed rather than showed ("Loyiha nomini
 * kiriting" under a label already reading "Nomi"). The placeholders are now
 * examples of a right answer, which is the only thing a placeholder can say
 * that the label cannot.
 */
export function NewProjectForm() {
  const [state, action] = useActionState(createProjectAction, NEW_PROJECT_IDLE);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <Field label="Nomi" required error={state.field === "name" ? state.error : null}>
        {/* No `required`: the browser's own bubble cannot say "a name of
            spaces is not a name", and it hides the message that can. */}
        <Input
          name="name"
          placeholder="Anvar Market"
          autoFocus
          aria-invalid={state.field === "name" || undefined}
          maxLength={120}
        />
      </Field>

      <Field label="Tavsif">
        <Textarea name="description" rows={3} placeholder="Instagram va Telegram buyurtmalari" />
      </Field>

      {/* A failure that belongs to no single input still has to be said. */}
      {state.error && !state.field && (
        <p role="alert" className="t-footnote m-0 text-danger-fg">
          {state.error}
        </p>
      )}

      {/* Both actions at the end of the form, the same row `NewBotForm` uses:
          reversed on a phone so the filled one sits lowest, side by side from
          `md`. Pinned to the viewport instead, this button ends up in the far
          corner of a wide window, a long way from the fields it submits. */}
      <div className="mt-1 flex flex-col-reverse gap-2 md:flex-row md:items-center md:gap-3">
        <SubmitButton formRef={formRef} />
        <Link
          href="/projects"
          className="oq-press t-body flex min-h-[44px] items-center justify-center px-1 text-accent-400 md:justify-start"
        >
          Bekor qilish
        </Link>
      </div>
    </form>
  );
}
