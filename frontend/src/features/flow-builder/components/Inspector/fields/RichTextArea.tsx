"use client";

import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, placeholder as cmPlaceholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { TextLike } from "./text-like";

/**
 * The message field, showing what the message will look like.
 *
 * An author writing `*Narx:* _190 000_` was reading asterisks and underscores —
 * the markers, never the result — and the only place the real thing appeared
 * was the preview beside it. So the markers are hidden and the text they
 * describe is drawn the way Telegram will draw it.
 *
 * Hidden, and not removed: the document is still exactly the MarkdownV2 that
 * gets sent, character for character, so nothing here has to be converted on
 * the way out and no second dialect exists to drift. What changes is only what
 * is *painted*.
 *
 * The one rule that makes this editable rather than infuriating: **a span whose
 * markers the caret is inside shows them again**. Without it there is no way to
 * delete a bold, no way to see why a word is bold, and a backspace at the edge
 * of a hidden marker deletes something invisible. With it, the markers behave
 * like every other character the moment you are working on them and get out of
 * the way the moment you are not.
 */
export type { TextLike } from "./text-like";

/**
 * Telegram's MarkdownV2, as the shapes this field paints.
 *
 * Order is load-bearing: `__` has to be tried before `_` and `||` before a bare
 * pipe, or the longer marker is read as two of the shorter one and the span
 * ends in the wrong place. The scan below takes the earliest match and then
 * skips past it, so an inner `*` inside a code span is never a second span.
 */
const SPANS: { name: string; re: RegExp; cls: string }[] = [
  { name: "code", re: /`([^`\n]+)`/g, cls: "oq-md-code" },
  { name: "spoiler", re: /\|\|([^|\n]+)\|\|/g, cls: "oq-md-spoiler" },
  { name: "underline", re: /__([^_\n]+)__/g, cls: "oq-md-underline" },
  { name: "bold", re: /\*([^*\n]+)\*/g, cls: "oq-md-bold" },
  { name: "italic", re: /(?<![_\w])_([^_\n]+)_(?![_\w])/g, cls: "oq-md-italic" },
  { name: "strike", re: /~([^~\n]+)~/g, cls: "oq-md-strike" },
];

/** A placeholder is not markup — it is a value, and it is drawn as one. */
const VARIABLE = /\{\{[^{}]*\}\}/g;

/** `[matn](https://…)` — the label is painted as a link, the target is hidden with the brackets. */
const LINK = /\[([^\]\n]+)\]\(([^)\s]*)\)/g;

const HIDDEN = Decoration.replace({});

interface Found {
  /** The whole thing, markers included. */
  from: number;
  to: number;
  /** The part that is painted. */
  innerFrom: number;
  innerTo: number;
  cls: string;
  /** Everything outside `inner` that is a marker, in document order. */
  markers: [number, number][];
}

function scan(text: string): Found[] {
  const found: Found[] = [];
  const taken: [number, number][] = [];
  const free = (from: number, to: number) => !taken.some(([a, b]) => from < b && a < to);

  const push = (item: Found) => {
    if (!free(item.from, item.to)) return;
    taken.push([item.from, item.to]);
    found.push(item);
  };

  for (const match of text.matchAll(VARIABLE)) {
    const from = match.index;
    push({ from, to: from + match[0].length, innerFrom: from, innerTo: from + match[0].length, cls: "oq-md-var", markers: [] });
  }
  for (const match of text.matchAll(LINK)) {
    const from = match.index;
    const label = match[1] ?? "";
    push({
      from,
      to: from + match[0].length,
      innerFrom: from + 1,
      innerTo: from + 1 + label.length,
      cls: "oq-md-link",
      markers: [
        [from, from + 1],
        [from + 1 + label.length, from + match[0].length],
      ],
    });
  }
  for (const span of SPANS) {
    for (const match of text.matchAll(span.re)) {
      const from = match.index;
      const body = match[1] ?? "";
      const open = match[0].indexOf(body);
      push({
        from,
        to: from + match[0].length,
        innerFrom: from + open,
        innerTo: from + open + body.length,
        cls: span.cls,
        markers: [
          [from, from + open],
          [from + open + body.length, from + match[0].length],
        ],
      });
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

function build(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const { from: selFrom, to: selTo } = view.state.selection.main;
  const builder = new RangeSetBuilder<Decoration>();

  for (const item of scan(text)) {
    // Touching counts as inside: a caret resting immediately after a closing
    // marker is somebody about to edit it, and a marker that reappears only
    // once the caret is strictly within is one that flickers past.
    const editing = selTo >= item.from && selFrom <= item.to;
    const marks: { from: number; to: number; deco: Decoration }[] = [];
    if (!editing) for (const [from, to] of item.markers) marks.push({ from, to, deco: HIDDEN });
    if (item.innerTo > item.innerFrom) {
      marks.push({ from: item.innerFrom, to: item.innerTo, deco: Decoration.mark({ class: item.cls }) });
    }
    for (const mark of marks.sort((a, b) => a.from - b.from || a.to - b.to)) {
      builder.add(mark.from, mark.to, mark.deco);
    }
  }
  return builder.finish();
}

const painter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      // Selection too, not just the document: revealing a span's markers is a
      // selection change and nothing else.
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * The field's own look, written here rather than in `globals.css`.
 *
 * CodeMirror injects its styles into the document itself, so a theme it is
 * given is scoped to this editor and cannot leak into the page — which is the
 * whole reason the classes above are safe to name so plainly.
 */
function theme(minHeight: number): Extension {
  return EditorView.theme({
    "&": {
      // CodeMirror's own base theme is monospace — it is a code editor. This is
      // a *message*, and a field that renders what the customer will read has
      // to render it in the font they will read it in, or its line breaks fall
      // in different places than the preview beside it says they will.
      fontFamily: "inherit",
      fontSize: "13px",
      color: "var(--color-text)",
      background: "var(--color-surface)",
      border: "1px solid var(--color-neutral-800)",
      borderRadius: "8px",
    },
    "&.cm-focused": { outline: "none", borderColor: "var(--color-accent-600)" },
    ".cm-content": {
      padding: "8px 10px",
      minHeight: `${minHeight}px`,
      fontFamily: "inherit",
      lineHeight: "1.5",
      /*
       * The caret, named — it was invisible until it was.
       *
       * There is no `drawSelection()` in the extensions below, so the caret
       * here is the browser's own and `caret-color` is the only thing that
       * decides its colour. CodeMirror's base theme sets that to **black**,
       * because a theme is light unless it says otherwise (the second argument
       * to `EditorView.theme`, added below), and black on `--color-surface` is
       * a caret nobody can find. `--color-text` and not the accent: this is a
       * message field, and every other input in the product blinks in the
       * colour of the text it is about to insert.
       */
      // Kept for the moment before `drawSelection` takes over, and for any
      // browser that ignores it: the native caret is the fallback, and a
      // fallback nobody can see is the bug this line was added for.
      caretColor: "var(--color-text)",
      // The pointer over the whole box, not only over the glyphs. A `div` that
      // takes typing should say so before it is clicked.
      cursor: "text",
    },
    ".cm-line": { padding: "0" },
    ".cm-placeholder": { color: "var(--color-neutral-600)" },
    // Two pixels, and the text colour. One is the browser's default width and
    // is what made the caret hard to find; the colour is the same one the
    // letters it sits between are drawn in.
    ".cm-cursor, .cm-dropCursor": {
      borderLeftWidth: "2px",
      borderLeftColor: "var(--color-text)",
    },
    // A caret that stops blinking while the field is focused is a caret the eye
    // stops finding. CodeMirror hides the cursor layer when the editor is not
    // focused, so this only ever shows on the field being typed in.
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--color-text)" },
    ".oq-md-bold": { fontWeight: "700" },
    ".oq-md-italic": { fontStyle: "italic" },
    ".oq-md-underline": { textDecoration: "underline" },
    ".oq-md-strike": { textDecoration: "line-through", opacity: "0.7" },
    ".oq-md-code": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      background: "var(--color-neutral-800)",
      borderRadius: "3px",
      padding: "0 3px",
    },
    // Telegram hides a spoiler behind a shimmer the reader taps. A field that
    // hid it too would be a field the author cannot proofread, so it is marked
    // rather than covered — the point is "this is a spoiler", not the effect.
    ".oq-md-spoiler": { background: "var(--color-neutral-700)", borderRadius: "3px", padding: "0 3px" },
    ".oq-md-link": { color: "var(--color-accent-400)", textDecoration: "underline" },
    ".oq-md-var": {
      color: "var(--color-accent-300)",
      background: "color-mix(in srgb, var(--color-accent-500) 14%, transparent)",
      borderRadius: "4px",
      padding: "0 2px",
    },
    // The selection, for the same reason as the caret: the light base theme
    // tints it for a white page, which on this surface is a highlight barely
    // distinguishable from the field itself.
    "&.cm-focused .cm-selectionBackground, ::selection": {
      background: "color-mix(in srgb, var(--color-accent-500) 34%, transparent)",
    },
  },
  // Light unless it is told. Everything the base theme picks from here on — the
  // caret, the selection, the active line — is chosen for the background this
  // field actually has.
  { dark: true });
}

export function RichTextArea({
  value,
  onChange,
  onCaret,
  onBlur,
  placeholder,
  rows = 3,
  handle,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Where the caret ended up, for the variable picker's query matcher. */
  onCaret?: (text: string, cursor: number) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  /**
   * Shaped like the textarea this replaced — `value`, `selectionStart`,
   * `focus`, `setSelectionRange`. The formatting toolbar and the variable
   * picker act on a caret, and both were written against that shape; giving
   * them the same one back is what kept this a swap rather than a rewrite.
   */
  handle?: Ref<TextLike | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read through a ref so a new closure every render does not tear down the
  // editor. Written in an effect and not during the render: a ref mutated while
  // rendering is torn by a re-render React abandons, and the rule that refuses
  // it is right — the editor would then be calling last-but-one's `onChange`.
  const latest = useRef({ onChange, onCaret, onBlur });
  useEffect(() => {
    latest.current = { onChange, onCaret, onBlur };
  }, [onChange, onCaret, onBlur]);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          painter,
          /*
           * CodeMirror draws the caret instead of the browser, and the reason
           * is width. `caret-color` can only colour the native one, and one
           * device pixel of white against a dark field is still a line the
           * author loses in the middle of their own sentence — the colour was
           * the first half of this fix and not the whole of it. A drawn caret
           * is an element, so `.cm-cursor` below can be two pixels wide.
           *
           * It draws the selection too, which is why the theme names
           * `.cm-selectionBackground`: without it the highlight would be
           * CodeMirror's default, picked for a white page.
           */
          drawSelection(),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder ?? ""),
          theme(rows * 20),
          EditorView.updateListener.of((update) => {
            const cursor = update.state.selection.main.head;
            if (update.docChanged) {
              const text = update.state.doc.toString();
              latest.current.onChange(text);
              latest.current.onCaret?.(text, cursor);
            } else if (update.selectionSet) {
              latest.current.onCaret?.(update.state.doc.toString(), cursor);
            }
          }),
          EditorView.domEventHandlers({ blur: () => latest.current.onBlur?.() }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Built once. `value` arriving from outside is handled below, and rebuilding
    // on every keystroke would take the caret with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The prop is the source of truth for anything this field did not type —
  // switching language, filling a sample, the toolbar rewriting a selection.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useImperativeHandle(
    handle,
    () => ({
      get value() {
        return view.current?.state.doc.toString() ?? "";
      },
      get selectionStart() {
        return view.current?.state.selection.main.from ?? 0;
      },
      get selectionEnd() {
        return view.current?.state.selection.main.to ?? 0;
      },
      focus() {
        view.current?.focus();
      },
      setSelectionRange(start: number, end: number) {
        const editor = view.current;
        if (!editor) return;
        const size = editor.state.doc.length;
        editor.dispatch({ selection: { anchor: Math.min(start, size), head: Math.min(end, size) } });
      },
    }),
    [],
  );

  return <div ref={host} />;
}
