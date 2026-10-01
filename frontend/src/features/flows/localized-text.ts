import type { BotLanguage } from "@/features/bots/types";

/**
 * Picking one string out of several, in the browser.
 *
 * The mirror of `backend/apps/common/i18n.py` — `resolve_text` and
 * `normalise_text` in particular. It exists because the editor previews what
 * the runtime will send: an author writing Russian for a block has to see the
 * same choice the sender would make, and two implementations of "which of these
 * strings goes out" that disagree by one fallback step turn the preview into a
 * guess. Any rule changed there belongs here in the same commit.
 *
 * A block's text stops being one string and becomes a map of them —
 * `{"uz": "...", "ru": "..."}` — but every flow saved before that shape existed
 * still holds a bare string, and there is no migration that could turn one into
 * a translation. A plain string is therefore read as the bot's own language,
 * which makes the two shapes the same thing to everything downstream.
 *
 * Kept to the `BotLanguage` type and nothing else. It is imported by field
 * components, by the canvas and eventually by the simulator; a runtime import
 * of the bots feature from the flows feature would tie three screens together
 * for the sake of a three-item list.
 */

/** A block's text: one string, or one per language. See the module note. */
export type LocalizedText = string | Partial<Record<BotLanguage, string>>;

/** What a bot speaks when nothing says otherwise — `DEFAULT_LANGUAGE` in `i18n.py`. */
export const DEFAULT_LANGUAGE: BotLanguage = "uz";

/**
 * The order a lookup walks after the language it was asked for. `LANGUAGES` in
 * `i18n.py`, spelled out again rather than imported from `features/bots` for
 * the reason in the module note.
 */
const LANGUAGE_ORDER: readonly BotLanguage[] = ["uz", "ru", "en"];

/**
 * One stored value as text, or `""` when there is nothing to say.
 *
 * Whitespace counts as nothing: a translation somebody opened and left with a
 * stray space in it is an empty translation, and sending that space instead of
 * the language the author did write is the bug this catches. Numbers are
 * coerced the way Python's `str()` does, so a graph hand-edited to hold `0`
 * reads the same on both sides.
 */
function clean(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim() ? value : "";
}

/** Told apart by shape, the way `isinstance(value, Mapping)` does it. */
function isTextMap(value: unknown): value is Partial<Record<BotLanguage, string>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The one string to send, out of whatever the editor stored.
 *
 * In order: the language asked for, the bot's own language, then any
 * translation at all. The last step matters more than it looks — an author who
 * wrote only the Russian half of a message means for it to be sent, and a bot
 * that answers with an empty string instead is simply broken.
 */
export function resolveText(
  value: LocalizedText | null | undefined,
  language: BotLanguage,
  fallback: BotLanguage = DEFAULT_LANGUAGE,
): string {
  if (!isTextMap(value)) {
    // A bare string is the bot's own language: that is what it was written in,
    // back when there was only one.
    return clean(value);
  }
  // Own keys last so a code this build does not know about — a graph written by
  // a newer one, or edited by hand — is still preferred over saying nothing.
  const map = value as Record<string, unknown>;
  for (const code of [language, fallback, ...LANGUAGE_ORDER, ...Object.keys(map)]) {
    const text = clean(map[code]);
    if (text) return text;
  }
  return "";
}

/**
 * Only what was written for this one language, with no fallback.
 *
 * Has no counterpart in `i18n.py` because only an editor needs it: the runtime
 * always wants the string that goes out, while a field being typed into has to
 * show its own language empty. Filling it with the Uzbek text would tell an
 * author the Russian is already written, and the first keystroke would then
 * save that Uzbek text as the Russian translation.
 */
export function translationOf(
  value: LocalizedText | null | undefined,
  language: BotLanguage,
  main: BotLanguage = DEFAULT_LANGUAGE,
): string {
  if (!isTextMap(value)) return language === main ? clean(value) : "";
  return clean(value[language]);
}

/** Whether this language has text of its own — what the dot on a language tag means. */
export function hasTranslation(
  value: LocalizedText | null | undefined,
  language: BotLanguage,
  main: BotLanguage = DEFAULT_LANGUAGE,
): boolean {
  return translationOf(value, language, main) !== "";
}

/** How many languages this value actually speaks — `0` for one nobody has written yet. */
export function translatedCount(value: LocalizedText | null | undefined): number {
  if (!isTextMap(value)) return clean(value) ? 1 : 0;
  return LANGUAGE_ORDER.filter((code) => clean(value[code])).length;
}

/**
 * The write side: whatever the switcher produced, stored as small as it can be.
 *
 * `normalise_text`'s rules — the main language always keeps a key, empty
 * translations of the others are dropped rather than saved, unknown codes go —
 * plus one step the runtime has no use for: a map with nothing but the main
 * language left in it is written back as the plain string it arrived as.
 * Clearing a translation therefore returns a block to the exact value it held
 * before anybody touched it, which is what keeps "no forced migration" true of
 * an edit that was undone as well as of one that never happened.
 */
export function normalizeText(
  value: Partial<Record<BotLanguage, string>>,
  main: BotLanguage = DEFAULT_LANGUAGE,
): LocalizedText {
  const texts: Partial<Record<BotLanguage, string>> = {};
  let translated = 0;
  for (const code of LANGUAGE_ORDER) {
    const text = clean(value[code]);
    if (text && code !== main) translated += 1;
    if (text || code === main) texts[code] = text;
  }
  return translated ? texts : (texts[main] ?? "");
}

/** One language's text, written into whichever shape the value already had. */
export function setTranslation(
  value: LocalizedText | null | undefined,
  language: BotLanguage,
  text: string,
  main: BotLanguage = DEFAULT_LANGUAGE,
): LocalizedText {
  // Typing in the bot's own language over a value that is still a plain string
  // leaves it a plain string: a workspace's flows are not rewritten into the
  // map shape because somebody fixed a typo in the only language they have.
  if (!isTextMap(value) && language === main) return text;
  const next: Partial<Record<BotLanguage, string>> = isTextMap(value)
    ? { ...value }
    : { [main]: clean(value) };
  next[language] = text;
  return normalizeText(next, main);
}
