/**
 * Form state shared by the connect dialog and its action.
 *
 * Kept out of `actions.ts` on purpose: a `"use server"` module may only export
 * async functions, so a plain constant living there is a build-time error the
 * moment the module is imported by a client component.
 */
export interface ConnectProviderState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const CONNECT_INITIAL_STATE: ConnectProviderState = { status: "idle" };
