"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils/cn";
import type { BusinessScheduleConfig, BusinessScheduleMode } from "@/features/flows";
import {
  BUSINESS_TIMEZONES,
  BUSINESS_WEEKDAYS,
  businessWindowNote,
  isBusinessHandlerOpenAt,
  minutesOfDay,
  summarizeBusinessDays,
} from "../../../lib/trigger";
import { FieldGroup } from "./FieldGroup";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { RevealPanel } from "./RevealPanel";

const MODE_OPTIONS: { value: BusinessScheduleMode; label: string }[] = [
  { value: "always", label: "Doim" },
  { value: "inside", label: "Ish vaqti" },
  { value: "outside", label: "Tashqari" },
];

const DAY_PRESETS: { label: string; days: number[] }[] = [
  { label: "Ish kunlari", days: [1, 2, 3, 4, 5] },
  { label: "Har kuni", days: [1, 2, 3, 4, 5, 6, 7] },
  { label: "Dam olish", days: [6, 7] },
];

/** How often the "is it open right now" strip re-reads the clock. */
const TICK_MS = 20_000;

/*
 * The wall clock as an external store, shared by every mounted schedule field.
 * `useSyncExternalStore` rather than an effect that sets state: the clock is
 * exactly the "external system" the hook exists for, so there is no cascading
 * render on mount, and `getServerSnapshot` lets the server say honestly that it
 * has no clock — the strip below simply is not there until the browser has one.
 */
let clockNow = 0;
let clockTimer: number | null = null;
const clockListeners = new Set<() => void>();

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, TICK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Subscription for an unscheduled field — no timer runs while there is no window to check against. */
function subscribeToNothing(): () => void {
  return () => {};
}

/** A number, not a Date: the snapshot has to be referentially stable between ticks. */
function readClock(): number {
  return clockNow;
}

function readServerClock(): number {
  return 0;
}

/** The window's own length in "Ns Mdaq" form — a night shift is measured across midnight. */
function windowLength(from: string, to: string): string {
  const start = minutesOfDay(from);
  const end = minutesOfDay(to);
  const span = start === end ? 1440 : (((end - start) % 1440) + 1440) % 1440;
  const hours = Math.floor(span / 60);
  const minutes = span % 60;
  return [hours ? `${hours} soat` : "", minutes ? `${minutes} daq` : ""].filter(Boolean).join(" ") || "0 daq";
}

/**
 * When a Handler is allowed to fire. This is the layer the `business` module
 * exists for — "ish vaqtidan tashqari avtojavob" is the flagship business flow,
 * and without a window it can only be built out of condition blocks nobody
 * can read back later.
 *
 * The window is stored, not the answer: the runtime decides at delivery time,
 * in the *account's* zone rather than whoever's browser opened the editor. The
 * strip at the bottom is the only thing here that reads a clock, and it says
 * plainly which of the two it is showing.
 */
export function BusinessScheduleField({
  schedule,
  onChange,
}: {
  schedule: BusinessScheduleConfig;
  onChange: (next: BusinessScheduleConfig) => void;
}) {
  const scheduled = schedule.mode !== "always";
  const nowMs = useSyncExternalStore(scheduled ? subscribeToClock : subscribeToNothing, readClock, readServerClock);
  const now = scheduled && nowMs ? new Date(nowMs) : null;
  // The two ways a typed window says something other than what it looks like —
  // a night shift, and a start that equals its end. See `businessWindowNote`.
  const note = businessWindowNote(schedule);

  function commit(patch: Partial<BusinessScheduleConfig>) {
    onChange({ ...schedule, ...patch });
  }

  function toggleDay(value: number) {
    const next = schedule.days.includes(value)
      ? schedule.days.filter((day) => day !== value)
      : [...schedule.days, value].sort((a, b) => a - b);
    // An empty week would silently match nothing, with the panel still showing
    // a window — the last day stays on instead.
    if (next.length) commit({ days: next });
  }

  const open = now ? isBusinessHandlerOpenAt(schedule, now) : false;
  const localTime = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone: schedule.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)
    : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Ish vaqti</FieldLabel>
        {scheduled && (
          <span className="truncate text-[10px] max-md:text-[12px] text-neutral-600 tabular-nums">
            {summarizeBusinessDays(schedule.days)} · {windowLength(schedule.from, schedule.to)}
          </span>
        )}
      </div>

      <SegmentedTabs
        grow
        label="Ish vaqti bo'yicha filtr"
        tone={scheduled ? "accent" : "neutral"}
        options={MODE_OPTIONS}
        value={schedule.mode}
        onChange={(mode) => commit({ mode })}
      />
      <FieldHint>
        {schedule.mode === "always"
          ? "Sutkaning istalgan payti ishlaydi."
          : schedule.mode === "inside"
            ? "Faqat quyidagi oraliqda kelgan xabarlarga javob beradi."
            : "Quyidagi oraliqdan tashqarida — kechqurun, tunda va dam olish kunlari."}
      </FieldHint>

      {scheduled && (
        <RevealPanel>
          {/* Seven fixed columns rather than a wrapping chip row: a week reads
              as a week only when the days keep their places. */}
          <FieldGroup
            legend="Kunlar"
            note="bir nechtasi mumkin"
            bodyClassName="grid grid-cols-7 gap-1"
            action={DAY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => commit({ days: [...preset.days] })}
                className="flex-none cursor-pointer text-[10px] max-md:text-[12px] text-neutral-600 transition-colors hover:text-accent-300"
              >
                {preset.label}
              </button>
            ))}
          >
            {BUSINESS_WEEKDAYS.map((day) => {
              const active = schedule.days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  role="checkbox"
                  data-roving=""
                  title={day.label}
                  aria-label={day.label}
                  aria-checked={active}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "cursor-pointer rounded-md border py-[5px] text-center text-[10.5px] max-md:text-[12px] transition-colors",
                    active
                      ? "border-accent-600 bg-accent-800 text-accent-ink"
                      : "border-neutral-800 text-neutral-600 hover:border-neutral-600 hover:text-neutral-300",
                  )}
                >
                  {day.short}
                </button>
              );
            })}
          </FieldGroup>

          <FieldLabel>Oraliq</FieldLabel>
          <div className="flex items-center gap-1.5">
            <Input
              type="time"
              value={schedule.from}
              aria-label="Boshlanish vaqti"
              onChange={(event) => commit({ from: event.target.value || "00:00" })}
              className="px-2 py-1.5 text-[12px] max-md:text-[15px] tabular-nums"
            />
            <Icon name="arrows-left-right" size={11} className="flex-none text-neutral-600" />
            <Input
              type="time"
              value={schedule.to}
              aria-label="Tugash vaqti"
              onChange={(event) => commit({ to: event.target.value || "00:00" })}
              className="px-2 py-1.5 text-[12px] max-md:text-[15px] tabular-nums"
            />
          </div>
          {/* A window is two numbers, and two numbers can be typed into a state
              nobody would have picked — see `businessWindowNote`. */}
          {note &&
            (note.tone === "warn" ? (
              <p className="flex items-start gap-1.5 rounded-md bg-warning-bg px-2 py-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed text-warning-fg">
                <Icon name="warning" size={11} className="mt-[2px] flex-none" />
                <span>{note.text}</span>
              </p>
            ) : (
              <FieldHint>{note.text}</FieldHint>
            ))}

          <FieldLabel>Vaqt mintaqasi</FieldLabel>
          <Select
            value={schedule.timezone}
            aria-label="Vaqt mintaqasi"
            onChange={(event) => commit({ timezone: event.target.value })}
            className="py-1.5 text-[12px] max-md:text-[15px]"
          >
            {BUSINESS_TIMEZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>

          {/*
           * The one place the panel reads an actual clock. It answers the
           * question a time window always raises — "so would this fire right
           * now?" — which is otherwise a matter of counting on your fingers
           * across a timezone.
           */}
          {now && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10.5px] max-md:text-[12px]",
                open ? "bg-success-bg text-success-fg" : "bg-neutral-800 text-neutral-400",
              )}
            >
              <Icon name={open ? "check-circle" : "clock"} size={11} className="flex-none" />
              <span className="min-w-0 flex-1">
                {open ? "Hozir ishga tushardi" : "Hozir ishlamaydi"}
              </span>
              <span className="flex-none text-neutral-600 tabular-nums">{localTime}</span>
            </div>
          )}
        </RevealPanel>
      )}
    </div>
  );
}
