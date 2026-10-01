"use client";

import { useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { SampleFill } from "./SampleFill";
import { VariableMenu } from "./VariableMenu";
import { useVariableAutocomplete } from "./useVariableAutocomplete";

/** Single-line text field with `@` / `{{` variable autocomplete — used for condition and action values. */
export function VariableInput({
  value,
  onChange,
  placeholder,
  sample,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** A working example this field can be filled with while it is still empty. */
  sample?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { query, sync, openAt, select, close } = useVariableAutocomplete(onChange);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          ref={ref}
          value={value}
          placeholder={placeholder}
          /* What goes in here is `{{message.text}}`, `mijoz_ismi`, a regular
             expression — none of it prose, and every one of them underlined in
             red by the browser's dictionary. A red squiggle means "you made a
             mistake"; on a field whose correct contents are always spelled this
             way, it means it about every correct answer. The message body keeps
             its spellcheck, because that one really is prose a customer reads. */
          spellCheck={false}
          className="pr-7"
          onChange={(event) => {
            onChange(event.target.value);
            sync(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => {
            const el = event.target as HTMLInputElement;
            sync(el.value, el.selectionStart ?? el.value.length);
          }}
          onBlur={() => setTimeout(close, 120)}
        />
        <button
          type="button"
          title="Mijoz haqidagi ma'lumotni qo'shish"
          aria-label="O'zgaruvchi qo'shish"
          // The field keeps its selection, so the caret is still where the
          // insertion belongs by the time the click lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openAt(ref.current)}
          className="absolute top-1/2 right-0.5 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-accent-300 md:right-1.5 md:h-auto md:w-auto"
        >
          <Icon name="sparkle" size={16} className="md:hidden" />
          <Icon name="sparkle" size={12} className="hidden md:block" />
        </button>
        {query !== null && <VariableMenu query={query.text} onSelect={(path) => select(path, ref.current)} />}
      </div>
      {!!sample && !value.trim() && <SampleFill onFill={() => onChange(sample)} />}
    </div>
  );
}
