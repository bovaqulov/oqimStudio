"use client";

import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { cn } from "@/lib/utils/cn";
import type { PollConfig, PollOption } from "@/features/flows";
import type { LocalizedText } from "@/features/flows/localized-text";
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  createPollConfig,
  createPollOption,
} from "../../../lib/message-content";
import { FieldLabel } from "./FieldLabel";
import { LanguageTabs, LocalizedLabel, useLocalizedText } from "./TextLanguage";

/** `sendPoll` editor. In quiz mode one option has to be marked correct, so each row grows a selectable radio. */
export function PollField({ value, onChange }: { value?: PollConfig; onChange: (value: PollConfig) => void }) {
  const poll = value ?? createPollConfig();

  function commit(patch: Partial<PollConfig>) {
    onChange({ ...poll, ...patch });
  }
  function updateOption(id: string, text: LocalizedText) {
    commit({ options: poll.options.map((option) => (option.id === id ? { ...option, text } : option)) });
  }
  function removeOption(id: string) {
    commit({
      options: poll.options.filter((option) => option.id !== id),
      correctOptionId: poll.correctOptionId === id ? undefined : poll.correctOptionId,
    });
  }

  const question = useLocalizedText(poll.question, (next) => commit({ question: next }));

  return (
    <div className="flex flex-col gap-2.5">
      {/* A <div> rather than a <label>: the switch sits in the label row, and a
          label would forward clicks meant for it to the input. */}
      <div className="flex flex-col gap-1">
        <LocalizedLabel label="Savol" value={poll.question} />
        <Input
          value={question.value}
          onChange={(event) => question.onChange(event.target.value)}
          // An empty translation shows what goes out in its place, so leaving
          // one blank reads as a decision rather than as an unfinished poll.
          placeholder={question.fallback || "Qaysi kunni afzal ko'rasiz?"}
          maxLength={300}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <FieldLabel>Variantlar</FieldLabel>
          <span className="flex items-center gap-2 text-[10px] max-md:text-[12px] text-neutral-600">
            {poll.options.length}/{POLL_MAX_OPTIONS}
            {/* One switch for the list: the rows are one answer each to the
                same question, and translating them one at a time is not a
                thing anybody does. */}
            <LanguageTabs value={poll.options.map((option) => option.text)} />
          </span>
        </div>
        {poll.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            quiz={poll.isQuiz}
            correct={poll.correctOptionId === option.id}
            onMarkCorrect={() => commit({ correctOptionId: option.id })}
            onChange={(text) => updateOption(option.id, text)}
            onRemove={() => removeOption(option.id)}
            removable={poll.options.length > POLL_MIN_OPTIONS}
          />
        ))}
        {poll.options.length < POLL_MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => commit({ options: [...poll.options, createPollOption()] })}
            className="flex items-center gap-1 self-start rounded-md border border-dashed border-neutral-700 px-[10px] py-[5px] text-[11.5px] max-md:text-[13px] text-neutral-400 hover:border-accent-500 hover:text-accent-400"
          >
            <Icon name="plus" size={11} /> Variant
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel>Rejim</FieldLabel>
        <SegmentedTabs
          options={[
            { value: "regular", label: "Oddiy" },
            { value: "quiz", label: "Viktorina" },
          ]}
          value={poll.isQuiz ? "quiz" : "regular"}
          onChange={(mode) =>
            commit(
              mode === "quiz"
                ? // A quiz poll can only ever have one answer.
                  { isQuiz: true, allowsMultipleAnswers: false }
                : { isQuiz: false, correctOptionId: undefined },
            )
          }
        />
      </div>

      <CheckboxRow
        checked={poll.isAnonymous}
        onToggle={() => commit({ isAnonymous: !poll.isAnonymous })}
        label="Anonim ovoz berish"
      />
      {!poll.isQuiz && (
        <CheckboxRow
          checked={poll.allowsMultipleAnswers}
          onToggle={() => commit({ allowsMultipleAnswers: !poll.allowsMultipleAnswers })}
          label="Bir nechta javobga ruxsat"
        />
      )}
    </div>
  );
}

/**
 * One answer row. Its own component because `useLocalizedText` is a hook and
 * the list it is called for grows and shrinks under the author's hands.
 */
function OptionRow({
  option,
  quiz,
  correct,
  removable,
  onMarkCorrect,
  onChange,
  onRemove,
}: {
  option: PollOption;
  quiz: boolean;
  correct: boolean;
  removable: boolean;
  onMarkCorrect: () => void;
  onChange: (text: LocalizedText) => void;
  onRemove: () => void;
}) {
  const text = useLocalizedText(option.text, onChange);

  return (
    <div className="flex items-center gap-1.5">
      {quiz && (
        <button
          type="button"
          title="To'g'ri javob sifatida belgilash"
          onClick={onMarkCorrect}
          className={cn(
            "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border transition-colors",
            correct
              ? "border-accent-500 bg-accent-600 text-white"
              : "border-neutral-700 text-transparent hover:border-accent-600",
          )}
        >
          <Icon name="check" size={10} />
        </button>
      )}
      <Input
        value={text.value}
        onChange={(event) => text.onChange(event.target.value)}
        placeholder={text.fallback || "Variant"}
        maxLength={100}
        className="flex-1"
      />
      <IconButton icon="x" label="Variantni o'chirish" size={26} disabled={!removable} onClick={onRemove} />
    </div>
  );
}
