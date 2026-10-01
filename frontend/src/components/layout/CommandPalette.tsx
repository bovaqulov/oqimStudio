"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { SearchItem } from "@/features/search/get-search-index";
import { useT } from "@/lib/i18n/LocaleProvider";
import { cn } from "@/lib/utils/cn";
import { useCommandPaletteStore } from "./command-store";

/** Kept small on purpose — a palette that scrolls past a screenful stops being faster than the sidebar. */
const MAX_RESULTS = 12;

/**
 * How well `item` answers `query`: 2 for a label that starts with it, 1 for a
 * hit anywhere in the label, meta or hidden keywords, 0 for no match. Ranking
 * on this is what puts "Botlar" above "Chatbot sozlamalari" for "bot".
 */
function score(item: SearchItem, query: string): number {
  const label = item.label.toLowerCase();
  if (label.startsWith(query)) return 2;
  const haystack = `${label} ${item.meta.toLowerCase()} ${item.keywords ?? ""}`;
  return haystack.includes(query) ? 1 : 0;
}

/**
 * ⌘K / Ctrl+K search over every project, bot, oqim and screen in the app.
 * Mounted once by the app shell; the index is built on the server and handed
 * down, so opening the palette costs no request.
 */
export function CommandPalette({ items }: { items: SearchItem[] }) {
  const open = useCommandPaletteStore((state) => state.open);
  const hide = useCommandPaletteStore((state) => state.hide);
  const toggle = useCommandPaletteStore((state) => state.toggle);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  if (!open) return null;

  // Mounted only while open, so the query and the highlighted row start clean
  // on every opening without an effect resetting them afterwards.
  return (
    <Modal open onClose={hide} labelledBy="command-palette-input" className="mt-[12vh] max-w-[560px] self-start">
      <PaletteContent items={items} onClose={hide} />
    </Modal>
  );
}

function PaletteContent({ items, onClose }: { items: SearchItem[]; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The dialog takes focus first (so a screen reader reads its name); the field
  // claims it on the next tick.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    // No query yet: the palette is a shortcut list, so show the top of the
    // index rather than an empty box.
    if (!trimmed) return items.slice(0, MAX_RESULTS);
    return items
      .map((item) => ({ item, rank: score(item, trimmed) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.item);
  }, [items, query]);

  // Keeps the highlighted row visible while arrowing past the panel's edge.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  function go(item: SearchItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-neutral-900 px-4 py-3">
        <Icon name="magnifying-glass" size={15} className="flex-none text-neutral-600" />
        <input
          id="command-palette-input"
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(results[activeIndex]);
            }
          }}
          placeholder={t.chrome.palette.placeholder}
          aria-label={t.chrome.palette.label}
          className="min-w-0 flex-1 border-none bg-transparent text-[17px] text-text placeholder:text-neutral-600 focus-visible:outline-none md:text-[13.5px]"
        />
        <kbd className="t-caption hidden flex-none rounded-[6px] bg-neutral-800 px-1.5 py-0.5 text-neutral-500 md:block">Esc</kbd>
      </div>

      {/* On a phone the palette is a full-height sheet, so the list has to take
          the space rather than cap itself — a capped list leaves the hint bar
          stranded mid-screen with dead space under it. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[52vh] md:flex-none">
        {results.length === 0 ? (
          <div className="t-subhead t-tertiary px-3 py-6 text-center">
            {t.chrome.palette.empty(query)}
          </div>
        ) : (
          results.map((item, index) => (
            <button
              key={item.id}
              type="button"
              data-active={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => go(item)}
              className={cn(
                "flex min-h-[48px] w-full cursor-pointer items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left md:min-h-0",
                index === activeIndex ? "bg-neutral-800" : "bg-transparent",
              )}
            >
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400 md:h-6 md:w-6">
                <Icon name={item.icon} size={12} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] text-neutral-100 md:text-[12.5px]">{item.label}</span>
                <span className="t-footnote t-tertiary block truncate">{item.meta}</span>
              </span>
              <span className="t-footnote t-tertiary hidden flex-none md:block">{item.group}</span>
            </button>
          ))
        )}
      </div>

      <div className="t-footnote t-tertiary hidden items-center gap-3 border-t border-separator px-4 py-2 md:flex">
        <span>{t.chrome.palette.hintSelect}</span>
        <span>{t.chrome.palette.hintOpen}</span>
        <span className="ml-auto">⌘K / Ctrl+K</span>
      </div>
    </>
  );
}
