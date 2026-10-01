"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/lib/i18n/LocaleProvider";
import { MENU_ROW_CLASS } from "./menu-row";

export type Theme = "dark" | "light";

const STORAGE_KEY = "oqim:theme";
const listeners = new Set<() => void>();

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage off: the choice lasts for this tab only, which is still better
    // than refusing to switch.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The same store, for a control that is not this button.
 *
 * The settings screen offers the theme as a field rather than as a flip, and it
 * has to be the *same* store: two components each reading `localStorage` on
 * their own would leave the header's icon showing yesterday's state until the
 * next navigation. The server snapshot is "dark" here for the same reason it is
 * in `ThemeToggle` — the inline script in the root layout has already set the attribute by
 * the time this hydrates, and disagreeing about it is a hydration error.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark" as Theme);
  return [theme, applyTheme];
}

/**
 * Dark ⇄ light. The DOM attribute is the source of truth — the inline script in
 * the root layout sets it before first paint, so this component only reads and
 * flips it, and the server snapshot is "dark" so hydration never disagrees.
 *
 * `variant="row"` is the same control inside the phone header's "⋯" menu: on a
 * 390px screen there is no room for a fourth icon in the header, and a theme
 * switch nobody can reach is a theme switch nobody has.
 */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const t = useT();
  const [theme] = useTheme();
  const icon = theme === "light" ? "moon" : "sun";
  const label = theme === "light" ? t.chrome.toDarkTheme : t.chrome.toLightTheme;
  const flip = () => applyTheme(theme === "light" ? "dark" : "light");

  if (variant === "row") {
    return (
      <button type="button" onClick={flip} className={MENU_ROW_CLASS}>
        <Icon name={icon} size={17} className="flex-none text-neutral-500" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  return <IconButton icon={icon} label={label} tooltip tooltipAlign="end" className="oq-tap relative" onClick={flip} />;
}
