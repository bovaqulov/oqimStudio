import type { BotLanguage, BotLanguages } from "./types";

/**
 * The languages a bot can be written in, in the order the editor draws them.
 *
 * The same list as `LANGUAGES` in `apps/common/i18n.py`. It is spelled out on
 * this side as well for the same reason the fallback default is: a bot saved
 * before the setting existed carries no `languages` key at all, and a form that
 * rendered nothing would save nothing over a working default.
 *
 * Import this module directly (`@/features/bots/languages`) rather than through
 * the feature barrel — the barrel re-exports the repository, which is
 * `server-only`, and a client component that pulls it in fails the build.
 */
export const BOT_LANGUAGES: BotLanguage[] = ["uz", "ru", "en"];

/** Named in Uzbek, because the studio is. */
export const LANGUAGE_LABELS: Record<BotLanguage, string> = {
  uz: "O'zbekcha",
  ru: "Ruscha",
  en: "Inglizcha",
};

/** The short form for the switch in the corner of a text field. */
export const LANGUAGE_TAGS: Record<BotLanguage, string> = { uz: "UZ", ru: "RU", en: "EN" };

/**
 * How many languages one bot may speak.
 *
 * Not a storage limit — it is how many translations of every single message an
 * author will realistically keep current, and how many tabs fit in the corner
 * of a text field without the field becoming a tab bar. Mirrors
 * `MAX_LANGUAGES` in `apps/bots/models.py`.
 */
export const MAX_BOT_LANGUAGES = 3;

/** What a bot speaks until somebody says otherwise — `default_languages()`. */
export const DEFAULT_BOT_LANGUAGES: BotLanguages = { main: "uz", enabled: ["uz", "ru"] };

function isLanguage(code: unknown): code is BotLanguage {
  return typeof code === "string" && (BOT_LANGUAGES as string[]).includes(code);
}

/**
 * Fills in whatever an older bot's stored settings never had, and drops what
 * this build cannot render.
 *
 * The main language is put back into the list when it is missing: a bot that
 * does not speak its own language would have nowhere to write the text every
 * other language falls back to.
 */
export function normalizeLanguages(
  // Loose on purpose: the same repair runs on a payload from the API and on
  // raw `FormData` strings, and a cast at either call site would only move the
  // check somewhere it is not performed.
  stored: { main?: string; enabled?: readonly string[] } | null | undefined,
): BotLanguages {
  const main = isLanguage(stored?.main) ? stored.main : DEFAULT_BOT_LANGUAGES.main;
  const listed = Array.isArray(stored?.enabled) ? stored.enabled.filter(isLanguage) : [];
  // Order is the author's — it is the order the tabs appear in — so duplicates
  // are removed in place rather than by sorting.
  const enabled = [...new Set(listed.length ? listed : DEFAULT_BOT_LANGUAGES.enabled)];
  if (!enabled.includes(main)) enabled.unshift(main);
  return { main, enabled: enabled.slice(0, MAX_BOT_LANGUAGES) };
}
