import { en } from "./en";
import { normalizeLocale, type Locale } from "./locales";
import { ru } from "./ru";
import { uz, type Dictionary } from "./uz";

/**
 * Locale → words. The one module both halves of the app import.
 *
 * Deliberately free of `server-only` and of `"use client"`: a server component
 * reaches it through `lib/i18n/server.ts` and a client component through
 * `LocaleProvider`, and if this file picked a side one of those two would be
 * importing across the boundary. All three dictionaries are in the browser
 * bundle — three objects of short strings, rather than a dynamic `import()`
 * that would make the language a loading state.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { uz, ru, en };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** The same lookup starting from a stored BCP-47 tag ("ru-RU") or from nothing at all. */
export function dictionaryForTag(tag: string | null | undefined): Dictionary {
  return dictionaryFor(normalizeLocale(tag));
}

export type { Dictionary };
