"use client";

import { Icon } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useCommandPaletteStore } from "./command-store";

/**
 * The visible half of ⌘K. A shortcut nobody is told about is a shortcut nobody
 * uses, so the palette also has a field-shaped button at the top of the
 * sidebar — it opens the same dialog.
 *
 * In the rail it keeps its place and loses its field: the magnifier alone is
 * the one icon here that needs no label to be read, and dropping it would take
 * search out of the sidebar for anyone who collapsed it.
 */
export function SidebarSearch() {
  const show = useCommandPaletteStore((state) => state.show);
  const t = useT();

  return (
    <button
      type="button"
      onClick={show}
      aria-label={t.chrome.search}
      className="oq-press oq-rail-row mx-2.5 mb-2 flex h-9 cursor-pointer items-center gap-2 rounded-[10px] bg-neutral-800 px-2.5 text-left"
    >
      <Icon name="magnifying-glass" size={16} className="flex-none text-neutral-500" />
      {/* Both of these were the palest ink in the product and sat on the palest
          surface. The placeholder is secondary now and the shortcut hint reads
          as a key, not as a whisper. */}
      <span className="t-subhead t-secondary oq-rail-hide flex-1">{t.chrome.searchPlaceholder}</span>
      <kbd className="t-caption t-tertiary oq-rail-hide rounded-[6px] bg-neutral-900 px-1.5 py-px">⌘K</kbd>
    </button>
  );
}
