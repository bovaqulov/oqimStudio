/**
 * What V8 said, in the language the rest of the screen is written in.
 *
 * The sandbox hands back the engine's own `error.message` untouched
 * (`engine/script/host.mjs` — `String(error?.message ?? error)`), which is the
 * right thing for it to do: that string is what an author pastes into a search
 * box, and a backend that translated it would be throwing away the only text
 * anybody else on the internet has ever written about the fault. The cost is
 * that the one sentence in the Kod screen a reader most needs is the only one
 * in English, on a screen that is otherwise entirely Uzbek — «Unexpected token
 * '{'» over a panel of Uzbek prose reads as the app breaking rather than as the
 * code being wrong.
 *
 * So the translation happens here, where both can be shown: the Uzbek is the
 * headline and the engine's own words stay under it verbatim.
 *
 * ## What is in the table and what is not
 *
 * Only the messages people actually reach, and each one is quoted from V8 —
 * not from a memory of what Node prints. Everything else passes through
 * unchanged, which is why this returns `null` rather than a best guess: a
 * wrong translation of a rare fault costs more than an untranslated one,
 * because the reader cannot tell it is wrong and the English underneath is the
 * only thing that would have told them.
 *
 * The patterns are anchored at the start and the ends are left open on
 * purpose. V8 has added detail to these strings across versions — an
 * identifier here, a hint there — and a pattern that demanded the whole
 * sentence would quietly stop matching on a Node upgrade, with nothing failing
 * except the language.
 *
 * ## Why it is shared by both editors
 *
 * The bot's Kod screen and the flow editor's Script panel run the same sandbox
 * through the same endpoint and print the same string, so a table that lived
 * in one of them would leave the other in English. `ScriptRail` already reaches
 * across for `script-help`, which is the same argument about the same sandbox.
 */

/** One message shape, and what to call it in Uzbek. */
interface Rendering {
  match: RegExp;
  /** `groups` are the pattern's captures — a name or a symbol out of the message. */
  say(groups: string[]): string;
}

/**
 * First match wins, so the specific shapes come before the general ones.
 *
 * «Unexpected token» is the one to read twice. V8 emits it for a stray brace, a
 * stray bracket and for `const = x` alike, so the symbol it names is the whole
 * of the information in it — which is why it is captured and quoted rather than
 * dropped into a generic sentence about syntax.
 */
const RENDERINGS: Rendering[] = [
  {
    // The missing closing brace, and the reason this table exists at all: the
    // file simply ends while something is still open, so the number the panel
    // points at is the *last* line and never the one that was left open.
    match: /^Unexpected end of input/,
    say: () => "Qavs yopilmagan — fayl tugadi, lekin { yoki ( ochiq qoldi",
  },
  {
    match: /^Unexpected token '(.+?)'/,
    say: ([symbol]) => `Kutilmagan belgi «${symbol}» — bu yerda u turmasligi kerak`,
  },
  { match: /^Unexpected token/, say: () => "Kutilmagan belgi" },
  {
    match: /^Unexpected identifier '(.+?)'/,
    say: ([name]) => `Kutilmagan so'z «${name}» — oldingi qatorda vergul yoki nuqtali vergul tushib qolganmi?`,
  },
  { match: /^Unexpected identifier/, say: () => "Kutilmagan so'z — oldingi qator tugallanmagan bo'lishi mumkin" },
  { match: /^Unexpected string/, say: () => "Kutilmagan matn — qo'shtirnoq ichidagi qism bu yerda turmasligi kerak" },
  { match: /^Unexpected number/, say: () => "Kutilmagan son" },
  {
    // `for`, `class`, `const` and friends used as a name. Rare from scratch,
    // constant when code is pasted out of another language.
    match: /^Unexpected reserved word/,
    say: () => "Bu so'z JavaScript uchun band — o'zgaruvchiga boshqa nom bering",
  },
  {
    // The invisible one. A no-break space or a curly quote out of a chat, a
    // doc or Telegram itself — the line reads perfectly and will not compile.
    // The editor boxes the space in red for the same reason.
    match: /^Invalid or unexpected token/,
    say: () => "Noto'g'ri belgi — ko'chirib qo'yilgan «qiyshiq» qo'shtirnoq yoki ko'rinmas bo'sh joy bo'lishi mumkin",
  },
  {
    match: /^Missing initializer in const declaration/,
    say: () => "const e'lon qilindi, lekin qiymat berilmadi",
  },
  {
    match: /^Identifier '(.+?)' has already been declared/,
    say: ([name]) => `«${name}» ikki marta e'lon qilingan`,
  },
  {
    match: /^Illegal return statement/,
    say: () => "return funksiya ichida bo'lishi kerak",
  },
  {
    // Both halves of the same refusal: V8's own words when the file is a
    // module, and `host.mjs`'s resolve hook when it is not. Neither is a
    // mistake in the code so much as a boundary — see the sandbox's six.
    match: /^Cannot use import statement/,
    say: () => "import ishlatilmaydi — skript faqat shu fayldagi kodni va inputs ni ko'radi",
  },
  {
    match: /^(.+?) is not defined/,
    say: ([name]) => `«${name}» topilmadi — bunday nom e'lon qilinmagan`,
  },
  {
    match: /^(.+?) is not a function/,
    say: ([name]) => `«${name}» funksiya emas`,
  },
  {
    match: /^Cannot read properties of (undefined|null) \(reading '(.+?)'\)/,
    say: ([what, key]) => `${what} ichidan «${key}» o'qib bo'lmadi — undan oldingi qiymat bo'sh`,
  },
  {
    match: /^Assignment to constant variable/,
    say: () => "const o'zgaruvchiga qayta qiymat berib bo'lmaydi — let yozing",
  },
  {
    match: /^Maximum call stack size exceeded/,
    say: () => "Chaqiruvlar juda chuqurlashib ketdi — funksiya o'zini to'xtovsiz chaqiryapti",
  },
  {
    match: /^(.+?) is not iterable/,
    say: ([name]) => `«${name}» ro'yxat emas — uni for...of bilan aylanib bo'lmaydi`,
  },
];

/**
 * The Uzbek headline for one sandbox message, or `null` for one this table has
 * no honest words for.
 *
 * `null` and not the message itself, so a caller can tell the two apart: a
 * translated fault is shown as a headline with the engine's line under it, and
 * an untranslated one is shown as it always was, alone. A function that
 * returned the input unchanged would make those two cases identical and the
 * second would grow a redundant second copy of the same English.
 */
export function scriptErrorInUzbek(message: string): string | null {
  const text = message.trim();
  if (!text) return null;
  for (const rendering of RENDERINGS) {
    const found = rendering.match.exec(text);
    // `slice(1)` is the captures only. An empty list is normal — most of these
    // have nothing to quote back.
    if (found) return rendering.say(found.slice(1));
  }
  return null;
}

/**
 * The line out of a refusal, or null.
 *
 * `engine/script/sandbox.py::check_syntax` is the one place that formats the
 * sentence a save is refused with, and it appends « (3-qator) » when the
 * sandbox could say where. The number is read back out of the text rather than
 * carried as a field of its own because the error envelope this API answers
 * with holds a code, a message and a field and nothing else — widening it for
 * one integer would change every error the product can raise.
 *
 * `features/flows/graph-actions.ts::lineIn` is the same read on the same
 * string, for the Script panel's copy of this screen. Two readers of one
 * format is one too many; they belong in one place the next time somebody owns
 * both files.
 */
export function lineInRefusal(message: string): number | null {
  const found = /\((\d+)-qator\)/.exec(message);
  if (!found) return null;
  const line = Number(found[1]);
  return Number.isSafeInteger(line) && line > 0 ? line : null;
}
