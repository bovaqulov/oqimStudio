"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import type { FlowNode, LanguageConfig, LanguageOption } from "@/features/flows";
import { LANGUAGE_VARIABLE, nextLanguageOption, nodeLanguages } from "../../../lib/message-content";
import { ContentIssues } from "./ContentIssues";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";

/**
 * The languages this bot offers, as a label and the code stored behind it.
 *
 * The code is what everything downstream compares against, so it is edited
 * beside the label rather than derived from it — "🇷🇺 Русский" is not a string
 * anything can turn into "ru" reliably.
 */
export function LanguageField({ node, onChange }: { node: FlowNode; onChange: (value: LanguageConfig) => void }) {
  const options = nodeLanguages(node).options;

  function commit(next: LanguageOption[]) {
    onChange({ options: next });
  }
  function update(id: string, patch: Partial<LanguageOption>) {
    commit(options.map((option) => (option.id === id ? { ...option, ...patch } : option)));
  }

  // The next language to offer, or null once all three are on the list.
  const next = nextLanguageOption(options);

  const issues: string[] = [];
  if (options.length < 2) issues.push("Kamida ikkita til bo'lishi kerak — bitta tilni tanlash tanlov emas.");
  // Still checked, because a block saved before the button filled its rows in
  // can carry blank ones — but nothing in the panel can produce them any more.
  if (options.some((option) => !option.code.trim() || !option.label.trim())) {
    issues.push("Har bir tilda kod ham, yozuv ham bo'lishi kerak.");
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Tillar</FieldLabel>
      {options.map((option) => (
        /*
         * One field, not two, and the row is allowed to shrink.
         *
         * The code used to be edited beside the label. Two things were wrong
         * with that. `Input` carries `w-full` of its own and `cn` is plain
         * clsx, so the narrower field's `w-[64px]` did not win — the code took
         * the whole row, the label collapsed to an empty-looking box, and the
         * ✕ was pushed off the panel, which is what made a language
         * impossible to remove. And the code is not the author's to type any
         * more: "+ Til" only ever adds a language the runtime knows, so a
         * free-typed one could only be wrong. It is shown, not edited — to
         * change it, remove the row and add the language you meant.
         *
         * `min-w-0` is what lets a flex item shrink below its content at all,
         * and `flex-none` is what keeps the ✕ from being the thing that gives.
         */
        <div key={option.id} className="flex min-w-0 items-center gap-1.5">
          <span className="flex-none text-accent-400">
            <Icon name="globe-hemisphere-west" size={13} />
          </span>
          <Input
            value={option.label}
            onChange={(event) => update(option.id, { label: event.target.value })}
            placeholder="🇺🇿 O'zbekcha"
            className="min-w-0 flex-1"
          />
          <span
            title="Til kodi — oqim va kontakt shu kod bilan ishlaydi"
            className="flex-none rounded-md bg-neutral-800 px-2 py-1 font-mono text-[11px] text-neutral-500"
          >
            {option.code.trim() || "—"}
          </span>
          <IconButton
            icon="x"
            label="Tilni olib tashlash"
            size={24}
            className="flex-none"
            onClick={() => commit(options.filter((item) => item.id !== option.id))}
          />
        </div>
      ))}
      {/* Adds the next language the bot actually speaks, filled in — not a
          blank pair of fields for the author to guess a code into. Inert once
          all three are listed, with the reason on it rather than vanishing. */}
      <button
        type="button"
        disabled={!next}
        title={next ? `«${next.label}» qo'shiladi` : "Uchala til ham ro'yxatda"}
        onClick={() => next && commit([...options, next])}
        className="flex w-fit cursor-pointer items-center gap-1 rounded-md border border-dashed border-neutral-700 px-[10px] py-[5px] text-[11.5px] max-md:text-[13px] text-neutral-400 hover:border-accent-500 hover:text-accent-400 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-neutral-600 disabled:hover:border-neutral-800"
      >
        <Icon name="plus" size={11} /> {next ? next.label : "Til"}
      </button>

      <ContentIssues issues={issues} />

      <FieldHint>
        Tanlangan til kontaktga <span className="text-neutral-300">{LANGUAGE_VARIABLE}</span> nomi bilan yoziladi.
        Blokning bitta chiqishi bor — qaysi til tanlansa ham oqim bir xil davom etadi.
      </FieldHint>
      {/* The bot's own list has the last word at send time, so a language
          listed here but switched off there simply never appears — better said
          in the panel than discovered in a chat. */}
      <FieldHint>
        Faqat bot sozlamalarida yoqilgan tillar yuboriladi. Yangi til qo&apos;shsangiz, uni bot sozlamalarida ham
        yoqing.
      </FieldHint>
    </div>
  );
}
