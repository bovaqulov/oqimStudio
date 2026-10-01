import { create } from "zustand";

interface CommandPaletteState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

/** Global — the ⌘K shortcut and the sidebar search field open the same palette. */
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
