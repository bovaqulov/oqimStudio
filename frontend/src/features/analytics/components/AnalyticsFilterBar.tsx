"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Segmented } from "@/components/ui/Segmented";
import { MainButton } from "@/lib/telegram/MainButton";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { cn } from "@/lib/utils/cn";
import { daysBetween, lastNDays } from "@/lib/utils/date";
import { DEFAULT_RANGE_DAYS } from "../query";
import type { AnalyticsDimensionOption, AnalyticsDimensions, AnalyticsQuery } from "../types";

/*
 * Five segments sharing the width of a phone.
 *
 * They were briefly "7 / 14 / 30 / 90", which fit but stopped saying what the
 * numbers counted — that is cutting meaning, not cutting explanation. The unit
 * is back on every segment and the row still fits, because the control shares
 * the width equally instead of scrolling: at 390px each segment gets ~68px and
 * "14 kun" needs 66.
 */
const RANGE_PRESETS = [
  { value: "7", label: "7 kun" },
  { value: "14", label: "14 kun" },
  { value: "30", label: "30 kun" },
  { value: "90", label: "90 kun" },
  { value: "custom", label: "Oraliq" },
] as const;

export type AnalyticsDimensionKey = "project" | "bot" | "flow" | "channel" | "source";

interface FilterField {
  key: AnalyticsDimensionKey;
  icon: IconName;
  label: string;
  allLabel: string;
  value: string | null;
  options: AnalyticsDimensionOption[];
  apply: (value: string | null) => AnalyticsQuery;
}

/** One dimension as a labelled, full-width select — the shape the sheet and the popover share. */
function SelectField({ field, onChange }: { field: FilterField; onChange: (query: AnalyticsQuery) => void }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="t-footnote t-secondary flex items-center gap-1.5">
        <Icon name={field.icon} size={14} /> {field.label}
      </span>
      <select
        value={field.value ?? "all"}
        onChange={(event) => onChange(field.apply(event.target.value === "all" ? null : event.target.value))}
        className="h-11 w-full cursor-pointer rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-neutral-200 outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
      >
        <option value="all">{field.allLabel}</option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The filter body itself — every dimension and the free date range, in one column. */
function FilterFields({
  fields,
  query,
  onChange,
}: {
  fields: FilterField[];
  query: AnalyticsQuery;
  onChange: (query: AnalyticsQuery) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <SelectField key={field.key} field={field} onChange={onChange} />
      ))}

      {/* Native date inputs: a free range is the one thing the presets cannot express. */}
      <div className="flex flex-col gap-2">
        <span className="t-footnote t-secondary flex items-center gap-1.5">
          <Icon name="calendar-blank" size={14} /> Sana oralig&apos;i
        </span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={query.from}
            max={query.to}
            aria-label="Boshlanish sanasi"
            onChange={(event) => event.target.value && onChange({ ...query, from: event.target.value })}
            className="h-11 min-w-0 flex-1 cursor-pointer rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-neutral-200 outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
          />
          <span className="flex-none text-neutral-700">—</span>
          <input
            type="date"
            value={query.to}
            min={query.from}
            aria-label="Tugash sanasi"
            onChange={(event) => event.target.value && onChange({ ...query, to: event.target.value })}
            className="h-11 min-w-0 flex-1 cursor-pointer rounded-[12px] border-0 bg-neutral-800 px-3.5 text-[15px] text-neutral-200 outline-none focus:ring-2 focus:ring-accent-500 focus:ring-inset"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Every cut the report can be sliced by: which project, bot, oqim, Telegram
 * surface and traffic source, over which window. The same bar serves the
 * dashboard and the analytics screen — there is one filter model, not two.
 *
 * Only the period stays in the open. Eleven controls standing between the
 * reader and the first number is a console rather than a report, and on a phone
 * it was the entire first screen; the dimensions and the free date range now sit
 * behind one button whose label counts what is narrowing the numbers, so nothing
 * is unreachable — only folded.
 */
export function AnalyticsFilterBar({
  dimensions,
  query,
  onChange,
  onReset,
  /** Filters the dashboard hides to stay a summary rather than a console. */
  hidden = [],
}: {
  dimensions: AnalyticsDimensions;
  query: AnalyticsQuery;
  onChange: (query: AnalyticsQuery) => void;
  onReset: () => void;
  hidden?: AnalyticsDimensionKey[];
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const phone = usePhoneViewport();

  const bots = query.projectId ? dimensions.bots.filter((bot) => bot.parentId === query.projectId) : dimensions.bots;
  const flows = query.botId ? dimensions.flows.filter((flow) => flow.parentId === query.botId) : dimensions.flows;
  const rangeDays = daysBetween(query.from, query.to);
  const preset = RANGE_PRESETS.some((option) => option.value === String(rangeDays)) ? String(rangeDays) : "custom";

  const allFields: FilterField[] = [
    {
      key: "project",
      icon: "folders",
      label: "Loyiha",
      allLabel: "Barcha loyihalar",
      value: query.projectId,
      options: dimensions.projects,
      apply: (projectId) => ({ ...query, projectId, botId: null, flowId: null }),
    },
    {
      key: "bot",
      icon: "robot",
      label: "Bot",
      allLabel: "Barcha botlar",
      value: query.botId,
      options: bots,
      apply: (botId) => ({ ...query, botId, flowId: null }),
    },
    {
      key: "flow",
      icon: "flow-arrow",
      label: "Oqim",
      allLabel: "Barcha oqimlar",
      value: query.flowId,
      options: flows,
      apply: (flowId) => ({ ...query, flowId }),
    },
    {
      key: "channel",
      icon: "broadcast",
      label: "Kanal",
      allLabel: "Barcha kanallar",
      value: query.channelId,
      options: dimensions.channels,
      apply: (channelId) => ({ ...query, channelId }),
    },
    {
      key: "source",
      icon: "megaphone",
      label: "Manba",
      allLabel: "Barcha manbalar",
      value: query.sourceId,
      options: dimensions.sources,
      apply: (sourceId) => ({ ...query, sourceId }),
    },
  ];
  const fields = allFields.filter((field) => !hidden.includes(field.key));

  const activeCount = fields.filter((field) => field.value).length;
  const isFiltered = activeCount > 0 || rangeDays !== DEFAULT_RANGE_DAYS;

  // Desktop only: the popover is not modal, so the page underneath is what takes
  // the click that dismisses it. The phone case is a Modal and owns its own.
  useEffect(() => {
    if (!open || phone) return;
    function onPointerDown(event: MouseEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, phone]);

  function applyPreset(value: string) {
    // "Oraliq" names a window the presets cannot express, so it opens the place
    // the two dates live instead of doing nothing at all.
    if (value === "custom") {
      setOpen(true);
      return;
    }
    onChange({ ...query, ...lastNDays(Number(value)) });
  }

  // Kept away from the sheet's bottom edge on purpose: undoing every choice the
  // reader made is not what a thumb should find under the primary button.
  const reset = (
    <button
      type="button"
      onClick={() => {
        onReset();
        setOpen(false);
      }}
      className="oq-press t-subhead min-h-[44px] cursor-pointer px-2 text-neutral-500"
    >
      Tozalash
    </button>
  );

  return (
    <div className="mb-3.5 flex flex-col gap-2">
      {/* Equal shares of the full width. The strip used to scroll sideways, so
          the last preset was cut in half and nothing on screen said there was
          more of it. */}
      <Segmented
        label="Davr"
        grow
        options={RANGE_PRESETS.map((option) => ({ value: option.value, label: option.label }))}
        value={preset}
        onChange={applyPreset}
      />

      <div ref={anchorRef} className="relative self-start">
        {/* A plain text button, not a bordered box: opening the filters is not
            the thing to do on this screen, reading the numbers is. */}
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "oq-press t-subhead flex min-h-[44px] cursor-pointer items-center gap-1.5 px-1",
            activeCount > 0 ? "text-accent-400" : "text-neutral-500",
          )}
        >
          <Icon name="list-checks" size={16} />
          Filtr
          {activeCount > 0 && <span className="tabular-nums">· {activeCount}</span>}
        </button>

        {open && !phone && (
          <div
            role="dialog"
            aria-label="Filtr"
            className="absolute top-full left-0 z-40 mt-1.5 w-[280px] rounded-[16px] border border-separator bg-overlay p-3.5 shadow-lg"
          >
            <div className="mb-3 flex items-center">
              <span className="t-headline flex-1">Filtr</span>
              {isFiltered && reset}
            </div>
            <FilterFields fields={fields} query={query} onChange={onChange} />
          </div>
        )}
      </div>

      {phone && (
        <Modal open={open} onClose={() => setOpen(false)} labelledBy="analytics-filter-title">
          <div className="flex flex-none items-center gap-1 border-b border-neutral-900 px-4 py-2.5">
            <span id="analytics-filter-title" className="t-headline flex-1">
              Filtr
            </span>
            {isFiltered && reset}
            <button
              type="button"
              aria-label="Yopish"
              onClick={() => setOpen(false)}
              className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <FilterFields fields={fields} query={query} onChange={onChange} />
          </div>
          <MainButton inline text="Qo'llash" onClick={() => setOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
