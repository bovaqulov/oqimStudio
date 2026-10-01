"use client";

import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { SNIPPETS, STARTER } from "@/features/bots/components/code/script-help";
import type { FlowExpressionUse, FlowScriptHook } from "@/features/flows";
import { cn } from "@/lib/utils/cn";
import type { ScriptFileKey } from "./types";

/**
 * The stub a hook is added as.
 *
 * `hooks.py::_driver` calls it with one argument and awaits the answer, so the
 * shape is not a choice: the name exactly as the runtime looks for it, `ctx`
 * as the parameter, and an empty line with the caret's worth of indent in it.
 * A stub the author has to correct before it runs is a stub that teaches the
 * signature wrong.
 */
function hookStub(name: string): string {
  return `function ${name}(ctx) {\n  \n}`;
}

/** What a missing helper is added to the library as. Arity is the author's to fill in. */
function helperStub(name: string): string {
  return `function ${name}() {\n  \n}`;
}

/** One thing the list offers: what it says, and what it puts in the file. */
interface Entry {
  id: string;
  label: string;
  /** Rendered in mono — a reserved name the runtime looks for, not a title. */
  mono: boolean;
  hint: string;
  code: string;
  /** Already in the file. A second declaration of one name silently wins. */
  present: boolean;
}

/**
 * The whole library sample, offered first.
 *
 * From `script-help` and not written again here: those four functions were each
 * run through `POST /api/flows/script/run/` before they were written down, with
 * the awkward arguments as well as the happy ones. A sample that throws the
 * first time somebody presses it teaches them the editor is broken.
 */
const STARTER_ENTRY: Entry = {
  id: "namuna",
  label: "To'liq namuna",
  mono: false,
  hint: "O'z biznesingizni qo'shish: kutubxonadagi funksiyalarni chaqiradigan bitta funksiya.",
  code: STARTER,
  present: false,
};

/**
 * What the list holds, which is the whole difference between the two files.
 *
 * The flow file holds hooks — reserved names, three of them, and whether this
 * file declares each one is a fact the backend sends rather than a guess made
 * here. The library holds helpers, and there the panel cannot know what is
 * already declared: this list has the file's *name*, not its text, so `present`
 * is only ever true for a hook.
 */
function entriesFor(file: ScriptFileKey, hooks: FlowScriptHook[]): Entry[] {
  if (file === "flow") {
    return hooks.map((hook) => ({
      id: hook.name,
      label: hook.name,
      mono: true,
      hint: hook.when,
      code: hookStub(hook.name),
      present: hook.declared,
    }));
  }
  return [
    STARTER_ENTRY,
    ...SNIPPETS.map((snippet) => ({
      id: snippet.id,
      label: snippet.label,
      mono: false,
      hint: snippet.hint,
      code: snippet.code,
      present: false,
    })),
  ];
}

export interface ScriptRailProps {
  file: ScriptFileKey;
  hooks: FlowScriptHook[];
  expressions: FlowExpressionUse[];
  /** Puts text where the caret is. A no-op while the editor has not mounted. */
  onInsert(text: string): void;
  canEdit: boolean;
}

/**
 * The panel's right-hand column: what can be put into the file, and what the
 * flow already asks of it.
 *
 * One list and not two, because there is one caret. What it offers follows the
 * open file — hooks over there, helpers over here — and everything in it is
 * inserted by being clicked, so nothing has to be typed from a picture of it.
 *
 * Under the list, the same for both files: every `{{ funksiya(...) }}` the
 * flow's blocks call, grouped by the block that calls it, with the ones the bot
 * has no function for marked. That inventory is the reason the whole panel
 * exists. A helper is renamed in one editor and the placeholders that named it
 * are in twelve blocks across three screens; nothing else in the product can
 * answer "what breaks if I rename this", and a `{{...}}` that resolves to
 * nothing does not fail loudly — it sends an empty string to a customer.
 */
export function ScriptRail({ file, hooks, expressions, onInsert, canEdit }: ScriptRailProps) {
  const entries = entriesFor(file, hooks);
  const called = new Set(expressions.flatMap((use) => use.functions));
  const missing = new Set(expressions.flatMap((use) => use.missing));

  function choose(entry: Entry) {
    // Never a second copy. Two declarations of one name in one file is legal
    // JavaScript, the later one silently wins, and the author would be editing
    // the version the runtime does not call.
    if (entry.present) {
      showToast(`«${entry.label}» faylda allaqachon bor — ikkinchi nusxa birinchisini bosib qo'yardi.`);
      return;
    }
    onInsert(entry.code);
    showToast(`«${entry.label}» qo'shildi`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5 overflow-y-auto p-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="t-footnote t-secondary m-0">{file === "flow" ? "Hooklar" : "Tayyor funksiyalar"}</h3>
          <p className="t-caption t-tertiary m-0 leading-[17px]">
            {file === "flow"
              ? "Runtime shu nomlarni o'zi chaqiradi. Bosing — kursor turgan joyga bo'sh funksiya qo'shiladi."
              : "Bosing — kursor turgan joyga to'liq funksiya qo'shiladi. Har birini oqim va bloklar nomi bilan chaqiradi."}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={!canEdit}
              onClick={() => choose(entry)}
              className={cn(
                "oq-press flex cursor-pointer flex-col items-start gap-0.5 rounded-[10px] border-0 bg-neutral-850 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40",
                entry.present && "opacity-70",
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-200 max-md:text-[15px]",
                    entry.mono && "font-mono",
                  )}
                >
                  {entry.label}
                </span>
                {entry.present ? (
                  <span className="t-caption flex flex-none items-center gap-1 text-success-fg">
                    <Icon name="check" size={12} /> faylda bor
                  </span>
                ) : (
                  <Icon name="plus" size={13} />
                )}
              </span>
              <span className="t-caption t-tertiary leading-[16px]">{entry.hint}</span>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="t-caption t-tertiary m-0">Bu versiyada chaqiriladigan hook yo&apos;q.</p>
          )}
        </div>
      </div>

      <div className="h-px flex-none bg-separator" />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="t-footnote t-secondary m-0">Oqim nimani chaqiradi</h3>
          {called.size > 0 && (
            <span className="t-caption t-tertiary tabular-nums">{called.size} ta funksiya</span>
          )}
        </div>

        {expressions.length === 0 ? (
          <p className="t-caption t-tertiary m-0 leading-[17px]">
            Bu oqimning bloklarida {"{{ funksiya(...) }}"} chaqiruvi yo&apos;q.
          </p>
        ) : (
          <>
            <p className="t-caption t-tertiary m-0 leading-[17px]">
              Bloklar matnidagi {"{{ funksiya(...) }}"} chaqiruvlari. Kutubxonada funksiya nomini
              o&apos;zgartirsangiz, shu ro&apos;yxatdagi joylar siniydi.
            </p>

            {expressions.map((use) => (
              <div key={use.nodeId} className="flex flex-col gap-1">
                <span className="t-caption t-tertiary truncate">{use.title}</span>
                <div className="flex flex-wrap gap-1">
                  {use.functions.map((fn) => {
                    const absent = use.missing.includes(fn);
                    const chip = cn(
                      "inline-flex items-center gap-1 rounded-[7px] px-1.5 py-[3px] font-mono text-[11.5px] max-md:text-[13px]",
                      absent ? "bg-danger-bg text-danger-fg" : "bg-neutral-800 text-neutral-300",
                    );
                    // Actionable only where the fix belongs. A function the
                    // library does not declare is written in the library, so
                    // that is the only file where clicking it can do anything
                    // but move the author to the wrong editor.
                    if (absent && file === "library" && canEdit) {
                      return (
                        <button
                          key={`${use.nodeId}:${fn}`}
                          type="button"
                          title={`«${fn}» uchun bo'sh funksiya qo'shish`}
                          onClick={() => {
                            onInsert(helperStub(fn));
                            showToast(`«${fn}» qo'shildi — ichini to'ldiring`);
                          }}
                          className={cn(chip, "oq-press cursor-pointer border-0")}
                        >
                          <Icon name="plus" size={11} />
                          {fn}
                        </button>
                      );
                    }
                    return (
                      <span key={`${use.nodeId}:${fn}`} className={chip}>
                        {absent && <Icon name="warning" size={11} />}
                        {fn}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}

            {missing.size > 0 && (
              <p className="t-caption m-0 leading-[17px] text-warning-fg">
                {file === "library"
                  ? `Qizil nomlar bu kutubxonada yo'q (${missing.size} ta). Ustiga bosing — bo'sh funksiya qo'shiladi.`
                  : `Qizil nomlar bot kutubxonasida yo'q (${missing.size} ta). Ular «Bot kutubxonasi» faylida yoziladi.`}
              </p>
            )}
          </>
        )}
      </div>

      {!canEdit && (
        <p className="t-caption t-tertiary m-0">Kodni tahrirlash uchun muharrir huquqi kerak.</p>
      )}
    </div>
  );
}
