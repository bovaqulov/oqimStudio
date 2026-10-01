import { create } from "zustand";
import type { BlueprintStep } from "./types";

/** What the flow studio has open. `null` is the module page as it normally sits. */
export type StudioMode = null | "chooser" | "gallery" | "wizard";

export interface WizardSeed {
  name: string;
  templateKey: string;
  trigger: BlueprintStep;
  actions: BlueprintStep[];
}

interface FlowStudioState {
  mode: StudioMode;
  /** A template's own answers, when the wizard was opened to adjust one. */
  seed: WizardSeed | null;
  openChooser: () => void;
  openGallery: () => void;
  openWizard: (seed?: WizardSeed) => void;
  close: () => void;
}

/**
 * Global, for the same reason the help dialog is: the "Yangi oqim" button in the
 * header, the CTA inside the empty state and the "Shablonlardan boshlash" link in
 * a hint all open the same three dialogs, and threading callbacks from the page
 * through every one of them would make each of those buttons a prop drilling
 * problem instead of a button.
 */
export const useFlowStudioStore = create<FlowStudioState>((set) => ({
  mode: null,
  seed: null,
  openChooser: () => set({ mode: "chooser", seed: null }),
  openGallery: () => set({ mode: "gallery", seed: null }),
  // A seed always arrives with its own mode switch, so opening the wizard from a
  // gallery card cannot leave the previous template's answers behind.
  openWizard: (seed) => set({ mode: "wizard", seed: seed ?? null }),
  close: () => set({ mode: null, seed: null }),
}));
