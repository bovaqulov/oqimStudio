import { create } from "zustand";

interface HelpDialogState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

/** Global — the "?" shortcut and the header button must control the same instance from anywhere in the tree. */
export const useHelpDialogStore = create<HelpDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
