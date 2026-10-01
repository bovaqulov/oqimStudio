"use client";

import { Select } from "@/components/ui/Select";
import { useTheme } from "@/components/layout/ThemeToggle";

/**
 * Dark or light, on the settings screen.
 *
 * The control existed — it is the sun/moon in the page header, and a row inside
 * the phone's "⋯" — and neither of those is where somebody goes looking for it.
 * A switch whose only home is an unlabelled icon is a switch most readers never
 * find, which is the whole shape of what this audit was for.
 *
 * The same store as that button (`useTheme`), not a second reader of the same
 * `localStorage` key: two independent readers would leave the header's icon
 * showing the old state until the next navigation.
 *
 * Applied on change, like `InterfaceLocaleSelect` above it — how the screen
 * looks is not a change anybody confirms, and the result is visible the instant
 * it lands. It is also the one setting on this page that never reaches the
 * server: it belongs to this browser, so it survives a reload here and does not
 * follow the reader to their phone.
 */
export function AppearanceSelect({ labels }: { labels: { dark: string; light: string } }) {
  const [theme, setTheme] = useTheme();

  return (
    <Select
      // No `name`: nothing here is posted with a form.
      aria-label="Ko'rinish"
      value={theme}
      onChange={(event) => setTheme(event.target.value === "light" ? "light" : "dark")}
    >
      <option value="dark">{labels.dark}</option>
      <option value="light">{labels.light}</option>
    </Select>
  );
}
