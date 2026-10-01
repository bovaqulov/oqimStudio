import { BUSINESS_WEEKDAYS, summarizeBusinessDays } from "@/features/flow-builder/lib/trigger";
import type { RecipeInput, RecipeValue, RecipeValues } from "../types";

/**
 * Reading and validating recipe answers. Every accessor here is total: it takes
 * whatever is in the values bag and returns something usable, because a wizard
 * half-filled in and then reopened must not throw — a missing answer is a
 * default, and `missingInputs` is what stops a *required* one from being saved.
 */

export function defaultValues(inputs: RecipeInput[]): RecipeValues {
  return Object.fromEntries(inputs.map((input) => [input.key, cloneValue(input.default)]));
}

/** Arrays are copied, so editing one step's chips cannot reach into a template's own defaults. */
function cloneValue(value: RecipeValue): RecipeValue {
  return Array.isArray(value) ? [...value] : value;
}

/**
 * Stored answers on top of the recipe's defaults. A template written before an
 * input existed still opens with every field controlled, and an input dropped
 * from a recipe stops being read without a migration.
 */
export function withDefaults(inputs: RecipeInput[], values: RecipeValues | undefined): RecipeValues {
  const base = defaultValues(inputs);
  if (!values) return base;
  for (const input of inputs) {
    const saved = values[input.key];
    if (saved !== undefined) base[input.key] = cloneValue(saved);
  }
  return base;
}

export function readText(values: RecipeValues, key: string): string {
  const value = values[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return Array.isArray(value) ? value.join("\n") : "";
}

export function readList(values: RecipeValues, key: string): string[] {
  const value = values[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean);
  }
  return [];
}

export function readNumber(values: RecipeValues, key: string, fallback = 0): number {
  const value = values[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(readText(values, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** ISO weekday numbers, deduplicated and ordered — days are stored as strings so a value bag stays JSON-simple. */
export function readDays(values: RecipeValues, key: string): number[] {
  const days = readList(values, key)
    .map(Number)
    .filter((day) => day >= 1 && day <= 7);
  return [...new Set(days)].sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* Time ranges                                                                 */
/* -------------------------------------------------------------------------- */

const TIME = /^(\d{1,2}):(\d{2})$/;

function normalizeTime(value: string, fallback: string): string {
  const match = TIME.exec(value.trim());
  if (!match) return fallback;
  const hours = Math.min(23, Number(match[1]));
  const minutes = Math.min(59, Number(match[2]));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A window is one decision, so it is one value — "09:00-18:00". Split on the
 * hyphen rather than kept as two inputs, which would let a wizard step be left
 * holding an end without a start.
 */
export function readTimeRange(values: RecipeValues, key: string): { from: string; to: string } {
  const [from = "", to = ""] = readText(values, key).split("-");
  return { from: normalizeTime(from, "09:00"), to: normalizeTime(to, "18:00") };
}

export function formatTimeRange(range: { from: string; to: string }): string {
  return `${range.from}–${range.to}`;
}

export function timeRangeValue(from: string, to: string): string {
  return `${normalizeTime(from, "09:00")}-${normalizeTime(to, "18:00")}`;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

/** Weekday chips, straight from the trigger layer so the wizard and the inspector agree. */
export const WEEKDAY_CHOICES = BUSINESS_WEEKDAYS.map((day) => ({
  value: String(day.value),
  label: day.short,
  hint: day.label,
}));

/** "Ish kunlari", "Har kuni", "Du, Ch, Ju" — the shortest true reading of a selection. */
export function describeDays(days: number[]): string {
  return summarizeBusinessDays(days);
}

/** The label a choice carries, or the raw value when a saved answer no longer matches an option. */
export function choiceLabel(input: RecipeInput | undefined, value: string): string {
  return input?.choices?.find((choice) => choice.value === value)?.label ?? value;
}

/** «narx» +2 — a term list read at a glance, the way the canvas cards read one. */
export function describeTerms(terms: string[]): string {
  if (!terms.length) return "—";
  return terms.length > 1 ? `«${terms[0]}» +${terms.length - 1}` : `«${terms[0]}»`;
}

/** Message text shortened for a summary line, on a word boundary where there is one. */
export function excerpt(text: string, limit = 46): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function isEmpty(input: RecipeInput, values: RecipeValues): boolean {
  switch (input.kind) {
    case "chips":
    case "days":
    case "keywords":
      return readList(values, input.key).length === 0;
    case "number":
      return !Number.isFinite(readNumber(values, input.key, Number.NaN));
    default:
      return readText(values, input.key).length === 0;
  }
}

/** The required answers still missing — what the wizard's "next" button waits for. */
export function missingInputs(inputs: RecipeInput[], values: RecipeValues): RecipeInput[] {
  return inputs.filter((input) => input.required && isEmpty(input, values));
}
