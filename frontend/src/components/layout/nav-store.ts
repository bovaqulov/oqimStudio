import { create } from "zustand";

/**
 * Where the rail's answer is kept between visits. Read in two places: here,
 * and by the inline script in the root layout that stamps `data-rail` on
 * <html> before the first paint.
 */
const RAIL_STORAGE_KEY = "oqim:rail";

interface NavState {
  /** The tablet drawer. The sidebar is off-canvas between 768 and 1023px until it is asked for. */
  drawer: boolean;
  /** The phone "Yana" sheet — everything the four tabs do not carry. */
  sheet: boolean;
  /** The desktop sidebar, narrowed to a column of icons. Remembered per browser. */
  rail: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  openSheet: () => void;
  closeSheet: () => void;
  toggleRail: () => void;
  /** For a row whose own job is impossible in the rail — a section with children to show. */
  expandRail: () => void;
}

/**
 * The rail lives in the DOM as well as in the store: `globals.css` draws the
 * collapsed column off `<html data-rail>`, which is why no component carries a
 * `rail ? … : …` of its own. Writing both from one place is what keeps the two
 * from drifting.
 */
function applyRail(rail: boolean): void {
  document.documentElement.dataset.rail = rail ? "1" : "0";
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, rail ? "1" : "0");
  } catch {
    // Storage off: the choice lasts for this tab, which still beats refusing
    // to collapse.
  }
}

/**
 * Global, because the two halves sit in different subtrees: the button that
 * opens the drawer is in the page header, the drawer itself is in the app
 * shell, and neither is an ancestor of the other.
 */
export const useNavStore = create<NavState>((set) => ({
  drawer: false,
  sheet: false,
  rail: false,
  openDrawer: () => set({ drawer: true }),
  closeDrawer: () => set({ drawer: false }),
  openSheet: () => set({ sheet: true }),
  closeSheet: () => set({ sheet: false }),
  toggleRail: () =>
    set((state) => {
      const rail = !state.rail;
      applyRail(rail);
      return { rail };
    }),
  expandRail: () => {
    applyRail(false);
    set({ rail: false });
  },
}));

/*
 * The stored answer is applied after the store is built, never inside the
 * initialiser.
 *
 * zustand hands React `getInitialState()` as the *server* snapshot, so a value
 * read from the browser inside `create` is also the value hydration is checked
 * against — and a reader who had collapsed the sidebar would be hydrating that
 * against markup the server rendered expanded. Set from out here, the initial
 * state still says what the server said and the correction lands in the render
 * straight after hydration. Nothing moves on screen either way: the inline
 * script narrowed the column before React was loaded.
 *
 * The attribute rather than localStorage, because the script has already
 * turned one into the other and a second reader of the key is a second thing
 * to keep in step.
 */
if (typeof document !== "undefined" && document.documentElement.dataset.rail === "1") {
  useNavStore.setState({ rail: true });
}
