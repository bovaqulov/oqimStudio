"use client";

import { Icon } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n/LocaleProvider";
import { cn } from "@/lib/utils/cn";

/**
 * The iOS search field: 44px, a 10px radius, the glass inside the well rather
 * than beside it, and a clear button that only exists once there is something
 * to clear.
 *
 * One component because two screens grew their own — a bordered 30px box on
 * /bots and another on /contacts — and a search field that looks different on
 * two lists reads as two different products.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Say what is being searched when "Qidirish" is not specific enough. */
  placeholder?: string;
  className?: string;
}) {
  // Out of the parameter list because a default value cannot call a hook. Every
  // call site today names what it is searching ("Bot nomi yoki holati") and so
  // owns its own words; the bare "Qidirish" is what the next one gets for free.
  const t = useT();

  return (
    <label className={cn("flex h-11 items-center gap-2 rounded-[10px] bg-neutral-800 px-3", className)}>
      <Icon name="magnifying-glass" size={17} className="flex-none text-neutral-600" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t.ui.search}
        type="search"
        className="min-w-0 flex-1 border-none bg-transparent text-[17px] text-text placeholder:text-neutral-600 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t.ui.clear}
          className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full bg-neutral-700 text-neutral-400"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </label>
  );
}
