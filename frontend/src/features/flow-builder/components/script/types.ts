/**
 * The contract between the pieces of the Script panel.
 *
 * Here rather than in each component because four files share it and three of
 * them are only ever rendered by the fourth: a prop shape agreed in a shared
 * module is a prop shape the compiler checks, and the panel was assembled from
 * parts written at the same time by different hands.
 */

/** Which of the two files the author has open. */
export type ScriptFileKey = "flow" | "library";

/**
 * A fault to draw under a line.
 *
 * `line` is 1-based **in the file on screen** — never in the library and the
 * file joined together, which is what the backend reports and what
 * `engine/script/compose.py::locate` exists to translate. `null` means there is
 * a message but nowhere to put it: a syntax error is caught while the module
 * compiles, before any frame of the author's code exists.
 */
export interface CodeProblem {
  line: number | null;
  message: string;
}

/** What the panel can ask of the editor without owning its state. */
export interface CodeEditorHandle {
  /** Puts `text` where the caret is and focuses. Replaces a selection. */
  insert(text: string): void;
  focus(): void;
}
