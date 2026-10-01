/**
 * What `createProjectAction` hands back to the form.
 *
 * Kept out of `actions.ts` because that file is `"use server"`, and such a
 * module may export nothing but async functions — a plain constant next to
 * them breaks the whole route at import time.
 */
export interface NewProjectState {
  error: string | null;
  /** Which input the message belongs under. */
  field?: "name" | "description";
}

export const NEW_PROJECT_IDLE: NewProjectState = { error: null };
