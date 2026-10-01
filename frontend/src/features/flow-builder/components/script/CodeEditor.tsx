"use client";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import type { CodeEditorHandle, CodeProblem } from "./types";

/**
 * The JavaScript editor in the Script panel.
 *
 * It replaced a `<textarea>`, and the reason is the whole design brief: a
 * missing brace lived in one for five days. A textarea can show you the
 * characters and nothing else — no line number to match the one the backend
 * reports, no colour to tell a string from the code that was supposed to
 * follow it, and no way to draw *here* under the line that failed. Everything
 * below exists to make a fault visible at the place it happened.
 *
 * What it deliberately does not do is judge the code. There is no linter in
 * this file: the real check compiles the module in a process on the server,
 * and a second opinion in the browser that disagreed with it would be worse
 * than none. The `problem` prop is that server's answer, and this component's
 * only job with it is to point at the right line.
 */

/**
 * The syntax palette, out of the tokens the app already has.
 *
 * `globals.css` gives four hues and a stack of neutral inks, and red is spoken
 * for: it is the fault underline, the special-character box and nothing else,
 * so a wrong colour can never read as a wrong line. That leaves blue, green
 * and orange for syntax, which is enough — the arrangement is the familiar one
 * (blue keywords, green strings, orange numbers) so an author who has seen any
 * other editor already knows how to read it.
 */
const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.comment, color: "var(--color-neutral-600)", fontStyle: "italic" },
  // `keyword` is the parent of `controlKeyword`, `definitionKeyword`, `self`,
  // `null`, `bool` and `atom` in Lezer's tag tree, so this one line colours all
  // of them — and `true` reading like `return` is what every editor does.
  { tag: tags.keyword, color: "var(--color-accent-400)" },
  { tag: [tags.string, tags.regexp, tags.escape], color: "var(--color-success-fg)" },
  { tag: tags.number, color: "var(--color-warning-fg)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))],
    color: "var(--color-accent-200)",
  },
  { tag: [tags.className, tags.typeName, tags.namespace], color: "var(--color-warning-fg)" },
  { tag: tags.propertyName, color: "var(--color-neutral-200)" },
  { tag: [tags.operator, tags.punctuation, tags.derefOperator], color: "var(--color-neutral-500)" },
  { tag: tags.invalid, color: "var(--color-danger-fg)" },
]);

/**
 * The editor's own look.
 *
 * CodeMirror injects a theme into the document scoped to its own generated
 * class, so none of these selectors can reach the rest of the page — which is
 * why overriding `.cm-lintRange` and friends here is safe rather than a landmine
 * for the next panel that lints something.
 *
 * The overrides that are not decoration: the lint package ships a squiggle
 * drawn as an `#f11` SVG and a `#d11` gutter dot, both hardcoded, and the app
 * has a token for exactly that colour. `underline wavy` gets the same shape out
 * of the browser and takes `var(--color-danger-fg)` while it is there.
 */
const THEME = EditorView.theme(
  {
    "&": {
      height: "100%",
      background: "transparent",
      color: "var(--color-neutral-100)",
      fontSize: "12px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      // The one place the app's font is wrong: a script is read column by
      // column, and the tooltips below put `--font-sans` back for prose.
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      lineHeight: "1.6",
    },
    ".cm-content": { padding: "10px 0", caretColor: "var(--color-accent-400)" },
    ".cm-line": { padding: "0 12px 0 8px" },
    ".cm-placeholder": { color: "var(--color-neutral-600)" },
    ".cm-gutters": {
      background: "transparent",
      color: "var(--color-neutral-600)",
      border: "none",
      borderRight: "1px solid var(--color-separator)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "2ch" },
    ".cm-activeLineGutter": { background: "transparent", color: "var(--color-neutral-300)" },
    ".cm-activeLine": { background: "var(--color-neutral-900)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      background: "var(--color-accent-800)",
      color: "inherit",
      outline: "1px solid var(--color-accent-600)",
    },
    ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": { color: "var(--color-danger-fg)" },
    // A no-break space is a syntax error you cannot see — it looks exactly like
    // the space beside it and the compiler says `Invalid or unexpected token`
    // about a line that reads perfectly. Boxed, it is the first thing you spot.
    ".cm-specialChar": {
      color: "var(--color-danger-fg)",
      background: "var(--color-danger-bg)",
      borderRadius: "2px",
    },
    ".cm-lintRange.cm-lintRange-error": {
      backgroundImage: "none",
      paddingBottom: "0",
      textDecoration: "underline wavy var(--color-danger-fg)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
    // The zero-width case: the fault is on a blank line, so there is no text to
    // underline and lint draws a caret-sized wedge instead.
    ".cm-lintPoint-error::after": { borderBottomColor: "var(--color-danger-fg)" },
    ".cm-gutter-lint": { width: "1em" },
    ".cm-tooltip": {
      background: "var(--color-overlay)",
      border: "1px solid var(--color-neutral-800)",
      borderRadius: "var(--radius-sm)",
      color: "var(--color-neutral-100)",
      fontFamily: "var(--font-sans)",
      fontSize: "11.5px",
      boxShadow: "var(--shadow-lg)",
    },
    ".cm-tooltip .cm-diagnostic": {
      padding: "6px 9px",
      borderLeft: "none",
      lineHeight: "1.5",
    },
    ".cm-tooltip .cm-diagnostic-error": { borderLeft: "none" },
  },
  // Tells CodeMirror's own base theme which half of its `&dark` / `&light`
  // rules to use — the selection background comes from there, not from here.
  { dark: true },
);

export interface CodeEditorProps {
  value: string;
  onChange(next: string): void;
  /** A viewer with read-only rights: the text is selectable and copyable, never editable. */
  readOnly?: boolean;
  /** Underlined where it is; null clears it. `line` is 1-based in THIS text. */
  problem?: CodeProblem | null;
  /** Shown on an empty document. */
  placeholder?: string;
  /** Cmd/Ctrl+S from inside the editor. The panel saves; you only call it. */
  onSave?(): void;
  /**
   * On the wrapper. The editor fills its wrapper's height, so the height comes
   * from here — `h-full` in a fixed-height parent, `flex-1 min-h-0` in a column.
   * With none it grows with the document.
   */
  className?: string;
}

/**
 * The fault, as the one diagnostic lint will draw.
 *
 * Every way of not having a line ends here in the same empty list: no message,
 * no line, a line the panel computed from a stale document, a line that is not
 * a whole number. A syntax error is caught while the module compiles — before
 * any frame of the author's code exists — so `line: null` is a normal answer
 * and not a bug to paper over by guessing at line 1.
 */
function diagnosticsFor(state: EditorState, line: number | null, message: string | null): Diagnostic[] {
  if (!message || line === null || !Number.isFinite(line)) return [];
  const clamped = Math.min(Math.max(Math.trunc(line), 1), state.doc.lines);
  const at = state.doc.line(clamped);
  return [{ from: at.from, to: at.to, severity: "error", message }];
}

/**
 * Draws the fault, and goes to it.
 *
 * The underline was only ever half of the job. `setDiagnostics` marks the line
 * wherever it is, which on the file this editor was written for — a bot library
 * a thousand lines long — is usually a screen or ten away from whatever the
 * author is looking at. What they see is a message naming a number and an
 * editor that did not move: the mark is drawn correctly, in a place nobody is
 * looking, and the reader is left scrolling for line 986 by hand. Being on
 * screen matters as much as being red.
 *
 * Two dispatches rather than one because `setDiagnostics` builds its own
 * transaction and there is nowhere inside it to hang a scroll effect. They land
 * in the same frame, so the mark and the scroll arrive together.
 *
 * Clearing scrolls nowhere, deliberately: `[]` means the fault is gone, and an
 * editor that jumped somewhere on its own the moment a file checked clean would
 * be taking the reader away from the line they had just fixed.
 */
function showProblem(view: EditorView, line: number | null, message: string | null) {
  const found = diagnosticsFor(view.state, line, message);
  view.dispatch(setDiagnostics(view.state, found));
  const at = found[0];
  if (!at) return;
  // Centred rather than nearest: a fault is usually explained by the lines
  // above it — an unclosed brace, a missing comma — and one pinned to the
  // bottom edge of the box hides every one of them.
  view.dispatch({ effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, readOnly = false, problem = null, placeholder, onSave, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  /** Everything the effects below reconfigure, built once by the mount effect. */
  const parts = useRef<{ view: EditorView; mode: Compartment; placeholder: Compartment } | null>(null);

  const line = problem?.line ?? null;
  const message = problem?.message ?? null;

  // Read through a ref so a new closure every render does not tear down the
  // editor. Written in an effect and not during the render: a ref mutated while
  // rendering is torn by a re-render React abandons, and the editor would then
  // be calling last-but-one's `onChange`. Declared first on purpose — effects
  // run in source order, so everything below sees this commit's props.
  const latest = useRef({ onChange, onSave, line, message });
  useEffect(() => {
    latest.current = { onChange, onSave, line, message };
  }, [onChange, onSave, line, message]);

  /**
   * True only while we are pushing a value that came from outside.
   *
   * The document replacement below fires the update listener like any other
   * change, and reporting it would hand the panel back the very string it just
   * gave us. That is not merely redundant: the panel tracks dirtiness by
   * comparing draft to saved, and an echo arriving as the author switches files
   * is a write into whichever file is open by the time it lands.
   */
  const echoing = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const mode = new Compartment();
    const placeholderSlot = new Compartment();

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          // The default set is control characters; a no-break space is the one
          // that actually reaches this field, pasted out of a chat or a doc.
          highlightSpecialChars({ addSpecialChars: /\u00a0/ }),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          javascript(),
          syntaxHighlighting(HIGHLIGHT),
          // Reserves its width with a spacer, so the dot appearing does not
          // shift the code sideways. It carries the message on hover, which is
          // the second place the author can read it without leaving the line.
          lintGutter(),
          EditorState.tabSize.of(2),
          indentUnit.of("  "),
          // Against the grain for code, and deliberate: this panel is a column
          // beside the canvas, and a fault at column 90 of a line that ran off
          // the right edge would be underlined somewhere the reader cannot see.
          // Not seeing it is the bug this editor was written for.
          EditorView.lineWrapping,
          THEME,
          mode.of(editing(readOnly)),
          placeholderSlot.of(cmPlaceholder(placeholder ?? "")),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          // Above everything, including the browser: Ctrl+S inside a code
          // editor is never a request to save the web page, so it is swallowed
          // whether or not the panel gave us somewhere to send it.
          Prec.highest(
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  latest.current.onSave?.();
                  return true;
                },
              },
            ]),
          ),
          EditorView.contentAttributes.of({ "aria-label": "Skript muharriri", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || echoing.current) return;
            latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });

    parts.current = { view: editor, mode, placeholder: placeholderSlot };
    return () => {
      editor.destroy();
      parts.current = null;
    };
    // Built once. `value`, `readOnly` and `placeholder` arriving from outside
    // are each handled below; rebuilding on a keystroke would take the caret,
    // the undo history and the scroll position with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The prop is the source of truth for anything this editor did not type — the
  // panel switching between the flow's script and the library, or a save
  // answering with the text the server stored. The comparison is what keeps a
  // value that arrived *because* the author typed it from resetting the caret:
  // the document already holds it, so there is nothing to do.
  useEffect(() => {
    const parted = parts.current;
    if (!parted) return;
    const current = parted.view.state.doc.toString();
    if (current === value) return;
    echoing.current = true;
    try {
      parted.view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    } finally {
      echoing.current = false;
    }
    // The diagnostic is anchored at a line number *in this text*, and mapping
    // its range through a whole-document replacement lands it nowhere in
    // particular. Re-anchored against the new document, from the ref, so a file
    // switch does not depend on `problem` changing in the same commit.
    showProblem(parted.view, latest.current.line, latest.current.message);
  }, [value]);

  useEffect(() => {
    const parted = parts.current;
    if (!parted) return;
    showProblem(parted.view, line, message);
  }, [line, message]);

  // The bug not to repeat from `RichTextArea`: it reads `placeholder` and
  // `rows` in its setup effect only, so both are frozen at whatever they were
  // when the field mounted. Here the panel's hint changes with the open file.
  useEffect(() => {
    const parted = parts.current;
    if (!parted) return;
    parted.view.dispatch({ effects: parted.placeholder.reconfigure(cmPlaceholder(placeholder ?? "")) });
  }, [placeholder]);

  useEffect(() => {
    const parted = parts.current;
    if (!parted) return;
    parted.view.dispatch({ effects: parted.mode.reconfigure(editing(readOnly)) });
  }, [readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      insert(text: string) {
        const parted = parts.current;
        // `readOnly` is a facet the view enforces against *input*; a dispatch
        // from here would go straight through it. A viewer who may not edit may
        // not be handed an edit by a button either, so the guard is here too —
        // and it reads the same state the compartment set, so the two cannot
        // drift apart.
        if (!parted || parted.view.state.readOnly) return;
        parted.view.dispatch(parted.view.state.replaceSelection(text), { scrollIntoView: true });
        parted.view.focus();
      },
      focus() {
        parts.current?.view.focus();
      },
    }),
    [],
  );

  return <div ref={host} className={cn("min-h-0 bg-neutral-900", className)} />;
});

/**
 * Editable and read-only as one swap.
 *
 * `EditorState.readOnly` is what actually refuses a keystroke, a paste and a
 * drop; `EditorView.editable` takes the `contenteditable` off the DOM so the
 * browser refuses first and no caret invites an edit that will not happen —
 * plain text in a non-editable element is still selected and copied normally,
 * which is the whole point of the read-only case.
 *
 * The active-line highlight rides along because it belongs to editing: with no
 * caret to follow it just marks line one for a reader who put it nowhere.
 */
function editing(readOnly: boolean): Extension {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [highlightActiveLine(), highlightActiveLineGutter()];
}
