"use client";

import { useState } from "react";
import { FieldHint } from "./FieldHint";

/** BotFather's own rule for a command name: 1–32 characters of a–z, 0–9 and "_". */
const MAX_LENGTH = 32;

/** Where the counter starts showing — early enough to warn, late enough to stay out of the way. */
const COUNTER_FROM = MAX_LENGTH - 8;

/**
 * Anything Telegram would reject is dropped on the way in rather than saved and
 * left to fail later: a pasted "/Menu 2" becomes "menu2". Commands are matched
 * case-insensitively, so lowercasing loses nothing and keeps two blocks that
 * typed the same name in different cases from reading as different triggers.
 */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_LENGTH);
}

/**
 * Command name field. Every Telegram bot command starts with "/", so the slash
 * is furniture rather than something to type or delete — it is rendered outside
 * the input and the stored value never contains it.
 *
 * The well is a <label>, so the slash and the padding around it are click
 * targets for the field instead of dead space, and the focus ring sits on the
 * well rather than on the bare input inside it.
 */
export function CommandInput({
  value,
  onChange,
  reserved = [],
}: {
  value: string;
  onChange: (value: string) => void;
  /** Names this block may not take — "start" belongs to the module's main flow. */
  reserved?: string[];
}) {
  /*
   * What is being typed, while it is being typed. A reserved name is never
   * committed, and without a draft the refused keystroke would simply vanish
   * under the cursor with nothing said about why. Released on blur, so what is
   * left on screen is always the value that was actually saved.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const blocked = reserved.includes(shown);
  const remaining = MAX_LENGTH - shown.length;

  return (
    <>
      <label className="flex w-full cursor-text items-center rounded-md border border-transparent bg-neutral-800 px-3 text-[13px] max-md:text-[15px] focus-within:border-accent-500 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-500">
        <span aria-hidden className="flex-none text-neutral-500 select-none">
          /
        </span>
        <input
          value={shown}
          onChange={(event) => {
            const next = normalize(event.target.value);
            setDraft(next);
            if (!reserved.includes(next)) onChange(next);
          }}
          onBlur={() => setDraft(null)}
          placeholder="menyu"
          aria-label="Buyruq nomi"
          maxLength={MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-2 pl-0.5 text-text placeholder:text-neutral-600 focus-visible:outline-none"
        />
        {shown.length >= COUNTER_FROM && (
          <span className="flex-none pl-1.5 text-[10px] max-md:text-[12px] text-neutral-600 tabular-nums">{remaining}</span>
        )}
      </label>
      {blocked ? (
        <p className="text-[10.5px] max-md:text-[12px] leading-relaxed text-danger-fg">
          «/{shown}» band — bu buyruq bo&apos;limning asosiy oqimiga tegishli. Boshqa nom tanlang.
        </p>
      ) : (
        <FieldHint>Faqat kichik lotin harflari, raqamlar va «_» — {MAX_LENGTH} belgigacha.</FieldHint>
      )}
    </>
  );
}
