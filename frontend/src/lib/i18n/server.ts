import "server-only";
import { cache } from "react";
import { apiRequest, readAuthToken } from "@/lib/api/server";
import { dictionaryFor, type Dictionary } from "./dictionaries";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locales";

/**
 * The interface language, server side.
 *
 * It is the *person's* setting, not the tenant's: `User.locale` is documented
 * as "the tag the interface is rendered in for this person", and an admin who
 * switches to Russian has no business switching the analyst beside them. The
 * workspace keeps its own `locale` for the things a report is shared in —
 * dates and currency — which is the one place a single answer per tenant is
 * the right answer.
 *
 * Not `getSession()`, even though that already holds the same field. The root
 * layout wraps the sign-in screens too, and `getSession` redirects an
 * unauthenticated caller to `/api/auth/signed-out` — asking it for a language
 * would bounce every visitor off `/login` before they could read it. This asks
 * the same endpoint and treats "not signed in" as an answer rather than as a
 * failure.
 *
 * `cache` so the root layout, the page header and the screen itself share one
 * read per request, and the token check so a signed-out visitor costs no
 * request at all.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  if (!(await readAuthToken())) return DEFAULT_LOCALE;
  try {
    const payload = await apiRequest<{ user: { locale: string } }>("/api/auth/session/");
    return normalizeLocale(payload.user.locale);
  } catch {
    // A dead backend or a revoked token is not a language question. Whoever
    // needed the data will report the failure; the chrome around them still
    // has to draw, and it draws in the default language.
    return DEFAULT_LOCALE;
  }
});

/**
 * The words, for a server component. Named `getT` to sit beside the client
 * hook `useT` — same object, two ways in.
 *
 *   const t = await getT();
 *   <span>{t.settings.title}</span>
 */
export async function getT(): Promise<Dictionary> {
  return dictionaryFor(await getLocale());
}
