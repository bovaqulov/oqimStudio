"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Switch } from "@/components/ui/Switch";
import type { KeywordMatch } from "@/features/flows";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { RevealPanel } from "./RevealPanel";

/** Short enough to fit the inspector's width; the hint below carries the meaning. */
const MATCH_OPTIONS: { value: KeywordMatch; label: string }[] = [
  { value: "exact", label: "Aniq" },
  { value: "contains", label: "Ichida" },
  { value: "regex", label: "Regex" },
];

const MATCH_HINTS: Record<KeywordMatch, string> = {
  exact: "Xabar matni qatorlardan biriga to'liq teng bo'lsa ishga tushadi.",
  contains: "Xabar ichida shu so'zlardan biri uchrasa yetarli.",
  regex: "Har bir qator alohida naqsh sifatida tekshiriladi.",
};

const PLACEHOLDERS: Record<KeywordMatch, string> = {
  exact: "narx\nnarxi qancha",
  contains: "narx\nqancha turadi",
  regex: "^/buyurtma\\s+(\\d+)$\n(narx|qancha)",
};

/** Labels are clipped to fit two-up in the inspector; `hint` carries the full meaning on hover. */
const FLAGS: { flag: string; label: string; hint: string }[] = [
  { flag: "i", label: "Harf farqsiz", hint: "i — katta-kichik harf farqlanmasin" },
  { flag: "m", label: "Ko'p qatorli", hint: "m — ^ va $ har bir qatorga alohida mos keladi" },
];

/** Non-empty terms, one per line — blank lines are just breathing room. */
function splitPatterns(keywords: string): { pattern: string; line: number }[] {
  return keywords
    .split("\n")
    .map((raw, index) => ({ pattern: raw.trim(), line: index + 1 }))
    .filter((entry) => entry.pattern.length > 0);
}

export function KeywordField({
  keywords,
  match,
  flags,
  onChange,
}: {
  keywords: string;
  match: KeywordMatch;
  flags: string;
  onChange: (patch: { keywords?: string; keywordMatch?: KeywordMatch; keywordFlags?: string }) => void;
}) {
  const [sample, setSample] = useState("");
  const patterns = splitPatterns(keywords);

  // Compiling on every render is what makes the errors and the tester live. The
  // list is a handful of short patterns, so there is nothing here worth caching.
  const compiled = patterns.map((entry) => {
    try {
      return { ...entry, regex: new RegExp(entry.pattern, flags), error: null as string | null };
    } catch (error) {
      return { ...entry, regex: null, error: (error as Error).message };
    }
  });

  const invalid = compiled.filter((entry) => entry.error);
  const matched = sample.trim() ? compiled.find((entry) => entry.regex?.test(sample)) : undefined;

  function toggleFlag(flag: string) {
    onChange({ keywordFlags: flags.includes(flag) ? flags.replace(flag, "") : flags + flag });
  }

  return (
    <>
      <FieldLabel>Izlash turi</FieldLabel>
      <SegmentedTabs
        options={MATCH_OPTIONS}
        value={match}
        onChange={(keywordMatch) => onChange({ keywordMatch })}
      />
      <FieldHint>{MATCH_HINTS[match]}</FieldHint>

      <Textarea
        rows={match === "regex" ? 3 : 2}
        value={keywords}
        onChange={(event) => onChange({ keywords: event.target.value })}
        placeholder={PLACEHOLDERS[match]}
        aria-label={match === "regex" ? "Regex naqshlari" : "Kalit so'zlar"}
        className={match === "regex" ? "font-mono text-[12px] max-md:text-[15px]" : undefined}
      />
      <FieldHint>Har bir qator — alohida variant.</FieldHint>

      {/*
       * The regex controls live behind their own mode on purpose: flags, pattern
       * errors and a tester are noise for the ninety percent of handlers that
       * only ever needed "contains".
       */}
      {match === "regex" && (
        <RevealPanel nested>
          <FieldLabel>Naqsh sozlamalari</FieldLabel>
          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            {FLAGS.map((item) => (
              <Switch
                key={item.flag}
                checked={flags.includes(item.flag)}
                label={item.label}
                onToggle={() => toggleFlag(item.flag)}
              />
            ))}
          </div>

          {invalid.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md bg-danger-bg px-2 py-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed text-danger-fg">
              {invalid.slice(0, 2).map((entry) => (
                <span key={entry.line}>
                  {entry.line}-qator xato: {entry.error}
                </span>
              ))}
            </div>
          )}

          <FieldLabel>Sinov matni</FieldLabel>
          <Input
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder="Naqshni shu yerda sinab ko'ring"
            className="text-[12px] max-md:text-[15px]"
          />
          {sample.trim() && (
            <p className={`text-[10.5px] max-md:text-[12px] ${matched ? "text-success-fg" : "text-neutral-500"}`}>
              {matched ? `Mos keldi — ${matched.line}-qator naqshi` : "Hech bir naqsh mos kelmadi"}
            </p>
          )}
        </RevealPanel>
      )}
    </>
  );
}
