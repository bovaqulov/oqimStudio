"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { applyMarkdown, type MarkdownAction } from "../../../lib/markdown";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { RichTextArea, type TextLike } from "./RichTextArea";
import { SampleFill } from "./SampleFill";
import { VariableMenu } from "./VariableMenu";
import { useVariableAutocomplete } from "./useVariableAutocomplete";

/**
 * The message/prompt/body editor everywhere. Typing `@` — or `{{`, for whoever
 * already knows the syntax — opens the variable picker, and the insertion
 * writes the braces so nobody has to remember that a placeholder takes two of
 * them on each side.
 *
 * The strip above the field replaces the old always-on formatting toolbar. Bold
 * and italic are used on a minority of messages and cost eight icons above
 * every textarea; the variable picker is used on most of them and had no
 * affordance at all. So the row says what the field can do, and the eight icons
 * appear when asked for. The toolbar stays attached to this field because it
 * acts on this field's selection — the block's "Qo'shimcha sozlamalar" drawer
 * is the wrong home for a tool that needs the caret.
 */
export function VariableTextarea({
  value,
  onChange,
  rows = 3,
  placeholder,
  markdown = false,
  sample,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  /** Shows the formatting toggle — only for text Telegram actually renders with a `parse_mode`. */
  markdown?: boolean;
  /** A working example this field can be filled with while it is still empty. */
  sample?: string;
}) {
  /*
   * A caret and a value, which is all the toolbar and the variable picker ever
   * wanted from a textarea. `RichTextArea` hands back that same shape, so both
   * of them work here unchanged — see [[TextLike]].
   */
  const ref = useRef<TextLike | null>(null);
  const [formatting, setFormatting] = useState(false);
  const { query, sync, openAt, select, close } = useVariableAutocomplete(onChange);

  function applyAction(action: MarkdownAction) {
    const el = ref.current;
    if (!el) return;
    // A field with no selection formats at the end of what is there, which is
    // where somebody who pressed «Qalin» before typing anything expects to land.
    const start = el.selectionStart ?? value.length;
    const edit = applyMarkdown(value, start, el.selectionEnd ?? start, action);
    onChange(edit.next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {!!sample && !value.trim() && <SampleFill onFill={() => onChange(sample)} />}
        <span className="flex-1" />
        <StripButton
          icon="sparkle"
          label="O'zgaruvchi"
          title="Mijoz haqidagi ma'lumotni qo'shish"
          onClick={() => openAt(ref.current)}
        />
        {markdown && (
          <StripButton
            icon="text-aa"
            label="Formatlash"
            title="Qalin, qiya, havola"
            active={formatting}
            onClick={() => setFormatting((open) => !open)}
          />
        )}
      </div>
      {markdown && formatting && <MarkdownToolbar onApply={applyAction} />}
      <div className="relative">
        <RichTextArea
          handle={ref}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onCaret={sync}
          onBlur={() => setTimeout(close, 120)}
        />
        {query !== null && <VariableMenu query={query.text} onSelect={(path) => select(path, ref.current)} />}
      </div>
    </div>
  );
}

function StripButton({
  icon,
  label,
  title,
  active = false,
  onClick,
}: {
  icon: "sparkle" | "text-aa";
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      // The textarea keeps its selection, so the caret is still where the
      // insertion belongs by the time the click lands.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        // 24px was a mouse target on a strip a thumb has to hit. 36px on a
        // phone, unchanged from `md:` up.
        "flex cursor-pointer items-center gap-1.5 rounded-full transition-colors",
        "min-h-[40px] px-3.5 text-[13px] font-medium",
        "md:min-h-0 md:gap-1 md:rounded md:px-1.5 md:py-[2px] md:text-[10.5px]",
        active ? "bg-neutral-800 text-accent-300" : "text-neutral-500 hover:text-neutral-300",
      )}
    >
      <Icon name={icon} size={15} className="flex-none md:hidden" />
      <Icon name={icon} size={11} className="hidden flex-none md:block" />
      {label}
    </button>
  );
}
