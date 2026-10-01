"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchField } from "@/components/ui/SearchField";
import { cn } from "@/lib/utils/cn";
import { MAX_VARIABLE_COLUMNS, serializeColumns, toggleColumn } from "../columns";
import type { ContactFilters } from "../types";

export interface FilterOption {
  value: string;
  label: string;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="t-footnote t-secondary">{children}</span>;
}

function SelectFilter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: FilterOption[];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        name={name}
        defaultValue={value}
        className="h-11 w-full cursor-pointer rounded-[12px] border-0 bg-neutral-800 px-3 text-[15px] text-text outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset md:min-w-[130px]"
      >
        <option value="">Barchasi</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * How the list is narrowed, and which collected variables it shows as columns.
 *
 * A plain GET form rather than a client-side filter: the URL of a filtered list
 * is a link somebody can send to a colleague, and the same parameters are what
 * the CSV export is built from.
 *
 * On a phone the seven controls fold behind one line whose label counts what is
 * active — a screen that opens on a form is a screen that has not answered the
 * question it was opened with, and the question here is "who wrote to my bot".
 * A mouse keeps the row it always had: the disclosure is a `max-md:` class, not
 * a second layout.
 */
export function ContactFilterForm({
  filters,
  filterEntries,
  columns,
  pickerKeys,
  projects,
  bots,
  flows,
}: {
  filters: ContactFilters;
  /** The active filters as name/value pairs — what a column link has to carry over. */
  filterEntries: [string, string][];
  columns: string[];
  /** Every variable that could be a column, including ones the filters hid. */
  pickerKeys: string[];
  /** Only drawn when the workspace has more than one — one project is not a choice. */
  projects: FilterOption[];
  bots: FilterOption[];
  flows: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(filters.q ?? "");
  const activeCount = filterEntries.length;

  /** The same list, with one variable column added or dropped. */
  function columnHref(name: string): string {
    const next = new URLSearchParams(filterEntries);
    const chosen = toggleColumn(columns, name);
    if (chosen.length) next.set("columns", serializeColumns(chosen));
    const query = next.toString();
    return query ? `/contacts?${query}` : "/contacts";
  }

  const clearHref = columns.length
    ? `/contacts?columns=${encodeURIComponent(serializeColumns(columns))}`
    : "/contacts";

  return (
    <>
      {/* Search is always on screen and is its own form: it is the question this
          page is opened with, and a reader should not have to open a filter
          panel to ask it. Everything else stays folded. */}
      <form method="get" className="mb-3 flex flex-col gap-2 md:hidden">
        {filterEntries
          .filter(([name]) => name !== "q")
          .map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        {columns.length > 0 && <input type="hidden" name="columns" value={serializeColumns(columns)} />}
        <SearchField value={search} onChange={setSearch} placeholder="Ism, username yoki telefon" />
        <input type="hidden" name="q" value={search} />
        {/* No "Qidirish" button beside the field: the field *is* the entry
            point, and on a phone the keyboard's own return key already says
            "search" for `type="search"`. The submit stays in the form, out of
            sight, so pressing it there is guaranteed to post rather than
            relying on implicit submission. */}
        <button type="submit" className="sr-only">
          Qidirish
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "oq-press t-subhead flex min-h-[44px] cursor-pointer items-center gap-1.5 self-start px-1",
            activeCount > 0 ? "text-accent-400" : "text-neutral-500",
          )}
        >
          <Icon name="list-checks" size={16} />
          Filtr
          {activeCount > 0 && <span className="tabular-nums">· {activeCount}</span>}
        </button>
      </form>

      <div className={cn(!open && "max-md:hidden")}>
        <form method="get" className="mb-4 grid grid-cols-2 items-end gap-2 md:flex md:flex-wrap">
          {/* The picker below writes this; without it, filtering would drop the
              columns the reader chose. */}
          {columns.length > 0 && <input type="hidden" name="columns" value={serializeColumns(columns)} />}
          {/* The phone's copy of this lives above, outside the fold. */}
          <label className="col-span-2 hidden flex-col gap-2 md:flex md:min-w-[190px] md:flex-1">
            <FieldLabel>Qidiruv</FieldLabel>
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Alisher Karimov"
              className="h-11 rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-text placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
            />
          </label>

          {/* Ahead of "Bot", because it is the wider cut and the one somebody
              running two businesses reaches for first. Hidden when there is
              only one project: a picker with a single option is a control that
              cannot change anything. */}
          {projects.length > 1 && (
            <SelectFilter name="projectId" label="Loyiha" value={filters.projectId ?? ""} options={projects} />
          )}
          <SelectFilter name="botId" label="Bot" value={filters.botId ?? ""} options={bots} />
          <SelectFilter name="flowId" label="Oqim" value={filters.flowId ?? ""} options={flows} />
          <SelectFilter
            name="status"
            label="Holat"
            value={filters.status ?? ""}
            options={[
              { value: "active", label: "Faol" },
              { value: "blocked", label: "Bloklangan" },
            ]}
          />

          <label className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Sanadan</FieldLabel>
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className="h-11 min-w-0 rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-text outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Sanagacha</FieldLabel>
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className="h-11 min-w-0 rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-text outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
            />
          </label>

          <button
            type="submit"
            className="oq-press col-span-2 h-11 cursor-pointer rounded-[12px] bg-accent-700 px-3.5 text-[15px] font-medium text-white md:col-span-1 md:h-9 md:text-[13px]"
          >
            Filtrlash
          </button>
          {activeCount > 0 && (
            <Link
              href={clearHref}
              className="t-subhead col-span-2 flex h-11 items-center justify-center px-2 text-neutral-500 md:col-span-1 md:justify-start"
            >
              Tozalash
            </Link>
          )}
        </form>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 flex items-center gap-1.5 text-[10.5px] tracking-[.08em] text-neutral-600 uppercase max-md:text-[12px] max-md:tracking-[.04em]">
            <Icon name="table" size={12} /> Ustunlar
          </span>
          {pickerKeys.length === 0 ? (
            <span className="text-[11.5px] text-neutral-600 max-md:text-[13px]">
              Oqimlar hali hech narsa saqlamagan — «Ma&apos;lumotni saqlash» bloki javobni saqlasa, u shu yerda
              ustun bo&apos;lib qo&apos;shiladi.
            </span>
          ) : (
            pickerKeys.map((name) => {
              const chosen = columns.includes(name);
              const disabled = !chosen && columns.length >= MAX_VARIABLE_COLUMNS;
              return disabled ? (
                <span
                  key={name}
                  title={`Ko'pi bilan ${MAX_VARIABLE_COLUMNS} ta ustun`}
                  className="rounded-md border border-neutral-900 px-2 py-1 font-mono text-[11px] text-neutral-700 max-md:text-[12px]"
                >
                  {name}
                </span>
              ) : (
                <Link
                  key={name}
                  href={columnHref(name)}
                  className={
                    chosen
                      ? "flex items-center gap-1 rounded-md border border-accent-700 bg-accent-950 px-2 py-1 font-mono text-[11px] text-accent-200 pointer-coarse:min-h-[44px] pointer-coarse:px-3 max-md:text-[12px]"
                      : "flex items-center gap-1 rounded-md border border-neutral-800 px-2 py-1 font-mono text-[11px] text-neutral-400 hover:border-accent-800 hover:text-neutral-200 pointer-coarse:min-h-[44px] pointer-coarse:px-3 max-md:text-[12px]"
                  }
                >
                  {chosen && <Icon name="check" size={10} />}
                  {name}
                </Link>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
