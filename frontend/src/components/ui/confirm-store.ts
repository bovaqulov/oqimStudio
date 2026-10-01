import { create } from "zustand";

/** What the dialog is asking, and how the answer gets back to the caller. */
export interface ConfirmRequest {
  title?: string;
  message: string;
  /** The label on the button that goes ahead; "Bekor qilish" is always the other one. */
  confirmText: string;
  /** Drawn red, and never the one focus starts on. */
  destructive: boolean;
  /** Distinguishes two identical questions, so the dialog re-animates. */
  id: number;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  ask: (params: Omit<ConfirmRequest, "id">) => Promise<boolean>;
  answer: (value: boolean) => void;
}

let sequence = 0;
let pending: ((value: boolean) => void) | null = null;

/**
 * The application's own confirmation, as a promise.
 *
 * It exists because `window.confirm` could not be relied on to appear. A browser
 * is allowed to suppress it — a second dialog from the same page, a tab that is
 * not in front, a sandboxed frame, a "prevent this page from creating
 * additional dialogs" box the reader ticked an hour ago — and when it does, the
 * call still returns, so the code carries on as though somebody had answered.
 * That is how a project delete ran with nobody having been asked anything.
 *
 * Inside Telegram this is not used: the client draws its own popup over the
 * whole app, which is better than anything a page can do, and `confirmDestructive`
 * still reaches for that first.
 */
export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  ask: (params) =>
    new Promise<boolean>((resolve) => {
      // A second question while one is open answers the first with "no": the
      // reader never saw it, and "no" is the answer that changes nothing.
      pending?.(false);
      pending = resolve;
      sequence += 1;
      set({ request: { ...params, id: sequence } });
    }),
  answer: (value) => {
    const resolve = pending;
    pending = null;
    set({ request: null });
    resolve?.(value);
  },
}));

export function askConfirm(params: Omit<ConfirmRequest, "id">): Promise<boolean> {
  return useConfirmStore.getState().ask(params);
}
