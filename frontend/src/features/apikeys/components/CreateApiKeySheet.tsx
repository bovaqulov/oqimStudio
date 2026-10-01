"use client";

import { useState, useTransition } from "react";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { Icon } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MainButton } from "@/lib/telegram/MainButton";
import { createApiKeyAction } from "../actions";
import { SCOPE_DEFINITIONS } from "../scopes";
import type { CreatedApiKey } from "../types";

/**
 * Naming a key and deciding what it may reach.
 *
 * Nothing is ticked to begin with. A default set would be a permission granted
 * by whoever wrote this file rather than by the person whose customer list it
 * opens — and the cost of the blank start is four taps at most, once, for a
 * credential that may live for years.
 *
 * Each row says what the scope *does* and carries the token underneath it, in
 * mono, because those are two different questions asked by the same person five
 * minutes apart: which of these do I want, and what do I write in my config.
 */
export function CreateApiKeySheet({
  onCreated,
  onClose,
}: {
  onCreated: (key: CreatedApiKey) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = name.trim().length > 0 && scopes.length > 0;

  function toggle(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  function submit() {
    if (!ready || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createApiKeyAction({ name, scopes });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // Straight to the caller, which swaps this sheet for the one that shows
      // the credential. It is never stored on the way.
      onCreated(result.key);
    });
  }

  return (
    <Modal open onClose={onClose} labelledBy="new-api-key-title" className="max-w-[520px]" detent="medium">
      <div className="flex flex-none items-center gap-2 px-4 py-3">
        <span id="new-api-key-title" className="t-headline min-w-0 flex-1 truncate">
          Yangi API kaliti
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="oq-press flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-800 text-neutral-500"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
        <Field label="Nomi" required>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="CRM ulanish"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="t-footnote t-secondary">Bu kalit nima qila oladi</span>
          {SCOPE_DEFINITIONS.map((definition) => (
            <CheckboxRow
              key={definition.key}
              checked={scopes.includes(definition.key)}
              label={definition.label}
              hint={definition.key}
              onToggle={() => toggle(definition.key)}
            />
          ))}
          {scopes.length === 0 && (
            <span className="t-footnote t-tertiary">Kamida bittasini belgilang.</span>
          )}
        </div>

        {error && (
          <p role="alert" className="t-footnote m-0 text-danger-fg">
            {error}
          </p>
        )}
      </div>

      <MainButton
        inline
        text={pending ? "Yaratilmoqda…" : "Yaratish"}
        disabled={!ready}
        loading={pending}
        onClick={submit}
      />
    </Modal>
  );
}
