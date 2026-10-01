/**
 * Date helpers for the analytics layer. Everything is an ISO `YYYY-MM-DD`
 * string, never a `Date` — a plain calendar day is what the API sends, what
 * a `<input type="date">` reads and writes, and what a report is keyed by, so
 * nothing here has to reason about time zones.
 */

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISODate(value).getTime());
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Inclusive day count between two ISO dates — `from` and `to` on the same day is 1. */
export function daysBetween(from: string, to: string): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/** Every day in `[from, to]`, inclusive, ascending. */
export function eachDay(from: string, to: string): string[] {
  const total = Math.max(0, daysBetween(from, to));
  return Array.from({ length: total }, (_, index) => addDays(from, index));
}

/** The window of equal length immediately before `[from, to]` — what a delta is measured against. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = Math.max(1, daysBetween(from, to));
  return { from: addDays(from, -length), to: addDays(to, -length) };
}

/** A range ending today and covering `days` days, inclusive. */
export function lastNDays(days: number, today = new Date()): { from: string; to: string } {
  const to = toISODate(today);
  return { from: addDays(to, -(days - 1)), to };
}

/*
 * Month names are tabulated rather than taken from `Intl`: the same string has
 * to come out of the server render and the browser hydration, and ICU data can
 * differ between Node and a given browser. A label that disagrees by one
 * character is a hydration error.
 */
const MONTHS: Record<string, { short: string[]; long: string[] }> = {
  uz: {
    short: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
    long: [
      "yanvar",
      "fevral",
      "mart",
      "aprel",
      "may",
      "iyun",
      "iyul",
      "avgust",
      "sentabr",
      "oktabr",
      "noyabr",
      "dekabr",
    ],
  },
  ru: {
    short: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
    long: [
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ],
  },
  en: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    long: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  },
};

function monthNames(locale: string): { short: string[]; long: string[] } {
  return MONTHS[locale.slice(0, 2).toLowerCase()] ?? MONTHS.en!;
}

/** "13 avg" — a compact axis label in the workspace's locale. */
export function formatDayLabel(iso: string, locale: string): string {
  const date = parseISODate(iso);
  return `${date.getDate()} ${monthNames(locale).short[date.getMonth()]}`;
}

/** "13 avgust 2026" — a full date for headers and CSV metadata. */
export function formatFullDate(iso: string, locale: string): string {
  const date = parseISODate(iso);
  return `${date.getDate()} ${monthNames(locale).long[date.getMonth()]} ${date.getFullYear()}`;
}

/*
 * Timestamps as the product prints them.
 *
 * Both helpers run on the server, inside the repositories that read the API:
 * the backend sends ISO instants and every card in the interface shows a
 * human phrase, so the translation happens once, where the data arrives,
 * rather than in twenty components. Server-rendered means no hydration
 * mismatch — the browser is handed the finished string.
 */

/** "3 kun oldin". Empty in, empty out — an absent timestamp prints nothing. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "hozir";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} kun oldin`;
  if (days < 31) return `${Math.round(days / 7)} hafta oldin`;
  if (days < 365) return `${Math.round(days / 30)} oy oldin`;
  return `${Math.round(days / 365)} yil oldin`;
}

/** "12 mart 2026" from an ISO instant — for the dates that are dates, not ages. */
export function formatInstant(iso: string | null | undefined, locale = "uz"): string {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  return isISODate(day) ? formatFullDate(day, locale) : iso;
}
