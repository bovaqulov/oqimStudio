/**
 * Form state shared by the connect form and its action.
 *
 * Kept out of `actions.ts` on purpose: a `"use server"` module may only export
 * async functions, so a plain constant living there is a build-time error the
 * moment the module is imported by a client component.
 *
 * There is no success state — a connected bot redirects to its own page, and a
 * state nothing ever renders would be a lie about what can happen.
 */
export interface ConnectBotState {
  status: "idle" | "error";
  message?: string;
  /**
   * The token this answer is about.
   *
   * Returned by the action rather than remembered by the form: the form used to
   * keep its own copy and show the message only while the two matched, which
   * meant any drift between them swallowed the error entirely — a failed
   * connect that says nothing at all is the worst outcome this form has.
   */
  token?: string;
}

export const CONNECT_BOT_INITIAL_STATE: ConnectBotState = { status: "idle" };

/**
 * The answer the settings form gets back.
 *
 * This one *does* have a success state, unlike the connect form: saving
 * settings leaves the reader on the same page with the same values on screen,
 * so without a word from the action nothing at all happens when "Saqlash" is
 * pressed — which reads as a button that does not work.
 */
export interface BotSettingsState {
  status: "idle" | "saved" | "error";
  message?: string;
  /**
   * When the save landed. The form re-reads its own baseline from this — two
   * identical saves are two events, and a state that cannot tell them apart
   * would leave the second one's "O'zgarishlar bor" bar on screen.
   */
  savedAt?: number;
}

export const BOT_SETTINGS_INITIAL_STATE: BotSettingsState = { status: "idle" };

/**
 * The answer the script library editor gets back.
 *
 * The same three fields as `BotSettingsState` and deliberately not shared with
 * it: a state type is part of an action's signature, so one type across both
 * would mean every state either form grows lands in the other's `useActionState`
 * — two unrelated forms held together by the fact that they both say "saqlandi".
 */
export interface ScriptLibraryState {
  status: "idle" | "saved" | "error";
  message?: string;
  /** Same job as the settings form's: the editor re-reads its baseline from it. */
  savedAt?: number;
}

export const SCRIPT_LIBRARY_INITIAL_STATE: ScriptLibraryState = { status: "idle" };
