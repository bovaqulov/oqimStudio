import type { ApiKeyScope } from "./types";

/**
 * What a scope lets the holder do, said twice on purpose.
 *
 * `label` is the sentence somebody granting it reads — a person deciding what
 * to hand a CRM is deciding about their customers, not about a token grammar,
 * and "contacts:read" is not a sentence about customers. `key` is the string
 * the backend matches on and the string that goes in the caller's own
 * configuration, so it stays on screen beside the sentence rather than instead
 * of it: a screen that showed only the prose would leave the reader with
 * nothing to type, and one that showed only the token is what this replaced.
 *
 * Ordered read-before-write within an area, so the more dangerous grant is
 * never the first thing a finger lands on.
 */
export interface ScopeDefinition {
  key: ApiKeyScope;
  /** The full sentence, for the moment somebody is choosing. */
  label: string;
  /** The same thing at pill length, for a row that already carries four of them. */
  short: string;
}

export const SCOPE_DEFINITIONS: readonly ScopeDefinition[] = [
  {
    key: "flows:read",
    label: "Oqimlarni va ularning tuzilishini o'qiydi",
    short: "Oqimlarni o'qish",
  },
  {
    key: "flows:write",
    label: "Oqim yaratadi, tahrirlaydi va o'chiradi",
    short: "Oqimlarni o'zgartirish",
  },
  {
    key: "bots:read",
    label: "Botlar ro'yxatini va ularning holatini o'qiydi",
    short: "Botlarni o'qish",
  },
  {
    key: "contacts:read",
    label: "Mijozlar ro'yxatini va ularning ma'lumotlarini o'qiydi",
    short: "Mijozlarni o'qish",
  },
];

const BY_KEY = new Map(SCOPE_DEFINITIONS.map((definition) => [definition.key as string, definition]));

/** Whether a string is one of the four the backend accepts. */
export function isApiKeyScope(value: string): value is ApiKeyScope {
  return BY_KEY.has(value);
}

/**
 * A scope as it prints, including one this build has never heard of.
 *
 * An unknown scope prints as itself rather than disappearing: a key that holds
 * a permission the interface cannot name still holds it, and a row that quietly
 * dropped it would be answering "what can this key reach" with a lie.
 */
export function describeScope(raw: string): ScopeDefinition {
  return BY_KEY.get(raw) ?? { key: raw as ApiKeyScope, label: raw, short: raw };
}
