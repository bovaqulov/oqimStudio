import { useRef, useState } from "react";
import { getActiveVariableQuery, insertVariable, type VariableQuery } from "../../../lib/variables";
import type { TextLike } from "./text-like";

/**
 * Drives the variable popover shared by VariableInput/VariableTextarea — tracks
 * the open query, whether it was opened with `@` or with `{{`, and does the
 * insertion.
 *
 * **It opens when it is asked for, and never on its own.** Typing `{{` used to
 * be enough, which meant a list of every variable in the product — the answers
 * collected so far, the chat, the message, Business, Web App — dropped over the
 * field of somebody who was writing a sentence that happens to contain braces.
 * The groups it offered were mostly from modules the flow is not even in. So
 * the keystroke no longer opens it; the «O'zgaruvchi» button does, and that
 * button is right above the field.
 *
 * `armed` is what draws the line. Once open, `sync` keeps tracking the caret so
 * the list narrows as the author types and closes itself when the caret leaves
 * the placeholder — the behaviour that made the popover worth having, kept for
 * the case where somebody asked for it.
 */
export function useVariableAutocomplete(onChange: (value: string) => void) {
  const [query, setQuery] = useState<VariableQuery | null>(null);
  /*
   * A ref and not state, and the difference is not a preference.
   *
   * `arm()` is called by the button and `sync()` a moment later by
   * `openVariableQuery`, inside the same tick — and `sync` is the closure from
   * the render that is still on screen. Through `useState` that closure reads
   * the old `false`, so the button armed nothing and the picker never opened;
   * the first version of this shipped exactly that way. A ref is read when it
   * is read. Nothing here needs to re-render on the change either — `query` is
   * what the popover draws from.
   */
  const armed = useRef(false);

  /**
   * The text is read off the element rather than off the `value` prop: `sync`
   * runs inside the same keystroke that changed it, and the prop still holds
   * what was on screen a render ago.
   */
  function sync(text: string, cursor: number) {
    if (!armed.current) return;
    const next = getActiveVariableQuery(text, cursor);
    setQuery(next);
    // The caret has left the placeholder — the ask is over, and the next `{{`
    // typed by hand must not reopen it.
    if (!next) armed.current = false;
  }

  /**
   * The button: open the list at the caret, having inserted nothing.
   *
   * It used to type an `@` and let the query matcher notice it. That worked in
   * a plain `<input>` and not in the rich text field, where the value round
   * trips through CodeMirror: the insertion replaced the document, the document
   * replacement moved the caret, the caret fired `sync` again, and `sync` —
   * looking at a caret that was no longer beside the `@` — closed the popover
   * a frame after it opened. Which is why the button did nothing there long
   * before this file grew a gate, and why typing `{{` was the only way in.
   *
   * Naming the query outright removes the round trip. `start === cursor` is an
   * empty range, so the insertion `select` performs lands exactly at the caret
   * and nothing was typed on the author's behalf to get there.
   */
  function openAt(el: TextLike | null) {
    if (!el) return;
    const cursor = el.selectionStart ?? el.value.length;
    armed.current = true;
    setQuery({ kind: "at", text: "", start: cursor });
    el.focus();
  }

  function select(path: string, el: TextLike | null) {
    if (!query || !el) return;
    const cursor = el.selectionStart ?? el.value.length;
    const { next, caret } = insertVariable(el.value, cursor, path, query);
    onChange(next);
    setQuery(null);
    armed.current = false;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  return {
    query,
    sync,
    openAt,
    select,
    close: () => {
      setQuery(null);
      armed.current = false;
    },
  };
}
