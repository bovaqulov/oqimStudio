"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Input";
import { scriptErrorInUzbek } from "@/features/bots/components/code/script-errors";
import type { FlowScriptHook, ScriptRunResult } from "@/features/flows";
import { runScriptAction } from "@/features/flows/graph-actions";
import { cn } from "@/lib/utils/cn";
import { declaresHook } from "./declares";
import type { CodeProblem, ScriptFileKey } from "./types";

/** How a checked file reads back: what happened, and what to do about it. */
interface Verdict {
  tone: "ok" | "warn" | "bad";
  /** One line, and short enough to survive the collapsed row. */
  headline: string;
  detail: string;
  /**
   * The engine's own sentence, when `detail` is a translation of it.
   *
   * Both are shown, and the order is the point: the panel is written in Uzbek
   * and «Unexpected token '{'» in the middle of it reads as the app being
   * broken rather than the code. The English is what somebody searches with,
   * so it stays — underneath, in the engine's own words, never edited.
   */
  raw?: string;
}

const TONE_CLASS: Record<Verdict["tone"], string> = {
  ok: "text-success-fg",
  warn: "text-warning-fg",
  bad: "text-danger-fg",
};

const TONE_ICON: Record<Verdict["tone"], "check-circle" | "warning"> = {
  ok: "check-circle",
  warn: "warning",
  bad: "warning",
};

/**
 * What the sandbox's own word for a failure means for the next press.
 *
 * `kind` is a closed vocabulary rather than prose precisely so that this table
 * can exist: the error text says what went wrong, and these say what to do
 * about it, which is a different sentence every time. `author` has none —
 * a fault in the code is answered by the line number beside it, and a second
 * line saying "there is a mistake in your code" is noise on top of the message
 * that already said so.
 */
const KIND_ADVICE: Record<ScriptRunResult["kind"], string> = {
  "": "",
  author: "",
  runtime:
    "Kod ishga tushdi, lekin bajarilish paytida to'xtadi — ko'pincha kutilmagan qiymat sabab. Namuna ctx dagi maydonlarni tekshiring.",
  timeout: "Vaqt tugadi: suhbatda 2 soniya, shu panelda 8. Tugamaydigan sikl yoki juda og'ir hisob bormi?",
  memory: "64 MB xotiradan oshdi. Butun ro'yxatni xotirada tutmang — kerakli maydonlarnigina oling.",
  unavailable:
    "Bu serverda skriptlar umuman ishga tushmaydi. Kodda emas, sozlamada gap: administrator yoqishi kerak.",
  busy: "Hozir bir vaqtning o'zida juda ko'p skript ishlayapti. Bir zumdan keyin yana bosing.",
};

/**
 * The clock, frozen.
 *
 * `ctx.now` is filled from the server's clock at run time, but a *sample* built
 * by reading the browser's would be one string in the markup Next renders and
 * another in the one React hydrates — a mismatch on the very textarea the
 * reader is about to type in. A sample date is a sample; the real one arrives
 * with the run.
 */
const SAMPLE_NOW = "2026-09-03T09:20:00+05:00";

/**
 * `ctx` as the runtime builds it, filled in with somebody plausible.
 *
 * Copied field for field from `apps/engine/hooks.py::context_for` — the same
 * names, the same nesting, camelCase where it is camelCase there and dotted
 * keys inside `vars`, where the runtime keeps the names every placeholder in
 * the same flow already uses. An empty object would be a faster start and a
 * worse one: what stops somebody on the first hook is not the syntax, it is
 * not knowing that the customer's name is `ctx.user.firstName` and not
 * `ctx.first_name`.
 *
 * `block` is deliberately absent. `context_for` adds it only when the caller
 * hands a node over, and which hooks get one is the runtime's to say — a
 * sample field that turns out to be `undefined` at run time teaches a variable
 * that does not exist, which is the failure this panel is here to prevent.
 *
 * `vars` is a handful and not the whole set for the same honesty in the other
 * direction: the real one carries everything the run has collected, and a
 * sample listing twenty keys would read as a promise of exactly those twenty.
 */
function sampleCtx(hook: string): string {
  const ctx: Record<string, unknown> = {
    module: "dms",
    // "test" in the studio's own chat, "live" with a real customer.
    mode: "test",
    bot: { id: 7654321098, username: "demo_savdo_bot", name: "Demo savdo" },
    user: {
      id: 312455901,
      firstName: "Aziza",
      lastName: "Karimova",
      username: "aziza_k",
      phone: "998901234567",
    },
    chat: { id: 312455901, type: "private", title: "" },
    flow: { id: "flw_demo", name: "Buyurtma qabul qilish" },
    now: SAMPLE_NOW,
    locale: "uz",
    vars: {
      "user.first_name": "Aziza",
      mijoz_telefoni: "998901234567",
      narx: 120000,
      language: "uz",
    },
  };
  // Only on the hook that has one: an empty `ctx.message` on `onFlowStart`
  // reads as "the customer sent nothing", which is a different fact from
  // "nothing was sent to this hook".
  if (hook === "onUserMessage") ctx.message = { text: "Ha, roziman", command: "" };
  return JSON.stringify(ctx, null, 2);
}

/**
 * Where the JSON stopped parsing, in lines the reader can count.
 *
 * The offset is taken out of the engine's message and turned into a line and a
 * column here rather than read out of it. V8 prints the position in every
 * version and the rest of the sentence in none of them consistently — and all
 * of it in English, which is not what this panel speaks.
 */
function jsonFault(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const at = /position (\d+)/.exec(message);
  if (!at) return "To'g'ri JSON emas.";
  const upto = text.slice(0, Number(at[1]));
  const line = upto.split("\n").length;
  const column = upto.length - upto.lastIndexOf("\n");
  return `${line}-qator, ${column}-belgida uzilib qoldi.`;
}

/** The sample, checked before a single byte leaves the browser. */
function parseCtx(text: string): { ok: true; ctx: Record<string, unknown> } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: `Namuna ctx JSON emas: ${jsonFault(text, error)}` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Namuna ctx obyekt bo'lishi kerak — { } ichida yoziladi." };
  }
  return { ok: true, ctx: value as Record<string, unknown> };
}

/** `hooks.py::WRITABLE_KEY` — a name a placeholder could read back. */
const WRITABLE_KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** `hooks.py::MAX_WRITES`. */
const MAX_WRITES = 40;

/**
 * Which keys of a hook's answer actually become variables.
 *
 * `hooks.py::writable` decides this on the other side, and it decides it in
 * silence: a hook that returns anything but an object writes nothing at all,
 * and a key no `{{...}}` could name again is skipped one at a time. Both are
 * the kind of quiet that costs an afternoon — the hook ran, the panel said it
 * worked, and the variable is simply not there in the next block. `null` here
 * means "there was nothing to write from", which is not the same as "nothing
 * was written".
 */
function writes(value: unknown): { kept: string[]; dropped: string[]; over: number } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>);
  const valid = keys.filter((key) => WRITABLE_KEY.test(key));
  return {
    kept: valid.slice(0, MAX_WRITES),
    dropped: keys.filter((key) => !WRITABLE_KEY.test(key)),
    over: Math.max(0, valid.length - MAX_WRITES),
  };
}

/** A fault placed in the file on screen: where to underline it, and what to call it. */
interface Fault {
  /** For the editor above. `null` when there is nothing in *this* file to mark. */
  problem: CodeProblem | null;
  /** The clause after the headline: " · 4-qator", " · kutubxonada 7-qator", or nothing. */
  place: string;
  /** The fault is in the bot's library, which this file cannot fix. */
  inLibrary: boolean;
}

/**
 * Reading `where` and `line` back into the file the author has open.
 *
 * The two files are read completely differently and this is the only place
 * that knows it.
 *
 * The **library** is run with no bot named, so nothing is prepended and the
 * number the backend reports is already counted in the text on screen
 * (`compose` returns the source byte for byte when there is no library, and
 * `locate` leaves that case alone). `where` is ignored there: with nothing
 * above it, it can only ever answer "block", which is the wrong word for the
 * file being looked at.
 *
 * The **flow file** is run the way the runtime runs it — the bot's library
 * above, one appended line below — so `where` genuinely separates the two
 * editors, and "library" means a fault the author cannot fix from here. The
 * last case is the appended line itself: `locate` has already subtracted the
 * library, so a number past the end of the author's file is a line inside the
 * driver, and pointing at line 12 of an eleven-line file is worse than
 * pointing at nothing (`hooks.py::call` refuses the same number for the same
 * reason).
 */
function locateFault(result: ScriptRunResult, file: ScriptFileKey, ranSource: string): Fault {
  if (result.ok) return { problem: null, place: "", inLibrary: false };

  if (file === "library") {
    return {
      problem: { line: result.line, message: result.error },
      place: result.line === null ? "" : ` · ${result.line}-qator`,
      inLibrary: false,
    };
  }

  if (result.where === "library") {
    const at = result.line === null ? "" : ` ${result.line}-qator`;
    return { problem: null, place: ` · kutubxonada${at}`, inLibrary: true };
  }

  const authorLines = ranSource.split("\n").length;
  if (result.line === null || result.line > authorLines) {
    return { problem: { line: null, message: result.error }, place: "", inLibrary: false };
  }
  return { problem: { line: result.line, message: result.error }, place: ` · ${result.line}-qator`, inLibrary: false };
}

/**
 * What one check of the library file means.
 *
 * The same three-way judgement `bots/components/code/ScriptLibraryEditor` makes
 * about the same file — written out again rather than imported, because that is
 * another feature's component and a shared judgement is not a shared button.
 *
 * The middle case is the reason this is not a boolean. A run that succeeds
 * *with a value* means the file has a top-level `return` in it: legal
 * JavaScript, silent, and fatal — the library is prepended to every Kod block,
 * so that `return` fires before the block's own code and the block never runs.
 */
function libraryVerdict(result: ScriptRunResult): Verdict {
  const fault = locateFault(result, "library", "");
  if (!result.ok) {
    const said = scriptErrorInUzbek(result.error);
    return { tone: "bad", headline: `Xato${fault.place}`, detail: said ?? result.error, raw: said ? result.error : undefined };
  }
  if (result.value !== null) {
    return {
      tone: "warn",
      headline: "Kutubxona qiymat qaytardi",
      detail:
        "Bu faylda return bor. U blokning kodidan oldin ishlaydi, ya'ni har bir «Kod» bloki umuman ishga tushmaydi. Bu yerda faqat function bo'lsin.",
    };
  }
  return {
    tone: "ok",
    headline: "Xato topilmadi",
    detail: "Funksiyalar yuklandi — endi ularni «Kod» blokida va oqim skriptida nomi bilan chaqirish mumkin.",
  };
}

/** What one call of a hook means — including the part the author cannot see. */
function flowVerdict(result: ScriptRunResult, hook: string, ranSource: string): Verdict {
  const fault = locateFault(result, "flow", ranSource);

  if (!result.ok) {
    const said = scriptErrorInUzbek(result.error);
    const what = said ?? result.error;
    return {
      tone: "bad",
      headline: `Xato${fault.place}`,
      detail: fault.inLibrary
        ? `${what} — bu xato bot kutubxonasida, uni «Bot kutubxonasi» faylida tuzatasiz.`
        : what,
      raw: said ? result.error : undefined,
    };
  }

  const written = writes(result.value);
  if (written === null) {
    return {
      tone: "ok",
      headline: result.value === null ? `${hook}() ishladi` : `${hook}() ishladi — yozilmadi`,
      detail:
        result.value === null
          ? "Hech narsa qaytmadi — faqat ish bajaradigan yoki log yozadigan hook uchun bu odatiy hol."
          : "Qaytgan qiymat obyekt emas, shuning uchun birorta o'zgaruvchi yozilmaydi. O'zgaruvchi kerak bo'lsa { nom: qiymat } qaytaring.",
    };
  }
  if (written.kept.length === 0) {
    return {
      tone: written.dropped.length > 0 ? "warn" : "ok",
      headline: `${hook}() ishladi — yozilmadi`,
      detail:
        written.dropped.length > 0
          ? `Birorta kalit o'zgaruvchi bo'la olmadi: ${written.dropped.join(", ")}. Nom harf yoki _ bilan boshlanishi kerak.`
          : "Bo'sh obyekt qaytdi — yoziladigan o'zgaruvchi yo'q.",
    };
  }
  const extra = [
    written.dropped.length > 0
      ? `Tashlab yuborildi: ${written.dropped.join(", ")} — bunday nomni {{ }} ichida qayta o'qib bo'lmaydi.`
      : "",
    written.over > 0 ? `Yana ${written.over} ta kalit ${MAX_WRITES} ta chegarasidan oshdi.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    tone: written.dropped.length > 0 || written.over > 0 ? "warn" : "ok",
    headline: `${hook}() → ${written.kept.join(", ")}`,
    detail: `Oqimga shu o'zgaruvchilar yoziladi: ${written.kept.join(", ")}.${extra ? ` ${extra}` : ""}`,
  };
}

const PILL =
  "oq-press flex min-h-[26px] flex-none cursor-pointer items-center gap-1 rounded-full px-2.5 font-mono text-[11.5px] whitespace-nowrap";

/**
 * A block of the sandbox's own output.
 *
 * Capped and scrolling in its own right, inside a drawer that is already capped.
 * Fifty lines of `console.log` are one press away — the loop somebody is
 * debugging is usually the reason they pressed run — and without this the log
 * pushes the error message, the sample and everything else out of the scroll
 * the reader has to travel to reach them.
 */
const PRE =
  "m-0 max-h-[120px] overflow-auto rounded-[10px] bg-neutral-900 p-2.5 font-mono text-[11.5px] leading-relaxed text-neutral-400 max-md:text-[13px]";

/** The quiet line under the controls — what a press costs, and what it includes. */
const RUN_HINT: Record<ScriptFileKey, string> = {
  flow: "Saqlamasdan bir marta chaqiradi. Bot kutubxonasi, xuddi ish paytidagidek, faylning yuqorisiga qo'shiladi.",
  library:
    "Saqlamasdan ishga tushiradi. Funksiyani sinash uchun faylning oxiriga console.log(money(12000)) yozib ko'ring.",
};

export interface ScriptTestPanelProps {
  /** The file on screen, verbatim. */
  source: string;
  /** Which file it is — it changes what a run means and what a fault is called. */
  file: ScriptFileKey;
  /** Whose shared library goes above the source. Null runs the source alone. */
  botId: string | null;
  /** The hooks this build's runtime calls, with whether this file declares them. */
  hooks: FlowScriptHook[];
  canEdit: boolean;
  /** Where a fault is, so the editor above can underline it. Null clears. */
  onProblem(problem: CodeProblem | null): void;
}

/**
 * Running the file that is open, the way it will actually be run.
 *
 * The two files need two different presses and the difference is not cosmetic.
 *
 * The **library** is checked alone, with no bot named, because naming one would
 * put this same file above itself — every function declared twice, the second
 * silently winning. What comes back is the three-way verdict, and the middle of
 * the three is the one nothing else in the product can tell anybody: a library
 * that returns a value has a top-level `return`, and it stops every Kod block
 * in the bot before that block's first line.
 *
 * The **flow file** is called the way `hooks.py::_driver` calls it — the hook's
 * name applied to `inputs.ctx` on one appended line, with the bot's library
 * above, because at run time it really is above. That is what makes a green
 * tick here worth anything: a hook that passes with the library missing is a
 * hook that will throw the first time a customer reaches it.
 *
 * ## Why it is a bar and not a form
 *
 * This is a code editor with a test drawer under it, and the first version read
 * as a test form with a code box above it: measured in the browser at 1440×900,
 * CodeMirror had 39% of the panel and this had 55%, with the run button pressed
 * against the bottom edge on the *default* screen. Height here is taken
 * straight out of the thing the author came to do.
 *
 * So everything that must be reachable in one press — which hook, run it, and
 * how the last run went — lives on one 52px row, and everything else is behind
 * a disclosure that remembers its state for as long as the panel is open. The
 * sample `ctx` is hidden first because it is both the tallest control and the
 * least edited: most runs use it unchanged, and the ones that do not are
 * deliberate. The body is capped at `30vh` and scrolls inside itself, so a
 * fifty-line `console.log` costs the editor nothing.
 *
 * A failed run opens the drawer by itself, and only a failed one. The headline
 * fits in the row — «Xato · 4-qator» — but the sentence that says what actually
 * went wrong does not, and a panel that hides the answer to the press somebody
 * just made is a panel they will stop pressing.
 *
 * Everything happens on the button. A run costs a Node process on our machines
 * and the endpoint counts them per account, so an effect that fired on mount
 * would spend somebody's budget on a panel they only opened to read.
 */
export function ScriptTestPanel({ source, file, botId, hooks, canEdit, onProblem }: ScriptTestPanelProps) {
  const flow = file === "flow";
  const [open, setOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [hook, setHook] = useState("");
  const [ctxText, setCtxText] = useState(() => sampleCtx(hooks.find((item) => item.declared)?.name ?? ""));
  const [result, setResult] = useState<ScriptRunResult | null>(null);
  // What was actually run. The verdict is read against this and not against the
  // props, which keep changing under it while somebody types in the editor
  // above — a line number is only true about the text it was reported for.
  const [ran, setRan] = useState<{ source: string; hook: string; file: ScriptFileKey } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [running, startRun] = useTransition();

  // Only the hooks this file declares are offered, and the choice falls back to
  // the first of them rather than being corrected by an effect. Offering a name
  // the file has not written is offering a press whose only possible answer is
  // «... is not a function» — and on an empty script that would be all three of
  // them, which is how the first version came to shout a warning at somebody who
  // had simply not started yet.
  const declared = hooks.filter((item) => item.declared || declaresHook(source, item.name));
  const active = declared.find((item) => item.name === hook) ?? declared[0] ?? null;
  const shown = ran !== null && ran.file === file ? result : null;
  const stale = ran !== null && (ran.source !== source || ran.hook !== (flow ? (active?.name ?? "") : ""));
  const runnable = source.trim().length > 0 && (!flow || active !== null);

  function run() {
    setRefusal(null);
    // Cleared before the request rather than after it: a verdict left on screen
    // during a run is a verdict about the previous press, and it is green.
    setResult(null);
    setRan(null);

    const text = source;

    if (!flow) {
      startRun(async () => {
        const answer = await runScriptAction(text, {}, null);
        setResult(answer);
        setRan({ source: text, hook: "", file });
        if (!answer.ok) setOpen(true);
        onProblem(locateFault(answer, "library", text).problem);
      });
      return;
    }

    if (!active) {
      setRefusal("Avval hook qo'shing — o'ngdagi ro'yxatdan.");
      return;
    }
    const parsed = parseCtx(ctxText);
    if (!parsed.ok) {
      // The thing to fix is the one thing that is hidden, so the press that
      // found it is also the press that opens it.
      setOpen(true);
      setCtxOpen(true);
      setRefusal(parsed.message);
      return;
    }

    // `hooks.py::_driver`, letter for letter. Appended and never prepended, so
    // every line of the author's file keeps the number the editor shows beside
    // it — a driver on top would shift all of them by one.
    const name = active.name;
    const body = `${text}\nreturn await ${name}(inputs.ctx);`;
    startRun(async () => {
      const answer = await runScriptAction(body, { ctx: parsed.ctx }, botId);
      setResult(answer);
      setRan({ source: text, hook: name, file });
      if (!answer.ok) setOpen(true);
      onProblem(locateFault(answer, "flow", text).problem);
    });
  }

  const verdict =
    shown && (flow ? flowVerdict(shown, ran?.hook ?? "", ran?.source ?? source) : libraryVerdict(shown));
  const advice = shown ? KIND_ADVICE[shown.kind] : "";

  return (
    <div className="flex flex-none flex-col border-t border-neutral-800">
      {/* The row that is always there. Nothing in it may wrap: this is the
          height the editor pays whether or not anybody opens the drawer. */}
      <div className="flex items-center gap-2 px-3.5 py-2">
        {flow && declared.length > 0 && (
          <div className="no-scrollbar flex min-w-0 shrink gap-1 overflow-x-auto">
            {declared.map((item) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={item.name === active?.name}
                title={item.when}
                onClick={() => setHook(item.name)}
                className={cn(
                  PILL,
                  item.name === active?.name ? "bg-accent-700 text-white" : "bg-neutral-800 text-neutral-300",
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}

        {canEdit ? (
          <Button type="button" onClick={run} disabled={running || !runnable} className="flex-none">
            <Icon name="play" size={15} />
            {running ? "Ishlamoqda…" : flow ? "Ishga tushirish" : "Tekshirish"}
          </Button>
        ) : (
          <span className="t-footnote t-tertiary flex-none">Ishga tushirish uchun muharrir huquqi kerak.</span>
        )}

        {/* One slot, and it says the most useful thing there is to say: what the
            last run answered, or — before anything has been run — what is
            missing before there is anything to run. */}
        <p className="m-0 min-w-0 flex-1 truncate">
          {refusal ? (
            <span className="t-footnote text-danger-fg">{refusal}</span>
          ) : verdict && shown ? (
            <span className={cn("t-footnote inline-flex max-w-full items-center gap-1.5", TONE_CLASS[verdict.tone], stale && "opacity-50")}>
              <Icon name={TONE_ICON[verdict.tone]} size={14} />
              <span className="truncate">{verdict.headline}</span>
              <span className="t-tertiary flex-none font-mono text-[11px] tabular-nums">{shown.durationMs} ms</span>
            </span>
          ) : flow && declared.length === 0 ? (
            // Grey and not orange. An empty script is the ordinary state of a
            // file nobody has written yet, not a fault to be warned about — so
            // this says what to do next and stays out of the way while it is
            // being done.
            <span className="t-footnote t-tertiary truncate">
              {hooks.length === 0
                ? "Bu versiyada oqim skripti chaqiradigan hook yo'q."
                : "Hook yozilmagan — o'ngdagi ro'yxatdan qo'shing, keyin shu yerdan sinaysiz."}
            </span>
          ) : null}
        </p>

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="oq-press t-caption flex flex-none cursor-pointer items-center gap-1 rounded-[8px] border-0 bg-transparent px-1.5 py-1 text-neutral-500"
        >
          {open ? "Yig'ish" : flow ? "Namuna ctx" : "Tafsilot"}
          <Icon name={open ? "caret-down" : "caret-up"} size={12} />
        </button>
      </div>

      {open && (
        // The ceiling, and the scroll that makes it hold. A long error or fifty
        // lines of `console.log` grow inside this box and stop there; without it
        // they come out of the editor's height, which is the one thing on this
        // screen that should never shrink.
        <div className="flex max-h-[30vh] flex-col gap-2.5 overflow-y-auto px-3.5 pb-3">
          {/* The answer to the press comes first, and the sample second. The
              drawer opens by itself on a failure, and what has to be at the top
              of it then is the sentence that says what went wrong — not a
              hundred and thirty pixels of `ctx` the author would have to scroll
              past to reach it. */}
          {verdict && shown && (
            <div className={cn("flex flex-col gap-1.5", stale && "opacity-50")}>
              {/* The sentence, not a footnote. The row above carries a headline
                  three words long; this is where what actually happened is
                  written, and it is the reason the drawer opened. */}
              <p className="t-footnote t-secondary m-0">{verdict.detail}</p>
              {/* The engine's own sentence, kept whole under the translation:
                  it is the string a search engine answers to, and the Uzbek
                  above it is not. */}
              {verdict.raw && <p className="t-caption t-tertiary m-0 font-mono">{verdict.raw}</p>}
              {advice && <p className="t-caption t-tertiary m-0 leading-[17px]">{advice}</p>}

              {shown.ok && shown.value !== null && (
                <>
                  <span className="t-caption t-tertiary">Qaytgan qiymat</span>
                  <pre className={PRE}>{JSON.stringify(shown.value, null, 2)}</pre>
                </>
              )}
              {shown.logs.length > 0 && (
                <>
                  <span className="t-caption t-tertiary">console.log</span>
                  <pre className={PRE}>{shown.logs.join("\n")}</pre>
                </>
              )}

              {/* Dimmed above and said in words here: an underline in the editor
                  still points at the line this result was about, and the file no
                  longer says what it said when it was reported. */}
              {stale && <p className="t-caption m-0 text-warning-fg">Kod o&apos;zgardi — natija eskirdi.</p>}
            </div>
          )}

          {flow && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={ctxOpen}
                  onClick={() => setCtxOpen((value) => !value)}
                  className="oq-press t-footnote t-secondary flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0"
                >
                  <Icon name={ctxOpen ? "caret-down" : "caret-right"} size={12} />
                  Namuna ctx
                </button>
                {ctxOpen && (
                  <button
                    type="button"
                    onClick={() => setCtxText(sampleCtx(active?.name ?? ""))}
                    className="oq-press t-caption cursor-pointer border-0 bg-transparent p-0 text-accent-400"
                  >
                    Namunani tiklash
                  </button>
                )}
              </div>
              {ctxOpen ? (
                <>
                  {/* A fixed 128px with its own scroll, not `rows`. The sample is
                      twenty lines long and the author reads four of them; giving
                      it its natural height is what took the editor's. */}
                  <Textarea
                    value={ctxText}
                    onChange={(event) => setCtxText(event.target.value)}
                    disabled={!canEdit}
                    // The four the code editors also turn off: a curly quote
                    // inside a JSON string is a sample that will not parse, and
                    // nothing says why.
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    aria-label="Namuna ctx (JSON)"
                    className="h-[128px] resize-none font-mono text-[12px] leading-[17px] max-md:text-[13px]"
                  />
                  <p className="t-caption t-tertiary m-0 leading-[16px]">
                    Suhbat qayerda turganini bildiruvchi obyekt — ish paytida uni runtime to&apos;ldiradi. Hook
                    uni <span className="font-mono">ctx</span> nomi bilan oladi.
                  </p>
                </>
              ) : (
                <p className="t-caption t-tertiary m-0 leading-[16px]">
                  Hook shu obyekt bilan chaqiriladi. Ko&apos;pincha namunani o&apos;zgartirish shart emas.
                </p>
              )}
            </div>
          )}

          <p className="t-caption t-tertiary m-0 leading-[16px]">{RUN_HINT[file]}</p>
        </div>
      )}
    </div>
  );
}
