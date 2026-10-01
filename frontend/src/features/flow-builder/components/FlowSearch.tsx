"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import { resolveText } from "@/features/flows/localized-text";
import { getNodeDefinition } from "../node-registry";
import { useBotMainLanguage } from "./Inspector/fields/TextLanguage";
import { useFlowEditorStore } from "../store/useFlowEditorStore";

/** How many hits the dropdown shows before it stops being faster than reading the canvas. */
const MAX_HITS = 8;

/**
 * Find a block by name. On a graph of forty blocks the canvas stops being a
 * place you can scan, so the editor gets the same affordance every long
 * document has — type part of a title, land on it selected and centred.
 */
export function FlowSearch() {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const focusNode = useFlowEditorStore((s) => s.focusNode);
  const main = useBotMainLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ⌘F / Ctrl+F is what people already press to find something in a document.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const hits = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return nodes
      .filter((node) => {
        const definition = getNodeDefinition(node.type);
        // The bot's own language, not the one a field is open in: search is a
        // way back to a block, and which block that is does not change with a
        // switch in the corner of a textarea.
        const body = resolveText(node.text, main, main);
        return `${node.title} ${body} ${definition.kindLabel}`.toLowerCase().includes(trimmed);
      })
      .slice(0, MAX_HITS);
  }, [nodes, query, main]);

  function go(index: number) {
    const node = hits[index];
    if (!node) return;
    const canvas = document.querySelector<HTMLDivElement>("[data-flow-canvas]");
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      focusNode(node.id, { width: rect.width, height: rect.height });
    }
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      {/* `h-7` and fully round to sit on the flow bar's one shape — see
          `FlowTopBar.BAR_CONTROL`. */}
      <label className="flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-850 px-3 focus-within:border-accent-600">
        <Icon name="magnifying-glass" size={12} className="flex-none text-neutral-600" />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (hits.length ? (index + 1) % hits.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (hits.length ? (index - 1 + hits.length) % hits.length : 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(activeIndex);
            } else if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="Blok qidirish"
          aria-label="Bloklar orasidan qidirish"
          className="w-[124px] border-none bg-transparent text-[11.5px] text-text placeholder:text-neutral-600 focus-visible:outline-none"
        />
        <kbd className="flex-none rounded border border-neutral-800 px-1 text-[9.5px] text-neutral-700">⌘F</kbd>
      </label>

      {open && query.trim() !== "" && (
        <div className="animate-rise absolute top-full right-0 z-40 mt-1.5 w-[248px] overflow-hidden rounded-[10px] border border-separator bg-overlay shadow-lg">
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-center text-[11.5px] text-neutral-600">Mos blok topilmadi.</div>
          ) : (
            hits.map((node, index) => {
              const definition = getNodeDefinition(node.type);
              return (
                <button
                  key={node.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(index)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left",
                    index === activeIndex ? "bg-neutral-800" : "bg-transparent",
                  )}
                >
                  <span
                    className="flex h-5 w-5 flex-none items-center justify-center rounded-md border border-neutral-700 bg-neutral-850"
                    style={{ color: definition.color }}
                  >
                    <Icon name={definition.icon} size={11} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-neutral-100">{node.title}</span>
                    <span className="block truncate text-[10.5px] text-neutral-600">
                      {definition.kindLabel} · {node.id}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
