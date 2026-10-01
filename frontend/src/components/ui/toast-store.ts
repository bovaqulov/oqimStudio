import { create } from "zustand";

/** What a toast can offer besides the sentence — one button, one chance. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export type ToastTone = "info" | "danger";

export interface ToastOptions {
  tone?: ToastTone;
  /**
   * An offer to put it back. A toast carrying one lives much longer than a
   * plain acknowledgement: it is the only way back from a destructive click
   * for somebody who does not know Ctrl+Z exists.
   */
  action?: ToastAction;
  /** Overrides the tone's default. Milliseconds. */
  durationMs?: number;
}

interface Toast extends ToastOptions {
  message: string;
  /** Distinguishes two toasts with the same words, so the viewport re-animates. */
  id: number;
}

interface ToastState {
  toast: Toast | null;
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

/** Long enough to notice the mistake and reach the button, short enough to leave. */
const ACTION_MS = 10_000;
const PLAIN_MS = 2_000;
/*
 * A refusal has to be *read*, not merely glimpsed. Two seconds is right for
 * "saqlandi" — it is an acknowledgement of something the reader just did and
 * already expects. It is wrong for "Loyihada bot yoki oqim bor", which is a
 * sentence that changes what they do next, arrives when they were looking
 * somewhere else, and is the only place that reason is ever stated.
 */
const DANGER_MS = 6_000;

let hideTimer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;

/**
 * Single global toast slot. Any client component can call
 * `useToastStore.getState().show(msg)` without being inside a provider tree.
 */
export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, options = {}) => {
    clearTimeout(hideTimer);
    sequence += 1;
    set({ toast: { ...options, message, id: sequence } });
    const life = options.durationMs ?? (options.action ? ACTION_MS : options.tone === "danger" ? DANGER_MS : PLAIN_MS);
    hideTimer = setTimeout(() => set({ toast: null }), life);
  },
  dismiss: () => {
    clearTimeout(hideTimer);
    set({ toast: null });
  },
}));

export function showToast(message: string, options?: ToastOptions): void {
  useToastStore.getState().show(message, options);
}
