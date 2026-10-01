"use client";

import { useEffect, useRef } from "react";
import type { ColumnType } from "../types";
import { inputTypeFor } from "../values";

/**
 * One cell, open for typing.
 *
 * It sits inside the `td` it replaces and takes the whole of it, so the row
 * neither reflows nor jumps when a cell opens — the thing being edited stays
 * exactly where the reader was already looking, which is the whole difference
 * between a grid and a form.
 *
 * Keys are the ones a spreadsheet has taught everybody: Enter commits, Escape
 * abandons, Tab commits and moves on. Blur commits too — clicking away from a
 * half-typed price and losing it is the behaviour nobody expects and everybody
 * has been burned by.
 */
export function CellEditor({
  value,
  type,
  options,
  refRows,
  onChange,
  onCommit,
  onCancel,
  onNext,
}: {
  value: string;
  type: ColumnType;
  /** A `select` column's own list. Empty means it has not been written yet. */
  options?: string[];
  /** A `ref` column's candidates: the rows it may point at, already labelled. */
  refRows?: { id: string; label: string }[];
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Tab: commit and open the cell after this one. */
  onNext: (back: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Selected rather than appended to: a cell is opened to *replace* a value
    // far more often than to extend it, and a caret at the end makes the first
    // keystroke a mistake to undo.
    el.select();
  }, []);

  if (type === "ref") {
    return (
      <select
        autoFocus
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          queueMicrotask(onCommit);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
        className="w-full rounded-[6px] border border-accent-600 bg-neutral-900 px-2 py-1 text-[13px] text-text outline-none"
      >
        <option value="">—</option>
        {(refRows ?? []).map((row) => (
          <option key={row.id} value={row.id}>
            {row.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === "select" && options && options.length > 0) {
    return (
      <select
        autoFocus
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          queueMicrotask(onCommit);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
        className="w-full rounded-[6px] border border-accent-600 bg-neutral-900 px-2 py-1 text-[13px] text-text outline-none"
      >
        {/* The blank stays offered: a column added after the rows were written
            has no value in them, and a dropdown with no way back to "nothing"
            would force an answer onto every one of them. */}
        <option value="">—</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (type === "bool") {
    return (
      <select
        // A boolean is three states here — true, false, and "nobody said" —
        // because a column added after the rows were written has no value in
        // them, and forcing that to `false` is inventing an answer.
        autoFocus
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          // A select has no typing to finish: the choice *is* the commit.
          queueMicrotask(onCommit);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
        className="w-full rounded-[6px] border border-accent-600 bg-neutral-900 px-2 py-1 text-[13px] text-text outline-none"
      >
        <option value="">—</option>
        <option value="true">Ha</option>
        <option value="false">Yo&apos;q</option>
      </select>
    );
  }

  return (
    <input
      ref={ref}
      type={inputTypeFor(type)}
      value={value}
      inputMode={type === "number" ? "decimal" : undefined}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Tab") {
          event.preventDefault();
          onNext(event.shiftKey);
        }
      }}
      className="w-full rounded-[6px] border border-accent-600 bg-neutral-900 px-2 py-1 text-[13px] text-text outline-none"
    />
  );
}
