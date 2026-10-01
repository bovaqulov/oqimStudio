"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input, Textarea } from "@/components/ui/Input";
import { InfoTip } from "@/components/ui/InfoTip";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { cn } from "@/lib/utils/cn";
import { readList, readNumber, readText, readTimeRange, timeRangeValue, WEEKDAY_CHOICES } from "../lib/inputs";
import type { RecipeInput, RecipeValue, RecipeValues } from "../types";

/**
 * The one renderer for everything a recipe can ask.
 *
 * Recipes declare their questions (`RecipeInput`) and never write markup, so the
 * `business` module's working-hours picker and the `webapp` module's URL field
 * are the same two controls with different labels — and a module added later
 * inherits every fix made here. This is the whole reason the kit layer is
 * declarative.
 */
export function RecipeFields({
  inputs,
  values,
  onChange,
  missing,
}: {
  inputs: RecipeInput[];
  values: RecipeValues;
  onChange: (key: string, value: RecipeValue) => void;
  /** Keys of required answers the author has not filled in yet — highlighted, never hidden. */
  missing?: string[];
}) {
  if (!inputs.length) return null;

  const tipKey = tipOwner(inputs);

  return (
    <div className="flex flex-col gap-3.5">
      {inputs.map((input) => (
        <FieldShell
          key={input.key}
          input={input}
          invalid={missing?.includes(input.key) ?? false}
          tip={input.key === tipKey}
        >
          <RecipeField input={input} values={values} onChange={onChange} />
        </FieldShell>
      ))}
    </div>
  );
}

/**
 * Which single question, if any, is allowed the group's (i).
 *
 * A group of recipe questions *is* the screen inside the wizard sheet, and the
 * rule for a screen is one (i) at most. An (i) beside every label was the grey
 * paragraph under every label again, only folded — three of them stood on the
 * "buyruq" step alone, and a reader who has to open three dialogs to fill in
 * three fields has not been spared any reading.
 *
 * Collecting every hint into one bubble at the head of the group was the other
 * candidate, and it loses on a fact about the phone: inside Telegram `InfoTip`
 * hands its text to the client's `showAlert`, whose message is capped, and an
 * over-long popup is refused outright rather than trimmed. The longest groups
 * here — "Hisob yuborish", "Operatorga uzatish" — already run past that cap
 * once every sentence carries the label it belongs to, so the aggregate would
 * show the author nothing at all on exactly the screens that have the most to
 * explain. It also cuts every sentence loose from the field it belongs to:
 * four answers to hold in the head and match back to four labels by memory.
 *
 * So the glyph goes to the first question whose hint says something the screen
 * does not already say, and the rest of the group stays silent — their
 * sentences ride along as the label's `title`, which a pointer and assistive
 * tech can still reach, but nothing is drawn for them.
 */
function tipOwner(inputs: RecipeInput[]): string | undefined {
  return inputs.find(saysSomethingNew)?.key;
}

/**
 * Deliberately blunt: only a hint that is *literally* its own label or its own
 * placeholder is skipped. A cleverer test — a similarity score, a length floor
 * — would eventually decide that the one sentence a field genuinely needed was
 * obvious, and the author would never learn it was written.
 */
function saysSomethingNew(input: RecipeInput): boolean {
  const hint = plain(input.hint ?? "");
  if (!hint) return false;
  return hint !== plain(input.label) && hint !== plain(input.placeholder ?? "");
}

/** Case and punctuation folded away, so "Buyruq nomi." and "buyruq nomi" are one sentence. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function FieldShell({
  input,
  invalid,
  tip,
  children,
}: {
  input: RecipeInput;
  invalid: boolean;
  /** This field carries the group's one (i) — see `tipOwner`. */
  tip: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {/* The same label the shared `Field` draws — 13px at 60% ink above the
            well — so a recipe question and a hand-written form field read as
            one kind of thing rather than as two screens stitched together. */}
        <span className="t-footnote t-secondary" title={tip ? undefined : input.hint}>
          {input.label}
          {input.required && (
            <span className="ml-0.5 text-accent-400" aria-hidden>
              *
            </span>
          )}
        </span>
        {tip && input.hint && <InfoTip text={input.hint} align="start" />}
        {invalid && <span className="t-footnote text-danger-fg">— to&apos;ldirilishi kerak</span>}
      </div>
      <div className={cn(invalid && "rounded-md ring-1 ring-danger-fg/60")}>{children}</div>
    </div>
  );
}

function RecipeField({
  input,
  values,
  onChange,
}: {
  input: RecipeInput;
  values: RecipeValues;
  onChange: (key: string, value: RecipeValue) => void;
}) {
  switch (input.kind) {
    case "textarea":
      return (
        <div className="flex flex-col gap-1.5">
          {/* The quick-reply library: a ready answer is one tap, and stays
              editable text afterwards rather than becoming a locked template. */}
          {input.presets && input.presets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {input.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChange(input.key, preset.value)}
                  className="t-footnote t-secondary flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full bg-neutral-800 px-3 transition-colors hover:bg-neutral-700 hover:text-text md:min-h-[26px] md:px-2"
                >
                  <Icon name="lightning" size={13} />
                  {preset.label}
                </button>
              ))}
            </div>
          )}
          {/* No size override: the well's own 17px is the one the base layer
              keeps at 16px or more, which is what stops iOS zooming the sheet
              in the moment the field takes focus. */}
          <Textarea
            value={readTextRaw(values, input.key)}
            onChange={(event) => onChange(input.key, event.target.value)}
            placeholder={input.placeholder}
            rows={4}
          />
        </div>
      );

    case "keywords":
      return <KeywordsField input={input} values={values} onChange={onChange} />;

    case "choice":
      return (
        <div role="radiogroup" aria-label={input.label} className="grid gap-1.5 sm:grid-cols-2">
          {(input.choices ?? []).map((choice) => {
            const active = readText(values, input.key) === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={active}
                // The clamped hint below stays readable in full on a pointer,
                // the same way a `chips` option explains itself.
                title={choice.hint}
                onClick={() => onChange(input.key, choice.value)}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-accent-600 bg-accent-950"
                    : "border-neutral-800 bg-transparent hover:border-neutral-700 hover:bg-neutral-800/40",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[3px] flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border transition-colors",
                    active ? "border-accent-400 bg-accent-500" : "border-neutral-700",
                  )}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="t-subhead flex items-center gap-1.5">
                    {choice.icon && <Icon name={choice.icon} size={15} className="t-tertiary flex-none" />}
                    {choice.label}
                  </span>
                  {/* One line, always. What this option means is worth a glance,
                      but a list of options the reader is comparing has to stay
                      a list — two wrapped lines per row and it is prose again. */}
                  {choice.hint && <span className="t-footnote t-secondary line-clamp-1">{choice.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      );

    case "chips": {
      const selected = readList(values, input.key);
      return (
        <div role="group" aria-label={input.label} className="flex flex-wrap gap-1.5">
          {(input.choices ?? []).map((choice) => {
            const active = selected.includes(choice.value);
            return (
              <ToggleChip
                key={choice.value}
                select="multi"
                check
                active={active}
                title={choice.hint}
                onClick={() =>
                  onChange(
                    input.key,
                    active ? selected.filter((value) => value !== choice.value) : [...selected, choice.value],
                  )
                }
              >
                {choice.label}
              </ToggleChip>
            );
          })}
        </div>
      );
    }

    case "days": {
      const selected = readList(values, input.key);
      return (
        <div className="flex flex-col gap-1.5">
          <div role="group" aria-label={input.label} className="flex flex-wrap gap-1">
            {WEEKDAY_CHOICES.map((day) => {
              const active = selected.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  aria-label={day.hint}
                  onClick={() =>
                    onChange(
                      input.key,
                      active ? selected.filter((value) => value !== day.value) : [...selected, day.value],
                    )
                  }
                  className={cn(
                    // 44px tall on a phone even though the drawn pill is
                    // narrow: seven of these sit side by side, and a missed tap
                    // here silently sets the wrong day.
                    "t-footnote h-11 w-[38px] cursor-pointer rounded-md transition-colors md:h-[30px]",
                    active
                      ? "bg-accent-700 text-white"
                      : "t-secondary bg-neutral-800 hover:bg-neutral-700 hover:text-text",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1">
            <DayPreset label="Ish kunlari" days={["1", "2", "3", "4", "5"]} input={input} onChange={onChange} />
            <DayPreset label="Har kuni" days={["1", "2", "3", "4", "5", "6", "7"]} input={input} onChange={onChange} />
            <DayPreset label="Dam olish" days={["6", "7"]} input={input} onChange={onChange} />
          </div>
        </div>
      );
    }

    case "time-range": {
      const range = readTimeRange(values, input.key);
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="time"
            value={range.from}
            aria-label={`${input.label} — boshlanishi`}
            onChange={(event) => onChange(input.key, timeRangeValue(event.target.value, range.to))}
            className="w-[112px]"
          />
          <span className="t-subhead t-secondary">dan</span>
          <Input
            type="time"
            value={range.to}
            aria-label={`${input.label} — tugashi`}
            onChange={(event) => onChange(input.key, timeRangeValue(range.from, event.target.value))}
            className="w-[112px]"
          />
          <span className="t-subhead t-secondary">gacha</span>
        </div>
      );
    }

    case "number":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            value={String(readNumber(values, input.key, Number(input.default) || 0))}
            min={input.min}
            max={input.max}
            step={input.step}
            aria-label={input.label}
            onChange={(event) => onChange(input.key, Number(event.target.value))}
            className="w-[104px]"
          />
          {input.unit && <span className="t-subhead t-secondary">{input.unit}</span>}
        </div>
      );

    default:
      return (
        <Input
          value={readTextRaw(values, input.key)}
          onChange={(event) => onChange(input.key, event.target.value)}
          placeholder={input.placeholder}
          aria-label={input.label}
        />
      );
  }
}

/** Untrimmed, so a space typed mid-sentence survives the round trip through state. */
function readTextRaw(values: RecipeValues, key: string): string {
  const value = values[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return Array.isArray(value) ? value.join("\n") : "";
}

function DayPreset({
  label,
  days,
  input,
  onChange,
}: {
  label: string;
  days: string[];
  input: RecipeInput;
  onChange: (key: string, value: RecipeValue) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(input.key, days)}
      className="t-footnote t-secondary flex min-h-[44px] cursor-pointer items-center rounded-full bg-neutral-800 px-3 transition-colors hover:bg-neutral-700 hover:text-text md:min-h-[24px] md:px-2"
    >
      {label}
    </button>
  );
}

/**
 * Terms as chips rather than as a textarea of lines. A keyword list is a set of
 * small things, and a chip shows what is in the set at a glance — a five-line
 * textarea shows a wall of text the author has to re-read to be sure of.
 */
function KeywordsField({
  input,
  values,
  onChange,
}: {
  input: RecipeInput;
  values: RecipeValues;
  onChange: (key: string, value: RecipeValue) => void;
}) {
  const terms = readList(values, input.key);
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    // Commas as well as Enter: a list pasted from a note arrives comma-separated.
    const parts = raw
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !terms.includes(part));
    if (parts.length) onChange(input.key, [...terms, ...parts]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      {terms.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {/* The chip grows to 44px on a phone rather than the ✕ growing out of
              it: a 44px hit box hung on a 16px glyph would reach into the chip
              beside it, and removing the wrong term is a silent edit. */}
          {terms.map((term) => (
            <span
              key={term}
              className="t-footnote flex min-h-[44px] items-center gap-1 rounded-full bg-accent-800 pr-1 pl-3 text-accent-ink md:min-h-0 md:py-[3px] md:pl-2.5"
            >
              {term}
              <button
                type="button"
                aria-label={`«${term}» ni olib tashlash`}
                onClick={() => onChange(input.key, terms.filter((item) => item !== term))}
                className="flex h-11 w-9 cursor-pointer items-center justify-center rounded-full text-accent-200 transition-colors hover:bg-accent-700 hover:text-white md:h-4 md:w-4"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Backspace" && !draft && terms.length) {
              onChange(input.key, terms.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={input.placeholder ?? "So'z yozib Enter bosing"}
          aria-label={input.label}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          aria-label="So'zni qo'shish"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="t-secondary flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-md bg-neutral-800 transition-colors hover:bg-neutral-700 hover:text-text disabled:cursor-default disabled:opacity-40 md:h-[30px] md:w-[30px]"
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
    </div>
  );
}
