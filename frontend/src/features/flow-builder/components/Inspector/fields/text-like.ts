/**
 * The part of a text field that anything acting on a caret actually needs.
 *
 * The formatting toolbar and the variable picker were written against
 * `HTMLTextAreaElement` and use five of its three hundred members: the value,
 * where the selection is, and the two calls that move it. Naming that subset
 * is what let the textarea be replaced by a rendered editor
 * ([[RichTextArea]]) without either of them being touched — and it says, for
 * the next such swap, exactly what a replacement has to provide.
 */
export interface TextLike {
  value: string;
  /**
   * Nullable, because a real `<input>` is one of the things that satisfies this
   * — `HTMLInputElement.selectionStart` is `number | null` on the types a
   * password or number field can have no selection on. Both callers already
   * wrote `?? value.length`, so widening the shape costs nothing and keeps
   * `VariableInput`'s plain input assignable to it.
   */
  selectionStart: number | null;
  selectionEnd: number | null;
  focus(): void;
  setSelectionRange(start: number, end: number): void;
}
