import type { FlowNode } from "@/features/flows";
import { LANGUAGE_VARIABLE } from "./message-content";

export interface VariableItem {
  path: string;
  label: string;
}

export interface VariableGroup {
  label: string;
  items: VariableItem[];
}

/**
 * The answers a flow collects about the person on the other end, as ready-made
 * slots rather than as identifiers to invent.
 *
 * The name is the part an author should never have to author. "Ism" is what
 * they mean; `mijoz_ismi` is what the runtime needs, and a builder that asks
 * for the second one is asking them to be a programmer for no reason. Every
 * slot carries its own preview value so a `{{mijoz_ismi}}` typed today reads as
 * a name in the preview rather than as markup.
 */
export interface AnswerSlot {
  /** The stored variable name — derived, never typed. */
  key: string;
  label: string;
  /** Stand-in shown by the preview and by "Namuna bilan to'ldirish". */
  sample: string;
}

export const ANSWER_SLOTS: AnswerSlot[] = [
  { key: "mijoz_ismi", label: "Ism", sample: "Aziz" },
  { key: "mijoz_telefoni", label: "Telefon", sample: "+998 90 123 45 67" },
  { key: "mijoz_manzili", label: "Manzil", sample: "Toshkent, Amir Temur ko'chasi 1" },
  { key: "mijoz_izohi", label: "Izoh", sample: "Narxlarni bilmoqchi edim" },
];

/**
 * A variable name built out of what the author called the thing.
 *
 * Uzbek is written in Latin here, so the only characters that need a decision
 * are the apostrophes in o'/g' — dropped rather than transliterated, because
 * `og_zgaruvchi` is not a name anyone recognises as theirs.
 *
 * The class holds seven characters and not one, because which apostrophe
 * somebody types is decided by their keyboard: iOS autocorrects the plain
 * U+0027 into the curly U+2019, the Uzbek Latin standard spells the letter
 * with U+02BB, and a Russian layout offers U+0060. Only U+0027 and U+0060 were
 * here, so a label typed on a phone — "Tug'ilgan sana" with a smart quote —
 * derived `tug_ilgan_sana` while the backend derived `tugilgan_sana`, and the
 * placeholder the panel showed the author was not the one the runtime wrote.
 *
 * `apps/webapp/spec.py::to_key` is the other copy, and
 * `apps/webapp/tests_key_contract.py` replays *this function's own source* to
 * prove the two still agree. Change one and that test names the other.
 */
export function toVariableName(label: string): string {
  return label
    .toLowerCase()
    .replace(/['`´ʻʼ‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * The label a derived name came from, near enough to edit.
 *
 * Still lossy, but less so than it was: the apostrophes `toVariableName` drops
 * are restored for the stems where doing so cannot be wrong (see
 * [[APOSTROPHE_STEMS]]). A field that reopens showing "Kompaniya nomi" is one
 * the author recognises as theirs, and `kompaniya_nomi` is not.
 */
/**
 * The apostrophes `toVariableName` throws away, put back where it is safe.
 *
 * o' and g' are letters in Uzbek, not punctuation, so `so'radi` becoming
 * `soradi` is a spelling mistake rather than a formatting one — and the flow
 * list prints these back at the author as words. There is no general rule to
 * reverse it, so this is a list, and one with a strict admission test: a stem
 * only belongs here when the stripped form is *not itself a word*. `soz`
 * (a tune, an instrument) and `yoq` (a side) are both real, so `so'z` and
 * `yo'q` stay unrecoverable — guessing there would corrupt a name somebody
 * meant.
 *
 * Anything not on the list reads back exactly as it was stored, which is what
 * happened to every one of these before.
 */
const APOSTROPHE_STEMS: Record<string, string> = {
  soradi: "so'radi",
  soragan: "so'ragan",
  sorash: "so'rash",
  sorov: "so'rov",
  bolim: "bo'lim",
  bolimi: "bo'limi",
  tolov: "to'lov",
  tolovi: "to'lovi",
  ozgaruvchi: "o'zgaruvchi",
  korish: "ko'rish",
  qoshish: "qo'shish",
  kop: "ko'p",
  togri: "to'g'ri",
  boyicha: "bo'yicha",
};

export function toVariableLabel(name: string): string {
  const words = name
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => APOSTROPHE_STEMS[word.toLowerCase()] ?? word)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * The tables this bot's workspace holds, as things a message can say.
 *
 * Not part of `VARIABLE_GROUPS` because it cannot be: the group is a fact about
 * *this* workspace, read off the flow's own `tables`, while everything above is
 * a constant. Built on demand for that reason.
 *
 * `tableText(...)` and not `table(...)`: both are provided by the runtime
 * without the bot needing a script library at all (see `PROVIDED` in
 * `apps/engine/expressions.py`), and the one an author writing a sentence wants
 * is the one that renders as a sentence. `table(...)` hands back rows for code
 * to walk, which is a thing to reach for from the Kod panel and not from a
 * message field.
 *
 * The column keys are listed under it rather than offered as `{{ qator.narx }}`
 * placeholders, and that is deliberate: `qator` only exists downstream of a
 * «Ma'lumot o'qish» block, and that block is not in the palette today. Offering
 * a placeholder no flow can currently fill would be the editor promising what
 * the runtime cannot deliver — the exact failure this menu is meant to end.
 * What the keys are still worth being is *visible*: an author who cannot see
 * that a table has a `narx` column cannot write about it at all.
 */
export function tableVariableGroup(tables: { handle: string; name: string; columns: { key: string; label: string }[] }[]): VariableGroup | null {
  if (!tables.length) return null;
  return {
    label: "Ma'lumotlar",
    items: tables.map((table) => ({
      path: `tableText("${table.handle}")`,
      // The columns after the name, because "which table" is the choice and
      // "what is in it" is what makes the choice an informed one.
      label: table.columns.length
        ? `${table.name} — ${table.columns.map((column) => column.key).join(", ")}`
        : table.name,
    })),
  };
}

/** `{{ }}` placeholders available inside message/condition text — the Bot API fields the platform resolves at send time. */
export const VARIABLE_GROUPS: VariableGroup[] = [
  {
    // First because it is what a flow actually asks for: the Bot API fields
    // below are always available and almost never the thing being written.
    label: "Yig'ilgan javoblar",
    items: [
      ...ANSWER_SLOTS.map((slot) => ({ path: slot.key, label: slot.label })),
      // Written by the "Til" block rather than by a question, but it is still
      // something the customer told the bot and it is read back the same way.
      // A flow that greets differently per language, or a handoff note that
      // says which language the operator should answer in, needs it here.
      { path: LANGUAGE_VARIABLE, label: "Tanlangan til" },
    ],
  },
  {
    label: "Foydalanuvchi",
    items: [
      { path: "user.first_name", label: "Ism" },
      { path: "user.last_name", label: "Familiya" },
      { path: "user.username", label: "Username" },
      { path: "user.id", label: "Foydalanuvchi ID" },
    ],
  },
  {
    label: "Suhbat",
    items: [
      { path: "chat.id", label: "Suhbat ID" },
      { path: "chat.type", label: "Suhbat turi" },
      { path: "chat.title", label: "Suhbat nomi" },
    ],
  },
  {
    label: "Xabar",
    items: [
      { path: "message.text", label: "Xabar matni" },
      { path: "message.id", label: "Xabar ID" },
      { path: "message.date", label: "Sana" },
    ],
  },
  {
    label: "Biznes",
    items: [
      { path: "business.connection_id", label: "Ulanish ID" },
      { path: "business.account", label: "Akkaunt" },
    ],
  },
  {
    /*
     * What a Mini App submission puts in the run.
     *
     * Only the three names that are the same for every bot are listed. The
     * answers themselves arrive as `webapp.<savol>`, derived from each
     * question's own label by the Web App module — so the menu cannot enumerate
     * them without reading this bot's form, and the summary is what a message
     * usually wants anyway.
     */
    label: "Web App",
    items: [
      { path: "webapp.summary", label: "To'ldirilgan forma" },
      { path: "webapp.button", label: "Bosilgan tugma" },
      { path: "webapp.verified", label: "Tasdiqlangan" },
    ],
  },
  {
    label: "Bot",
    items: [
      { path: "bot.id", label: "Bot ID" },
      { path: "bot.username", label: "Bot username" },
      { path: "bot.mini_app_url", label: "Mini ilova manzili" },
    ],
  },
];

/**
 * Stand-in values used by the live preview so `{{user.first_name}}` reads as a
 * real message rather than as markup. Never sent — preview only.
 */
const SAMPLE_VALUES: Record<string, string> = {
  "user.first_name": "Aziz",
  "user.last_name": "Karimov",
  "user.username": "@azizkarimov",
  "user.id": "184920371",
  "chat.id": "184920371",
  "chat.type": "private",
  "chat.title": "Mijozlar guruhi",
  "message.text": "Narxlarni bilmoqchiman",
  "message.id": "4821",
  "message.date": "10.08.2026 14:32",
  "business.connection_id": "bZc9Kq1",
  "business.account": "Biznes akkaunt",
  "bot.id": "7712004488",
  "bot.username": "@mening_botim",
  "bot.mini_app_url": "https://oqim.example/webapp/bot123",
  "webapp.summary": "Ismingiz: Aziz\nBuyurtma turi: Yetkazish",
  "webapp.button": "Formani ochish",
  "webapp.verified": "true",
  // Not Bot API fields but the names the collect-an-answer slots write. Without
  // them the first flow every bot has would preview its thank-you with braces
  // showing (see `features/flows/data/starter-graph.ts`).
  ...Object.fromEntries(ANSWER_SLOTS.map((slot) => [slot.key, slot.sample])),
  // The code, not the label: that is what the runtime stores and therefore what
  // a `{{mijoz_tili}}` in a message resolves to.
  [LANGUAGE_VARIABLE]: "uz",
};

/**
 * The variables *this flow* writes, with a stand-in value for each.
 *
 * Read off the graph rather than kept anywhere, so it cannot go stale: a Savol
 * block's «Qayerga saqlash» and a Teg block set to `set_variable` are the two
 * ways a flow puts a name into the run, and both are on the node.
 *
 * The sample matters more than it looks. A test panel opening on
 * `{"mijoz_telefoni": "namuna"}` invites a script that formats a phone number
 * to be written against the word "namuna"; opening on a real-looking
 * `+998 90 123 45 67` does not.
 */
export function collectedVariables(nodes: FlowNode[]): Record<string, string> {
  const samples = new Map(ANSWER_SLOTS.map((slot) => [slot.key, slot.sample]));
  const collected: Record<string, string> = {};

  for (const node of nodes) {
    const saved = (node.saveAnswerAs ?? "").trim();
    if (saved) collected[saved] = samples.get(saved) ?? "namuna";

    if (node.tagAction === "set_variable") {
      const name = (node.tagName ?? "").trim();
      // The author's own value where they gave one — it is the likeliest thing
      // the variable will actually hold.
      if (name) collected[name] = (node.tagValue ?? "").trim() || samples.get(name) || "namuna";
    }
  }
  return collected;
}

/**
 * A stand-in context: every variable the editor knows about, with its sample.
 *
 * The Kod block's test panel opens on this rather than on `{}`. An empty JSON
 * box is the exact place a reader who is not a programmer stops — not because
 * the syntax is hard, but because nothing on screen says what the names are.
 * Pre-filled, the same box answers that question by being full of them.
 *
 * `collected` is what the flow's own Savol blocks write; those come first,
 * since a script is far more likely to be about an answer somebody gave than
 * about the Telegram account they gave it from.
 */
export function sampleContext(collected: Record<string, string> = {}): Record<string, string> {
  return { ...SAMPLE_VALUES, ...collected };
}

/**
 * The placeholder shape, copied from the one thing that decides it.
 *
 * `VARIABLE_PATTERN` in `apps/engine/sender.py`, character for character —
 * including the second group, which is what the runtime's filter chain lives
 * in. The editor used to match `{{ name }}` alone while
 * [[unguardedPlaceholders]] was telling authors, in so many words, to write
 * `{{user.last_name | default: "…"}}`: advice the same editor then previewed as
 * raw braces. Two readings of one syntax is the bug, so there is one here and
 * it is a copy of theirs.
 *
 * `g` is on it and it is only ever handed to `replace` and `matchAll`, which
 * are the two that own `lastIndex` between them. A `test()` against this would
 * carry state from the call before it.
 */
export const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*((?:\|[^}]*)?)\}\}/g;

/**
 * A placeholder that *calls* something rather than naming it —
 * `{{ money(cartTotal(savat)) }}`, run against the bot's script library by the
 * backend (`apps/engine/expressions.py`, and the grammar there is this one).
 *
 * The editor deliberately does not evaluate these. Doing so would mean a
 * second JavaScript engine holding a second copy of the library, and this
 * repository has already paid for two implementations of one set of rules
 * once: the test chat stopped walking graphs locally for exactly that reason.
 * So a preview shows that a value belongs here and says nothing about what it
 * will be — the real number comes from the test chat, which runs the engine.
 */
export const EXPRESSION_PATTERN =
  /\{\{\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*\(.*?\)\s*\}\}/g;

/**
 * What a preview draws where a computed value will be.
 *
 * Not the source: `Jami: money(...)` in a chat bubble reads as a bot that is
 * broken, and it leaks how the flow is built to somebody looking at a picture
 * of their own message. Not a made-up number either, which would be a preview
 * telling a confident lie.
 */
export const EXPRESSION_PLACEHOLDER = "…";

export interface VariableFilter {
  name: string;
  argument: string;
}

/**
 * `| default: "mehmon" | qisqartir: 40` as the filters it names.
 *
 * Split by hand rather than on `|`, for the reason `sender._split_filters`
 * gives: an argument may contain the separator. `default: "ha|yo'q"` is a
 * legitimate thing to write and a naive split turns it into a second filter
 * called `yo'q"`.
 */
export function parseFilters(source: string): VariableFilter[] {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (const char of source) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "|") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  const filters: VariableFilter[] = [];
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const colon = piece.indexOf(":");
    const name = (colon === -1 ? piece : piece.slice(0, colon)).trim().toLowerCase();
    filters.push({ name, argument: unquote(colon === -1 ? "" : piece.slice(colon + 1).trim()) });
  }
  return filters;
}

function unquote(argument: string): string {
  const first = argument[0];
  if (argument.length >= 2 && first === argument[argument.length - 1] && (first === '"' || first === "'")) {
    return argument.slice(1, -1);
  }
  return argument;
}

/**
 * The one filter the runtime implements, and the reason the list is short.
 *
 * `sender.FILTERS` is a closed dictionary with `default` in it and a comment
 * naming what Faza 2 adds (`pul`, `sana`, `qisqartir`). Previewing a filter
 * that does not exist yet is the same bug pointing the other way — the author
 * would see a formatted price here and raw braces in Telegram — so this list
 * grows when that one does and not before. An unknown name leaves the value
 * alone, exactly as `render_text` does.
 */
const FILTERS: Record<string, (value: string | undefined, argument: string) => string | undefined> = {
  // "Nothing worth showing" is wider than "missing", and deliberately so on
  // both sides: a surname nobody was asked for is `""` and a tapped space is
  // `" "`, and all three produced "Salom, !".
  default: (value, argument) => (value === undefined || !value.trim() ? argument : value),
};

/**
 * Substitutes `{{path}}` placeholders, filters and all.
 *
 * `collected` comes first: inside the test chat those are the answers the
 * tester actually gave, and showing "Aziz" to somebody who just typed their own
 * name is the difference between a preview and a lie. Sample data fills in the
 * rest so a message still reads as a message, and a name nothing answers keeps
 * its braces — a visible typo, where a blank is one the author cannot see.
 * That last rule is what `default` overrides, here as at run time: a hole the
 * author has already said what to put in is not an unanswered question.
 */
export function applySampleValues(text: string, collected: Record<string, string> = {}): string {
  // Expressions first, names second — the same order the runtime substitutes
  // in, so a preview and a real message agree about which placeholder is the
  // outer one.
  return text
    .replace(EXPRESSION_PATTERN, EXPRESSION_PLACEHOLDER)
    .replace(VARIABLE_PATTERN, (match: string, path: string, filterSource: string) => {
    let value: string | undefined = collected[path] ?? SAMPLE_VALUES[path];
    for (const filter of parseFilters(filterSource ?? "")) {
      const handler = FILTERS[filter.name];
      if (handler) value = handler(value, filter.argument);
      }
      return value ?? match;
    });
}

/**
 * How the variable popover was opened.
 *
 * `{{` is the syntax itself and stays supported for whoever already knows it.
 * `@` is the one people try first — it is what every other editor they have
 * used means by "mention something" — and it is the reason the braces are the
 * editor's job rather than the author's: an `@` query carries no braces at all,
 * so the insertion writes both halves.
 */
export type VariableTriggerKind = "brace" | "at";

export interface VariableQuery {
  kind: VariableTriggerKind;
  /** What was typed after the trigger — the popover filters on it. */
  text: string;
  /** Where the trigger itself starts; an insertion replaces from here to the cursor. */
  start: number;
}

/** A bare `@`, not one inside an email or a `@@`. */
const AT_QUERY = /(?:^|[^\w@])(@[\w.]*)$/;

/**
 * Finds the variable query under the cursor, whichever way it was opened.
 *
 * Braces win when both could read: inside `{{user.@` the author is already
 * committed to a placeholder, and treating the `@` as a fresh mention would
 * insert a second pair of braces inside the first.
 */
export function getActiveVariableQuery(value: string, cursor: number): VariableQuery | null {
  const uptoCursor = value.slice(0, cursor);

  const openIdx = uptoCursor.lastIndexOf("{{");
  if (openIdx !== -1 && uptoCursor.lastIndexOf("}}") < openIdx) {
    const text = uptoCursor.slice(openIdx + 2);
    // A newline means the braces were left behind on an earlier line rather
    // than being what the cursor is sitting in.
    if (!text.includes("\n")) return { kind: "brace", text, start: openIdx };
  }

  const at = AT_QUERY.exec(uptoCursor);
  if (!at) return null;
  const token = at[1]!;
  return { kind: "at", text: token.slice(1), start: cursor - token.length };
}

/** Replaces the open query under the cursor with a resolved `{{path}}` placeholder. */
export function insertVariable(
  value: string,
  cursor: number,
  path: string,
  query: VariableQuery,
): { next: string; caret: number } {
  const before = value.slice(0, query.start);
  const inserted = `{{${path}}}`;
  return { next: before + inserted + value.slice(cursor), caret: (before + inserted).length };
}
