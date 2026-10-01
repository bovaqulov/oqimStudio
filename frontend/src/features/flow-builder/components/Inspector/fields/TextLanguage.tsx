"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { cn } from "@/lib/utils/cn";
import { rovingTarget } from "@/lib/utils/roving";
import { LANGUAGE_LABELS, LANGUAGE_TAGS } from "@/features/bots/languages";
import type { BotLanguage } from "@/features/bots/types";
import {
  DEFAULT_LANGUAGE,
  hasTranslation,
  resolveText,
  setTranslation,
  translatedCount,
  translationOf,
  type LocalizedText,
} from "@/features/flows/localized-text";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";
import { FieldLabel } from "./FieldLabel";

/**
 * Writing one block in more than one language without asking for more form.
 *
 * A bilingual bot doubles the number of strings an author owns, and the obvious
 * shape for that — a second textarea under the first, a third under that — is
 * exactly what makes a shop owner close the panel. So the languages are a
 * two-character switch in the corner of the field's own label row, and tapping
 * one swaps what that same field holds. The form is the same height whether the
 * bot speaks one language or three.
 */

interface ChosenLanguage {
  language: BotLanguage | null;
  choose: (language: BotLanguage) => void;
}

/**
 * Which language every text field is currently showing.
 *
 * A store rather than props or a provider for two reasons. It is one choice,
 * not one per field: an author translating a block into Russian means the
 * buttons as well as the message, and having to say so twice on one block is
 * the friction this feature exists to avoid. And it deliberately outlives the
 * selection — a translation pass moves down the flow block by block, and being
 * dropped back into Uzbek at every block would make it unusable.
 */
const useChosenLanguage = create<ChosenLanguage>((set) => ({
  language: null,
  choose: (language) => set({ language }),
}));

/** Shared so the "this bot has no languages configured" path allocates nothing new. */
const NO_LANGUAGES: BotLanguage[] = [];

/**
 * What the bot speaks, as far as the editor knows.
 *
 * Nothing about a bot with no languages configured behaves differently from how
 * it did before this file existed: no switcher, one text per field.
 */
function useBotLanguages(): { languages: BotLanguage[]; main: BotLanguage } {
  const stored = useFlowEditorStore((state) => state.botLanguages);
  const languages = stored?.enabled ?? NO_LANGUAGES;
  const main = stored?.main ?? DEFAULT_LANGUAGE;
  return useMemo(() => ({ languages, main }), [languages, main]);
}

/**
 * The bot's own language, and nothing about which one a field is open in.
 *
 * What everything outside the fields reads: the canvas, the edge chips, the
 * simple list, block search, the test chat. They all name what the bot sends by
 * default, so subscribing them to the switch as well would re-render the whole
 * graph on a tap that cannot change a single thing they draw.
 */
export function useBotMainLanguage(): BotLanguage {
  return useBotLanguages().main;
}

/** The language the fields of this block are being read and written in. */
export function useTextLanguage(): {
  languages: BotLanguage[];
  main: BotLanguage;
  language: BotLanguage;
  choose: (language: BotLanguage) => void;
} {
  const { languages, main } = useBotLanguages();
  const chosen = useChosenLanguage((state) => state.language);
  const choose = useChosenLanguage((state) => state.choose);
  // A language the bot has since stopped speaking — or one chosen on another
  // bot's flow — is not a language to edit in, and the bot's own always is.
  const language = chosen && languages.includes(chosen) ? chosen : main;
  return { languages, main, language, choose };
}

/**
 * Reading and writing one field's text in the chosen language.
 *
 * The field itself only ever sees `string` — a textarea has nothing to do with
 * a map — so this is the whole of the seam: what is stored comes in as
 * `LocalizedText`, what is typed goes back out as the shape the value already
 * had (see `setTranslation`, which keeps a single-language block a bare
 * string).
 */
export function useLocalizedText(
  value: LocalizedText | null | undefined,
  onChange: (value: LocalizedText) => void,
): {
  /** This language's own text — never another's, which would read as "already translated". */
  value: string;
  onChange: (text: string) => void;
  /** What the block would actually send — this language's text, or whatever stands in for it. */
  fallback: string;
  /** The bot's own language is showing, so nothing here is a translation. */
  isMain: boolean;
} {
  const { language, main } = useTextLanguage();
  const isMain = language === main;
  return {
    value: translationOf(value, language, main),
    onChange: (text) => onChange(setTranslation(value, language, text, main)),
    fallback: resolveText(value, language, main),
    isMain,
  };
}

const ARROW_KEYS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];

/**
 * `UZ | RU | EN` at the end of a label row.
 *
 * `value` is what the dots are computed from: one field's text, or every string
 * a field owns when the label stands for a list of them, as the button editor's
 * does. A field nobody has written anything in yet carries no dots at all — it
 * is empty, which the block's own warnings already say, and marking it as
 * untranslated in three languages says it three more times.
 */
export function LanguageTabs({ value }: { value: LocalizedText | LocalizedText[] }) {
  const { languages, main, language, choose } = useTextLanguage();
  const groupRef = useRef<HTMLSpanElement>(null);

  function move(key: string) {
    const next = languages[rovingTarget(key, languages.indexOf(language), languages.length)];
    if (!next) return;
    choose(next);
    // Chosen before focused, so the tab stop has already moved to the segment
    // by the time the browser looks for something to focus.
    queueMicrotask(() => groupRef.current?.querySelector<HTMLElement>(`[data-language="${next}"]`)?.focus());
  }

  // One language is no choice — and a bot with one is every bot written before
  // this existed, which is why that case renders nothing at all rather than a
  // disabled control.
  if (languages.length < 2) return null;
  const values = Array.isArray(value) ? value : [value];

  return (
    <span
      ref={groupRef}
      role="radiogroup"
      aria-label="Matn tili"
      className="flex flex-none items-center gap-px rounded bg-neutral-800 p-px"
      onKeyDown={(event) => {
        if (!ARROW_KEYS.includes(event.key)) return;
        event.preventDefault();
        move(event.key);
      }}
    >
      {languages.map((code) => {
        const active = code === language;
        const missing = values.some((item) => translatedCount(item) > 0 && !hasTranslation(item, code, main));
        return (
          <button
            key={code}
            type="button"
            role="radio"
            data-language={code}
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={missing ? `${LANGUAGE_LABELS[code]} — hali yozilmagan` : LANGUAGE_LABELS[code]}
            onClick={() => choose(code)}
            className={cn(
              // 16px tall on a phone was the worst target in the product — a
              // two-character pill sized for a mouse. On a phone it is a 36px
              // segment; the desktop corner switch is unchanged.
              "flex cursor-pointer items-center justify-center gap-[2px] rounded-full transition-colors",
              "min-h-[36px] min-w-[40px] px-2.5 text-[13px] font-medium",
              "md:min-h-0 md:min-w-0 md:rounded-[3px] md:px-1 md:py-[2px] md:text-[9.5px] md:leading-none md:tracking-[.04em]",
              active ? "bg-neutral-700 text-accent-300" : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            {LANGUAGE_TAGS[code]}
            {/* The dot is what keeps the row honest at a glance: this language
                has nothing written, so the bot will answer in another one. */}
            {missing && <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-warning-fg md:h-[3px] md:w-[3px]" />}
          </button>
        );
      })}
    </span>
  );
}

/**
 * A field's label with its language switch — [[FieldLabel]] plus the corner.
 *
 * The switch rides the row the label already occupies rather than taking one of
 * its own. That is the whole design: a form that grows by a row per field the
 * moment a bot speaks two languages is a form nobody translates.
 */
export function LocalizedLabel({
  label,
  value,
  className,
}: {
  label: ReactNode;
  /** The text the dots read — one value, or all of them when the label names a list. */
  value: LocalizedText | LocalizedText[];
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[36px] items-center gap-2 md:min-h-[15px]", className)}>
      <FieldLabel className="min-w-0 flex-1">{label}</FieldLabel>
      <LanguageTabs value={value} />
    </div>
  );
}
