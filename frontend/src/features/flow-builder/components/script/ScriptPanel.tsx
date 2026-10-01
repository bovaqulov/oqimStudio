"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { showToast } from "@/components/ui/toast-store";
import type { FlowScripts } from "@/features/flows";
import { loadFlowScriptsAction, saveScriptFileAction, type ScriptSaveResult } from "@/features/flows/graph-actions";
import { usePhoneViewport } from "@/lib/hooks/usePhoneViewport";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { useUnsavedGuard } from "@/lib/telegram/useUnsavedGuard";
import { cn } from "@/lib/utils/cn";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { CodeEditor } from "./CodeEditor";
import { declaresHook } from "./declares";
import { ScriptRail } from "./ScriptRail";
import { ScriptTestPanel } from "./ScriptTestPanel";
import type { CodeEditorHandle, CodeProblem, ScriptFileKey } from "./types";

/**
 * The flow's code, on its own screen.
 *
 * Two files are edited here and they belong to different things, which is the
 * one fact the whole panel is arranged around. `Oqim skripti` is this flow's —
 * the hooks the runtime calls around its blocks, and it travels with the flow
 * when it is exported or installed. `Bot kutubxonasi` is the *bot's*, shared by
 * every flow it runs, and it is edited from here as well because the question
 * "why is this expression empty" is answered in one of the two and the author
 * does not know which before they look.
 *
 * Nothing but code is in it — no canvas, no block list, no settings. The panel
 * covers the work area rather than docking beside it for that reason: a code
 * editor squeezed into a third of the width beside a canvas nobody is looking
 * at is neither.
 *
 * Saved on a button, never on a debounce. The graph behind it autosaves because
 * the unit of work there is one dragged card; a source file is read by every
 * block in the bot, so a half-typed function landing in it a second after it
 * was typed would break flows the author is not looking at. And the backend
 * *refuses* a file that does not compile — which an autosave could not do
 * without silently dropping keystrokes.
 */
const FILES: { value: ScriptFileKey; label: string; icon: IconName }[] = [
  { value: "flow", label: "Oqim skripti", icon: "flow-arrow" },
  { value: "library", label: "Bot kutubxonasi", icon: "code" },
];

/** What an empty flow script says. The panel's rail is where a real stub comes from. */
const FLOW_PLACEHOLDER = `// O'ngdagi ilgaklardan birini bosing — tayyor qolipi qo'yiladi.
function onFlowStart(ctx) {
  return { salomlashildi: true };
}`;

const LIBRARY_PLACEHOLDER = `// Har bir «Kod» bloki va har bir {{ ifoda }} shu fayldagi funksiyalarni ko'radi.
function money(son) {
  return new Intl.NumberFormat("uz-UZ").format(son) + " so'm";
}`;

export function ScriptPanel() {
  const open = useFlowEditorStore((s) => s.scriptOpen);
  // Mounted only while open, so nothing here loads, measures or listens for a
  // panel nobody has asked for — and so closing it really does forget the two
  // files, which is what makes the unsaved question honest.
  if (!open) return null;
  return <ScriptPanelBody />;
}

function ScriptPanelBody() {
  const flowId = useFlowEditorStore((s) => s.flowId);
  const botId = useFlowEditorStore((s) => s.botId);
  const readOnly = useFlowEditorStore((s) => s.readOnly);
  const close = useFlowEditorStore((s) => s.closeScript);
  const phone = usePhoneViewport();

  const [file, setFile] = useState<ScriptFileKey>("flow");
  const [scripts, setScripts] = useState<FlowScripts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** What is in the two boxes. Keyed by file so switching never loses an edit. */
  const [draft, setDraft] = useState<Record<ScriptFileKey, string>>({ flow: "", library: "" });
  /** What was last stored, to answer "is this dirty" without a second read. */
  const [saved, setSaved] = useState<Record<ScriptFileKey, string>>({ flow: "", library: "" });
  const [problem, setProblem] = useState<Record<ScriptFileKey, CodeProblem | null>>({ flow: null, library: null });
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  /** A confirm is on screen. See `askThenClose`. */
  const asking = useRef(false);

  const canEdit = !readOnly;
  const dirty = draft.flow !== saved.flow || draft.library !== saved.library;
  useUnsavedGuard(dirty);

  /** Both files, both baselines and both lists, from one answer. */
  const adopt = useCallback((next: FlowScripts) => {
    setScripts(next);
    setDraft({ flow: next.flow.source, library: next.library.source });
    setSaved({ flow: next.flow.source, library: next.library.source });
  }, []);

  // The one read. In an effect and not in a render because it is the panel
  // opening that asks for it, and because a server action may not be called
  // during a render at all.
  useEffect(() => {
    if (!flowId) return;
    let alive = true;
    void loadFlowScriptsAction(flowId)
      .then((result) => {
        if (!alive) return;
        if (result.ok) adopt(result.scripts);
        else setLoadError(result.message);
      })
      // The action answers rather than throws, and this is still here: a server
      // action can fail before its own body runs — the request itself never
      // lands, the deployment moved on — and a rejection with no catch leaves
      // this panel spinning at a reader for as long as they will watch it.
      .catch(() => {
        if (alive) setLoadError("Kodni o'qib bo'lmadi — ulanishni tekshiring.");
      });
    return () => {
      alive = false;
    };
  }, [flowId, adopt]);

  const askThenClose = useCallback(async () => {
    if (!dirty) {
      close();
      return;
    }
    // One question at a time. The confirm is itself a dialog that closes on
    // Escape, and without this the key that opened it would open a second one
    // behind it — a stack of identical questions about the same file.
    if (asking.current) return;
    asking.current = true;
    try {
    // Asked, because the audit found a wizard throwing away work without one.
    // The unsaved half here is a source file somebody typed by hand, which is
    // the most expensive thing in the editor to lose.
      const go = await confirmDestructive({
        title: "Saqlanmagan kod",
        message: "Yozilgan kod saqlanmagan. Yopilsa yo'qoladi.",
        confirmText: "Yopish",
      });
      if (go) close();
    } finally {
      asking.current = false;
    }
  }, [dirty, close]);

  // Esc closes — the panel is an overlay and that is what an overlay does.
  // Capture, so it wins over the canvas shortcuts underneath, and only when the
  // key was not aimed at something inside the editor that also uses it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      void askThenClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [askThenClose]);

  async function save() {
    if (!flowId || saving || !canEdit) return;
    setSaving(true);
    const source = draft[file];
    let result: ScriptSaveResult;
    try {
      result = await saveScriptFileAction(flowId, file, source, botId);
    } catch {
      // Same reason as the read above, and worse here: the button already says
      // «Saqlanmoqda…», so a throw that skipped `setSaving(false)` would leave
      // the author looking at a save that never finishes over a file that was
      // never written. `finally` would clear the word without saying why.
      setSaving(false);
      showToast("Saqlab bo'lmadi — server javob bermadi.", { tone: "danger" });
      return;
    }
    setSaving(false);

    if (!result.ok) {
      // Left in the box, always. A refused save is a file that was not written
      // and the author's only copy is the one on screen.
      setProblem((current) => ({ ...current, [file]: { line: result.line, message: result.message } }));
      showToast(result.message, { tone: "danger" });
      return;
    }

    setProblem((current) => ({ ...current, [file]: null }));
    setScripts(result.scripts);
    // Only the baseline of the file that was written moves. The other one may
    // hold unsaved work, and adopting the whole answer would quietly discard it.
    const stored = file === "flow" ? result.scripts.flow.source : result.scripts.library.source;
    setSaved((current) => ({ ...current, [file]: stored }));
    setDraft((current) => ({ ...current, [file]: stored }));
    showToast(file === "flow" ? "Oqim skripti saqlandi" : "Kutubxona saqlandi");
  }

  const fileDirty = draft[file] !== saved[file];
  const stamp = file === "flow" ? scripts?.flow.updatedAt : scripts?.library.updatedAt;

  /*
   * The hooks, re-answered against the text on screen.
   *
   * `declared` arrives from the backend and is as fresh as the last save, which
   * is right for the list of *which hooks exist* and wrong for the mark beside
   * each one: an author who has just typed `function onFlowStart` is told by
   * the rail that the file does not declare it while the drawer below is
   * already willing to run it. The vocabulary stays the server's — a hook this
   * build's runtime does not call must never appear here — and only the tick is
   * recomputed.
   */
  const hooks = (scripts?.hooks ?? []).map((hook) => ({
    ...hook,
    declared: hook.declared || declaresHook(draft.flow, hook.name),
  }));

  return (
    <div className="absolute inset-0 z-[60] flex bg-bg/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Kod">
      {/* The dim to the left is a target, not decoration: clicking away from a
          panel is how people close one, and it asks the same question Esc does. */}
      <button
        type="button"
        aria-label="Yopish"
        className="min-w-0 flex-1 cursor-default max-md:hidden"
        onClick={() => void askThenClose()}
      />
      <section
        className={cn(
          "animate-rise flex h-full w-full flex-col border-l border-neutral-800 bg-overlay/98 shadow-lg",
          phone ? "" : "max-w-[1040px]",
        )}
      >
        <header className="flex flex-none flex-wrap items-center gap-2 border-b border-neutral-800 px-3.5 py-2.5">
          <Icon name="code" size={15} className="text-accent-300" />
          <SegmentedTabs
            label="Fayl"
            options={FILES.map((entry) => ({
              value: entry.value,
              label: entry.label,
              icon: entry.icon,
              // The dot is the only way an author can see, without switching,
              // that the *other* file is the one holding unsaved work.
              dot: draft[entry.value] !== saved[entry.value],
            }))}
            value={file}
            onChange={setFile}
          />
          <span className="ml-auto flex items-center gap-2">
            {stamp ? <span className="t-footnote t-secondary hidden md:inline">{stamp}</span> : null}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canEdit || saving || !fileDirty}
              className="flex h-7 flex-none cursor-pointer items-center gap-1.5 rounded-full bg-accent-700 px-3.5 text-[12px] whitespace-nowrap text-white transition-colors hover:bg-accent-600 disabled:cursor-default disabled:bg-neutral-800 disabled:text-neutral-600"
            >
              {saving ? <Icon name="arrow-clockwise" size={12} className="animate-spin" /> : null}
              {saving ? "Saqlanmoqda…" : "Saqlash"}
            </button>
            <IconButton icon="x" label="Yopish" size={26} onClick={() => void askThenClose()} />
          </span>
        </header>

        {loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
            <p className="t-body m-0">Kodni ochib bo&apos;lmadi</p>
            <p className="t-footnote t-secondary m-0">{loadError}</p>
          </div>
        ) : !scripts ? (
          <div className="flex flex-1 items-center justify-center">
            <Icon name="arrow-clockwise" size={16} className="animate-spin text-neutral-600" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <CodeEditor
                ref={editorRef}
                value={draft[file]}
                onChange={(next) => setDraft((current) => ({ ...current, [file]: next }))}
                readOnly={!canEdit}
                problem={problem[file]}
                placeholder={file === "flow" ? FLOW_PLACEHOLDER : LIBRARY_PLACEHOLDER}
                onSave={() => void save()}
                className="min-h-0 flex-1"
              />
              <ScriptTestPanel
                source={draft[file]}
                file={file}
                botId={botId}
                hooks={hooks}
                canEdit={canEdit}
                onProblem={(next) => setProblem((current) => ({ ...current, [file]: next }))}
              />
            </div>
            {phone ? null : (
              <aside className="w-[286px] flex-none overflow-y-auto border-l border-neutral-800">
                <ScriptRail
                  file={file}
                  hooks={hooks}
                  expressions={scripts.expressions}
                  canEdit={canEdit}
                  onInsert={(text) => editorRef.current?.insert(text)}
                />
              </aside>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
