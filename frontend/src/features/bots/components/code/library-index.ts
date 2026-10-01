/**
 * What a bot's library actually declares, read out of the library itself.
 *
 * Every new bot now ships with a standard library of about fifty functions
 * (`backend/apps/engine/script/stdlib.js`), and the panel has to say what is in
 * it — an author who cannot see that `money()` exists writes `pul()`, and the
 * bot ends up with two functions doing one thing, one of which nothing
 * documents.
 *
 * **The list is derived, never written down.** A hand-kept copy of the shipped
 * library would be true on the day it was written and a lie on the first day
 * somebody edits their own file — and editing it is the point: `money()`
 * formats som, and the bot selling in euros has to be able to change it. So
 * this reads the text on screen, which means it is right about the shipped
 * functions, right about the ones the author renamed, and right about the ones
 * they added themselves. Nothing to keep in step.
 *
 * The declaration pattern is `apps/engine/expressions.py::DECLARATION_PATTERN`
 * ported name for name, and that matters more than it looks: the backend uses
 * that regex to decide which functions a `{{ ifoda }}` may call without a
 * warning. A list built from a different rule would show an author a function
 * the editor then warns about — two answers to one question, which is the
 * failure this repository keeps paying for.
 */

/** One function the library declares. */
export interface LibraryEntry {
  name: string;
  /**
   * The `// ─── … ───` banner it sits under, or "" for a file with no
   * sections — an author's own additions usually have none.
   */
  group: string;
  /**
   * The first sentence of the comment block above it, in the author's words.
   * Empty when the function shares its neighbour's comment, which the shipped
   * library does for pairs like `discount` and `markup`.
   */
  summary: string;
  /** 1-based, so a click can put the caret on the declaration. */
  line: number;
}

/** `// ─── Son va pul ───────` — a section banner, however long the rule is. */
const BANNER = /^\/\/\s*[─—-]{2,}\s*(.+?)\s*[─—-]{2,}\s*$/;

/**
 * The two shapes a top-level declaration takes, anchored to the start of a
 * line so a function nested inside another one is not offered as one the
 * blocks can call.
 */
const DECLARATION = /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)|^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/;

/** A name starting with `_` is the library's own plumbing — it says so itself. */
const PRIVATE = /^_/;

export function indexLibrary(source: string): LibraryEntry[] {
  const lines = (source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const found: LibraryEntry[] = [];
  let group = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const banner = BANNER.exec(line.trim());
    if (banner) {
      group = banner[1] ?? "";
      continue;
    }

    const declared = DECLARATION.exec(line);
    if (!declared) continue;
    const name = declared[1] ?? declared[2] ?? "";
    if (!name || PRIVATE.test(name)) continue;

    found.push({ name, group, summary: summaryAbove(lines, index), line: index + 1 });
  }
  return found;
}

/**
 * The comment block immediately above a declaration, as one sentence.
 *
 * Read upwards and stopped by the first line that is not a `//` comment, so a
 * function with a blank line above it has no summary rather than borrowing the
 * one belonging to whatever came before. Borrowing is the worse failure: a
 * wrong one-liner beside a function name is read as fact and sends somebody to
 * the wrong helper.
 */
function summaryAbove(lines: string[], at: number): string {
  const above = (lines[at - 1] ?? "").trim();
  // Both comment styles, because the shipped library uses both — `//` for the
  // short ones and `/* … */` for the four or five that need a paragraph. A
  // reader that knew only the first showed a bare name for `closest`,
  // `parseDateUz` and `escapeMd`: the functions somebody most needs to be told
  // about, and the ones whose explanation is longest.
  const block = above.endsWith("*/") ? blockAbove(lines, at) : slashesAbove(lines, at);
  // The first sentence only. These comments carry two or three examples —
  // `money(150000) -> "150 000 so'm" · money(7, "XTR") -> "7 XTR"` — and a list
  // is read by scanning, so the second example is noise until somebody has
  // chosen the row.
  const text = block.join(" ").replace(/\s+/g, " ").trim();
  const stop = text.search(/(?<=\S)\.(?:\s|$)/);
  return stop === -1 ? text : text.slice(0, stop + 1);
}

/** A run of `//` lines directly above, read upwards. */
function slashesAbove(lines: string[], at: number): string[] {
  const block: string[] = [];
  for (let index = at - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line.startsWith("//") || BANNER.test(line)) break;
    block.unshift(line.slice(2).trim());
  }
  return block;
}

/**
 * One block comment directly above, read upwards to its opening.
 *
 * Stopped at the first line that opens one, and given up on if none appears
 * before the top of the file — an unterminated comment is a file that will not
 * parse anyway, and guessing at its extent would put half the library into one
 * function's summary.
 */
function blockAbove(lines: string[], at: number): string[] {
  const block: string[] = [];
  for (let index = at - 1; index >= 0; index -= 1) {
    const raw = (lines[index] ?? "").trim();
    const line = raw.replace(/\*\/$/, "").replace(/^\/\*+/, "").replace(/^\*+/, "").trim();
    if (line) block.unshift(line);
    if (raw.startsWith("/*")) return block;
  }
  return [];
}

/** Grouped in the order the file declares them — the author's own ordering. */
export function byGroup(entries: LibraryEntry[]): { group: string; entries: LibraryEntry[] }[] {
  const groups: { group: string; entries: LibraryEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.group === entry.group) last.entries.push(entry);
    else groups.push({ group: entry.group, entries: [entry] });
  }
  return groups;
}
