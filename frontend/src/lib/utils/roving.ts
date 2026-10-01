import type { KeyboardEvent } from "react";

/**
 * Arrow-key movement inside a group of related controls — a chip row, a day
 * picker, a segmented control.
 *
 * Tab reaches the group; the arrows move *between* the options inside it, which
 * is what `role="group"` / `role="radiogroup"` already promises a screen-reader
 * user and what anyone driving the panel from the keyboard will try first.
 *
 * Members opt in with `data-roving` rather than being found by tag: a group
 * often holds a "Hammasi" reset or a preset button that belongs to the section
 * rather than to the choice.
 */
export function moveRovingFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;

  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-roving]"));
  if (items.length < 2) return;

  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;

  event.preventDefault();
  items[rovingTarget(event.key, current, items.length)]?.focus();
}

/** Where a given arrow lands, wrapping at both ends — a wrapped chip row has no meaningful last edge. */
export function rovingTarget(key: string, current: number, length: number): number {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  return (current + step + length) % length;
}
