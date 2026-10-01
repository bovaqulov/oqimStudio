/**
 * Which languages the *interface* is written in.
 *
 * Deliberately not the same list as the one a bot speaks to its customers —
 * that one lives in the backend (`apps/common/i18n.py`) and answers a different
 * question. The two happen to hold the same three languages today; they are
 * free to diverge, and a shared constant would quietly forbid that.
 *
 * A stored tag is BCP-47 with a region ("uz-UZ") because that is what a
 * currency and a date formatter want. A dictionary is keyed by the language
 * alone, because "uz-UZ" and a hypothetical "uz-Cyrl" are the same set of
 * words. `normalizeLocale` is the one place the two shapes meet.
 */

export type Locale = "uz" | "ru" | "en";

/** Uzbek first: it is the default and the last thing a lookup falls back to. */
export const LOCALES: readonly Locale[] = ["uz", "ru", "en"];

export const DEFAULT_LOCALE: Locale = "uz";

/**
 * What the picker offers and what the backend stores.
 *
 * Every language names itself in its own words — a reader looking for Russian
 * is looking for "Русский", not for whatever the interface they cannot read
 * calls it. So these labels are the same in all three dictionaries and are not
 * in one.
 */
export const LOCALE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "uz-UZ", label: "O'zbekcha" },
  { value: "ru-RU", label: "Русский" },
  { value: "en-US", label: "English" },
];

/**
 * A stored tag — or anything at all — as one of the three languages we have
 * words for. Unknown in, Uzbek out: a screen never fails to render because a
 * locale column holds something nobody expected.
 */
export function normalizeLocale(tag: string | null | undefined): Locale {
  const language = (tag ?? "").slice(0, 2).toLowerCase();
  return LOCALES.find((locale) => locale === language) ?? DEFAULT_LOCALE;
}
