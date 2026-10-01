"use client";

import { createContext, use, type ReactNode } from "react";
import { dictionaryFor, type Dictionary } from "./dictionaries";
import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * The interface language, browser side.
 *
 * The app shell resolves it once on the server and hands it down as a prop;
 * this only carries it past the components in between, so a button four levels
 * deep does not need every parent to prop-drill a language it does not use
 * itself. `features/analytics/format.ts` already prop-drills a locale, and that
 * is exactly what does not scale past one subsystem.
 *
 * The value is the language tag rather than the dictionary: a `Locale` is four
 * bytes in the RSC payload, a dictionary is every string in the product sent
 * twice — once as the rendered HTML, once as a serialised prop.
 *
 * Nothing here may touch `lib/api/server` or a feature's `data` repository,
 * directly or through a barrel: those import `server-only`, and pulling one
 * into a provider that every screen mounts would fail the build rather than
 * leak anything. Hence `dictionaries.ts` — plain data, no side chosen.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return use(LocaleContext);
}

/**
 * The words, for a client component:
 *
 *   const t = useT();
 *   <span>{t.chrome.close}</span>
 *
 * The context has a default rather than throwing when there is no provider, and
 * that is load-bearing: `global-error.tsx` renders its own `<html>` outside
 * every layout in the app, so `ErrorState` genuinely mounts with no provider
 * above it. A crash reporter that crashes is worse than one in Uzbek.
 */
export function useT(): Dictionary {
  return dictionaryFor(use(LocaleContext));
}
