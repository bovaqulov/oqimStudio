"use client";

import { create } from "zustand";

/**
 * Whether Telegram's own MainButton is currently on screen.
 *
 * It exists so the bottom dock can get out of its way. The client draws
 * MainButton over the bottom of the webview and does not subtract it from
 * `viewportStableHeight`, so there is no layout answer available: a bar welded
 * to the bottom edge merely got covered, but a capsule floating 12px up gets
 * *sliced*, and its lower half stops taking taps. The client's button cannot be
 * moved, so the dock is the thing that yields — which is also what the Telegram
 * client does with its own tab bar.
 *
 * Set only when the app is really inside a Telegram client. In an ordinary
 * browser the stand-in bar is positioned above the dock by construction
 * (`.oq-actionbar` sits at `--oq-tabbar`), so there is nothing to hide, and
 * hiding it would take navigation away for no reason.
 */
interface MainButtonState {
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export const useMainButtonStore = create<MainButtonState>((set) => ({
  visible: false,
  setVisible: (visible) => set({ visible }),
}));
