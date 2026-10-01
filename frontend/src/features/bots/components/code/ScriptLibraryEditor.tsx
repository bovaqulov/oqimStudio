"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import type { ScriptRunResult } from "@/features/flows";
import { runScriptAction } from "@/features/flows/graph-actions";
import { MainButton } from "@/lib/telegram/MainButton";
import { useUnsavedGuard } from "@/lib/telegram/useUnsavedGuard";
import { hapticResult } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";
import { saveBotScriptLibraryAction } from "../../actions";
import { SCRIPT_LIBRARY_INITIAL_STATE } from "../../form-state";
import type { BotScriptLibrary } from "../../types";
import { ScriptHelpPanel } from "./ScriptHelpPanel";
import { lineInRefusal, scriptErrorInUzbek } from "./script-errors";
import { COUNTER_FROM, LIBRARY_CHAR_LIMIT, append } from "./script-help";

/**
 * What an empty box says.
 *
 * Three lines and not the whole sample: placeholder text is grey, it vanishes
 * at the first keystroke, and it cannot be copied — so a thirty-line starter
 * put here would be unreadable exactly while it was needed and gone the moment
 * it was wanted. That version lives in the panel below, where it can be read
 * and then moved. The first line's job is to say the panel is there.
 *
 * The function is named the same as the sample's, so the two are not two ideas.
 *
 * Rare now, and worth saying so when it happens. Every bot connected since the
 * standard library shipped starts with it already in the file
 * (`bots/services.py::starter_library`), so an empty box means a bot from
 * before that, or one whose author emptied it — and «kutubxonasiz qolgan» is
 * the honest word for both.
 */
const PLACEHOLDER = `// Bu bot kutubxonasiz qolgan. Pastdagi «To'liq namuna» dan boshlash mumkin.
function yetkazish(summa, tuman) {
  return num(summa) >= 200000 ? 0 : 15000;
}`;

/** How a checked file reads back: what happened, and what to do about it. */
interface Verdict {
  tone: "ok" | "warn" | "bad";
  headline: string;
  detail: string;
  /**
   * The engine's own sentence, when `detail` is a translation of it.
   *
   * Kept and shown rather than replaced: «Unexpected token '{'» is the string
   * an author pastes into a search box, and it is the only text about this
   * fault that anybody outside this product has ever written. The Uzbek says
   * what happened; this says it in the words the rest of the world uses.
   */
  raw?: string;
  /** Which line of the box the fault is on, when the sandbox could say. */
  line?: number | null;
}

/**
 * Puts the caret on a line and brings it into view.
 *
 * The reason it exists is a 986-line library: a message saying «986-qator» is
 * a message about a line the reader then has to find by hand in a twelve-row
 * box. Selecting it is the closest a textarea gets to the underline the flow
 * editor's CodeMirror draws — the line is marked, and it is on screen.
 *
 * The scroll is measured rather than calculated. The box wraps, so a line's
 * top is not its number times the line height: one long line is several rows
 * on screen and the arithmetic drifts further the longer the file is — which
 * is exactly the file this is for. Truncating the value at the end of the
 * target line and reading `scrollHeight` asks the browser where that line
 * actually ended, and the whole text is put back in the next statement, before
 * a paint or an `input` event can happen. React never sees the interim value:
 * assigning `.value` fires no event, and the element is controlled, so the
 * next render writes the same string back.
 */
function revealLine(field: HTMLTextAreaElement, line: number) {
  const rows = field.value.split("\n");
  const index = Math.min(Math.max(Math.trunc(line), 1), rows.length) - 1;
  // `+ 1` per row for the newline that `split` consumed.
  const start = rows.slice(0, index).reduce((total, row) => total + row.length + 1, 0);
  // `split` on any string answers at least one element, so the clamp above
  // cannot land outside — `?? ""` is what says that to the compiler.
  const end = start + (rows[index] ?? "").length;

  const whole = field.value;
  field.value = whole.slice(0, end);
  const bottom = field.scrollHeight;
  field.value = whole;

  field.focus();
  field.setSelectionRange(start, end);
  // Centred, not scrolled-to-top: a fault is nearly always explained by the
  // lines above it — an unclosed brace, a missing comma — and a line pinned to
  // the top edge hides every one of them.
  field.scrollTop = Math.max(0, bottom - field.clientHeight / 2);
}

/**
 * What one check of this file means.
 *
 * The run is deliberately made **without** a bot id, so the sandbox is handed
 * this box and nothing else (`flows/views.py::script_run` puts the bot's saved
 * library above the source when one is named — which here would be this same
 * file, twice, every function declared two ways). Two things follow. The line
 * number needs no translating: it is counted in the text on screen. And
 * `where` is ignored, because with nothing prepended it can only ever answer
 * "block", which is the wrong word for the file the reader is looking at.
 *
 * A run that succeeds *with a value* is the interesting case and the reason
 * this is not a boolean. It means the file has a top-level `return` in it —
 * legal JavaScript, silent, and fatal: the library is prepended to every Kod
 * block, so that `return` fires before the block's own code and the block
 * never runs at all. Nothing else in the product can tell somebody that.
 */
function verdictOf(result: ScriptRunResult): Verdict {
  if (!result.ok) {
    const at = result.line === null ? "" : ` · ${result.line}-qator`;
    // The engine's English becomes the second line when there are Uzbek words
    // for it, and stays the only line when there are not. `script-errors` says
    // why it is never thrown away.
    const said = scriptErrorInUzbek(result.error);
    return {
      tone: "bad",
      headline: `Xato${at}`,
      detail: said ?? result.error,
      raw: said ? result.error : undefined,
      line: result.line,
    };
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
    detail: "Funksiyalar yuklandi — endi ularni «Kod» blokida nomi bilan chaqirish mumkin.",
  };
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
 * The bot's shared source file.
 *
 * A plain monospace textarea for the same reason the block's own field is one
 * (see `Inspector/fields/ScriptField`): a code editor is a third of a megabyte
 * of JavaScript to colour a page of helper functions, and nothing it colours is
 * a mistake anybody makes here.
 *
 * Saved explicitly, unlike the flow editor beside it. Autosave is right for a
 * graph, where the unit of work is one dragged card; this file is read by every
 * Kod block in the bot, so a half-typed function landing in it a second after
 * it was typed breaks flows the author is not looking at.
 *
 * The help under it is the other half of that decision. Refusing syntax colour
 * is only defensible if the things that actually stop somebody are answered
 * some other way, and on an empty box the thing that stops somebody is not
 * syntax at all — it is not knowing what a script may reach, what it may hand
 * back, or what a first line even looks like. So `ScriptHelpPanel` carries the
 * sandbox's own facts and a set of working functions to put in, and the button
 * beside «Saqlash» runs the file before it is committed to every flow in the
 * bot.
 *
 * Nothing is ever placed in the box on the reader's behalf. An editor that
 * arrives pre-filled arrives dirty — the unsaved-changes guard fires on a
 * screen nobody has typed on — and one press of Saqlash would put code the
 * author has not read above every Kod block the bot runs. The sample is shown
 * where it can be read, and it moves when somebody moves it.
 */
export function ScriptLibraryEditor({
  botId,
  library,
  canEdit,
}: {
  botId: string;
  library: BotScriptLibrary;
  canEdit: boolean;
}) {
  const [state, formAction, saving] = useActionState(saveBotScriptLibraryAction, SCRIPT_LIBRARY_INITIAL_STATE);
  const [source, setSource] = useState(library.source);
  const [baseline, setBaseline] = useState(library.source);
  const [result, setResult] = useState<ScriptRunResult | null>(null);
  /**
   * Why a save was refused, and where — held here rather than read straight
   * off `state`.
   *
   * `useActionState` keeps its answer until the next submit, which is the
   * right lifetime for "did the save land" and the wrong one for a refusal:
   * the reader fixes the code, presses «Tekshirish», is told «Xato topilmadi»,
   * and a red line above it still says the file is broken at line 986. A
   * banner that outlives the fault it describes is worse than none — it is the
   * screen saying two opposite things at once, and the stale one is the one in
   * red. So the refusal is copied into state that this component can clear,
   * and it is cleared by the two things that make it untrue: an edit, and a
   * check of the text now on screen.
   */
  const [refused, setRefused] = useState<{ message: string; line: number | null } | null>(null);
  const [checking, startCheck] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Bumped by an insert. The caret has to be moved *after* React has written
  // the new value into the field, and an effect on a counter is the shortest
  // honest way to say "once the paint that added this text has happened".
  const [inserted, setInserted] = useState(0);
  const dirty = source !== baseline;

  // Read through a ref in the effect below, so the baseline is re-set from the
  // text the server answered about rather than from whatever has been typed
  // since the request went out.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useUnsavedGuard(dirty && canEdit);

  useEffect(() => {
    if (state.status === "idle") return;
    const saved = state.status === "saved";
    hapticResult(saved ? "success" : "error");
    // A save with no acknowledgement was reported as a bug on the settings
    // screen, and this one has even less to show for itself: the text on screen
    // after a save is the same text as before it.
    showToast(state.message ?? (saved ? "Saqlandi" : "Saqlab bo'lmadi"), saved ? undefined : { tone: "danger" });
    if (saved) setBaseline(sourceRef.current);
    // The number comes out of the sentence the backend wrote, which is the
    // only place it exists — `check_syntax` appends « (986-qator) » and the
    // error envelope has no field to carry it in.
    setRefused(saved || !state.message ? null : { message: state.message, line: lineInRefusal(state.message) });
  }, [state]);

  useEffect(() => {
    if (!inserted) return;
    const field = fieldRef.current;
    if (!field) return;
    // The end of the text and the bottom of the box: the code just added is
    // below the fold on any file with two functions in it already, and an
    // insert the reader cannot see reads as a button that did nothing.
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    field.scrollTop = field.scrollHeight;
  }, [inserted]);

  function insert(code: string, label: string) {
    setSource((current) => append(current, code));
    setResult(null);
    setRefused(null);
    setInserted((count) => count + 1);
    // What the code does is already on screen above the sample; what is not
    // on screen is that nothing has been written down yet. The MainButton
    // appears in the same instant, and this is the sentence that sends the
    // reader to it.
    showToast(`«${label}» qo'shildi — saqlashni unutmang`);
  }

  function check() {
    const text = source;
    // In an event handler and never in an effect: this spends a Node process
    // on the server, and the endpoint counts them per account (30/min).
    startCheck(async () => {
      const answer = await runScriptAction(text, {}, null);
      setResult(answer);
      // Whatever the run said, it said it about the text on screen — so the
      // refusal above, which is about a save of some earlier text, has stopped
      // being the newest thing known about this file. Cleared on a failed check
      // as well as a clean one: two red paragraphs describing the same fault in
      // different words is the confusion, not the warning.
      setRefused(null);
    });
  }

  const verdict = result ? verdictOf(result) : null;
  // Translated once and read twice below — the headline and the decision to
  // print the engine's own words under it are the same answer.
  const refusedSaid = refused ? scriptErrorInUzbek(refused.message) : null;
  // Lifted out of the objects they live on, because a `null` check on a
  // property does not narrow inside the click handler that follows it — only a
  // local does.
  const refusedLine = refused?.line ?? null;
  const verdictLine = verdict?.line ?? null;

  /** The «go to it» affordance, for a fault that named a line. */
  function jumpTo(line: number) {
    const field = fieldRef.current;
    if (field) revealLine(field, line);
  }

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} action={formAction} className="flex flex-col">
        <input type="hidden" name="botId" value={botId} />

        <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
          <h2 className="t-footnote t-secondary m-0">Bot kutubxonasi</h2>
          {/* The counter appears only near the ceiling. A character count on a
              four-line file is noise; on a file that is about to be refused it
              is the one number that explains the refusal. */}
          {source.length > COUNTER_FROM && (
            <span className="t-footnote t-tertiary tabular-nums">
              {source.length.toLocaleString("ru-RU")} / {LIBRARY_CHAR_LIMIT.toLocaleString("ru-RU")}
            </span>
          )}
          {library.updatedAt && !dirty && (
            <span className="t-footnote t-tertiary">{library.updatedAt} saqlangan</span>
          )}
          {dirty && <span className="t-footnote text-warning-fg">Saqlanmagan o&apos;zgarish</span>}
        </div>

        <Textarea
          ref={fieldRef}
          name="source"
          value={source}
          rows={12}
          disabled={!canEdit}
          // The four the block editor also turns off: a capitalised `inputs` or a
          // curly quote is code that does not run, and nothing says why.
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Bot kutubxonasi kodi"
          placeholder={PLACEHOLDER}
          className="font-mono text-[12.5px] leading-relaxed max-md:text-[15px]"
          onChange={(event) => {
            setSource(event.target.value);
            // The verdict described the text that was checked, and this is no
            // longer that text. Keeping it on screen would be showing a green
            // tick over code nobody has run.
            setResult(null);
            // And the refusal is about a save of text that no longer exists
            // either. One keystroke is enough: the reader is now editing, and
            // the line the refusal names has already moved.
            setRefused(null);
          }}
        />

        {refused && (
          // Under the field as well as in the toast: the toast is gone in six
          // seconds, and the reason a save was refused is what the next attempt
          // has to be built on.
          <div role="alert" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 pt-2">
            <p className="t-footnote m-0 text-danger-fg">{refusedSaid ?? refused.message}</p>
            {refusedLine !== null && (
              // The reason the whole item was raised: on a nine-hundred-line
              // file, «986-qator» without a way to get there is a number the
              // reader has to hunt for by hand in a twelve-row box.
              <button
                type="button"
                onClick={() => jumpTo(refusedLine)}
                className="oq-press t-caption cursor-pointer border-0 bg-transparent p-0 text-accent-400"
              >
                {refusedLine}-qatorga o&apos;tish
              </button>
            )}
            {refusedSaid && (
              // The engine's own sentence, kept whole. It is what a search
              // engine answers to, and the Uzbek above is not.
              <p className="t-caption t-tertiary m-0 basis-full font-mono">{refused.message}</p>
            )}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-col gap-1.5 px-1 pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={check} disabled={checking || !source.trim()}>
                <Icon name="play" size={16} />
                {checking ? "Tekshirilmoqda…" : "Tekshirish"}
              </Button>
              <span className="t-caption t-tertiary">
                Saqlamasdan ishga tushiradi. Funksiyani sinash uchun oxiriga{" "}
                <code className="font-mono">console.log(money(12000))</code> yozib ko&apos;ring.
              </span>
            </div>

            {verdict && (
              <div className="flex flex-col gap-1 pt-1">
                <p className={cn("t-footnote m-0 flex items-center gap-1.5", TONE_CLASS[verdict.tone])}>
                  <Icon name={TONE_ICON[verdict.tone]} size={14} />
                  {verdict.headline}
                  {/* The same jump the refusal above offers, because the fault
                      is the same fault however it was found. */}
                  {verdictLine !== null && (
                    <button
                      type="button"
                      onClick={() => jumpTo(verdictLine)}
                      className="oq-press t-caption cursor-pointer border-0 bg-transparent p-0 text-accent-400"
                    >
                      o&apos;tish
                    </button>
                  )}
                  <span className="t-tertiary ml-auto font-mono text-[11px] tabular-nums">
                    {result?.durationMs} ms
                  </span>
                </p>
                <p className="t-caption t-tertiary m-0 leading-[17px]">{verdict.detail}</p>
                {verdict.raw && <p className="t-caption t-tertiary m-0 font-mono">{verdict.raw}</p>}
                {result && result.logs.length > 0 && (
                  <pre className="m-0 overflow-x-auto rounded-[10px] bg-neutral-900 p-2.5 font-mono text-[11.5px] leading-relaxed text-neutral-400 max-md:text-[13px]">
                    {result.logs.join("\n")}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        <p className="t-footnote t-tertiary m-0 px-1 pt-2 leading-[18px]">
          Bu fayl har bir «Kod» blokidan oldin ishga tushadi — bir marta yozilgan funksiya botning barcha
          oqimlarida ishlaydi. <code className="font-mono">import</code> va tashqi modullar yo&apos;q: faqat shu
          yerdagi kod va blokga kelgan <code className="font-mono">inputs</code>.
        </p>

        {!canEdit && (
          <p className="t-footnote t-tertiary m-0 px-1 pt-2">Kodni tahrirlash uchun muharrir huquqi kerak.</p>
        )}

        {/* `loading` and not just a disabled button: the request carries a whole
            file, and a phone on a slow link otherwise shows nothing at all
            between the tap and the toast. */}
        {canEdit && (
          <MainButton
            text="Saqlash"
            visible={dirty}
            loading={saving}
            onClick={() => formRef.current?.requestSubmit()}
          />
        )}
      </form>

      <ScriptHelpPanel source={source} canEdit={canEdit} onInsert={insert} />
    </div>
  );
}
