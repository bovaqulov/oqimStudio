/**
 * The two names a table has, and the rule they both obey.
 *
 * `name` is what a person reads; `handle` — and every column `key` — is what a
 * flow writes inside an expression, so it may hold only lowercase latin
 * letters, digits and `_`. The backend enforces exactly this (see
 * `ma'lumot-kontrakt.md` §Tekshiruvlar); the same rule is repeated here so a
 * refusal can be shown next to the field the reader is typing in, before a
 * round trip, and in Uzbek rather than as a regular expression.
 *
 * No `server-only` in this module on purpose: the create form and the column
 * editor are client components and both need it, and a rule the browser cannot
 * apply is a rule the reader only meets after pressing Save.
 */

/** What the backend accepts. Kept as one source for both the test and the message. */
export const HANDLE_PATTERN = /^[a-z0-9_]{2,64}$/;
export const HANDLE_MIN = 2;
export const HANDLE_MAX = 64;

export function isHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value);
}

/*
 * Cyrillic is transliterated rather than dropped. A workspace working in
 * Russian types "Цены" into the name field, and a handle that came back empty
 * would leave them typing latin by hand for a field they never asked for.
 */
/** Every mark Uzbek latin uses for the apostrophe in o' and g', including the ones a phone keyboard inserts. */
const APOSTROPHE = /['‘’ʻʼ`]/;

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "s", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "",
  э: "e", ю: "yu", я: "ya",
};

/**
 * A readable name turned into a handle the backend will take.
 *
 * The apostrophes go first and are not replaced by anything: `o'` and `g'` are
 * one Uzbek letter each, and turning "ro'yxat" into `ro_yxat` splits a word the
 * reader thinks of as whole. Every other run of unusable characters becomes a
 * single `_`, and a leading or trailing one is trimmed — `_narxlar_` is a
 * handle nobody would have typed.
 */
export function slugifyHandle(value: string): string {
  const lower = value.toLowerCase();
  let out = "";
  for (const character of lower) {
    const cyrillic = CYRILLIC[character];
    if (/[a-z0-9]/.test(character)) out += character;
    else if (cyrillic !== undefined) out += cyrillic;
    else if (APOSTROPHE.test(character)) out += "";
    else out += "_";
  }
  return out.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, HANDLE_MAX);
}

/**
 * Why this handle is not acceptable, in a sentence — `null` when it is fine.
 *
 * Three separate answers rather than one, because "faqat kichik lotin harflar,
 * raqam va _" is unhelpful to somebody whose only mistake was a capital letter,
 * and it is the wrong sentence entirely for an empty field.
 */
export function handleError(value: string, what = "Nomlanish"): string | null {
  if (!value) return `${what} bo'sh bo'lmasin.`;
  if (value.length < HANDLE_MIN) return `${what} kamida ${HANDLE_MIN} ta belgidan iborat bo'lsin.`;
  if (value.length > HANDLE_MAX) return `${what} ${HANDLE_MAX} ta belgidan oshmasin.`;
  if (!isHandle(value)) {
    return `${what}da faqat kichik lotin harflari, raqamlar va pastki chiziq (_) bo'ladi — masalan narxlar_2026.`;
  }
  return null;
}

/**
 * The first duplicate key in a set of columns, or `null`.
 *
 * The backend refuses the whole PATCH for this, and its refusal names no
 * column; the editor can point at the second one, which is the one the reader
 * just typed.
 */
export function duplicateKey(keys: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/**
 * The key a column gets from its heading — always valid, always free.
 *
 * The key used to be a field beside the heading. It is what `{{ table(...) }}`
 * addresses and what every stored row is filed under, so the form had to warn
 * that renaming it leaves the old values behind — a warning about a trap the
 * form itself was setting. Now it is derived here and never shown, which means
 * this function may not fail: there is no field left for the reader to fix.
 *
 * Two things it therefore guarantees. A heading that slugifies to nothing — one
 * written entirely in punctuation, or a single letter — still yields a usable
 * key, because `ustun_3` beside a heading is better than a refusal naming a
 * field that is not on screen. And a key already taken by another column gets a
 * number, because two columns sharing one key is the one shape the backend
 * cannot store.
 */
export function keyForLabel(label: string, taken: readonly string[], index: number): string {
  const base = slugifyHandle(label);
  const seed = base.length >= HANDLE_MIN ? base : `ustun_${index + 1}`;
  if (!taken.includes(seed)) return seed;
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${seed}_${suffix}`.slice(0, HANDLE_MAX);
    if (!taken.includes(candidate)) return candidate;
  }
  return `${seed}_${Date.now().toString(36)}`.slice(0, HANDLE_MAX);
}

