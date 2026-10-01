"use client";

import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/utils/cn";

/**
 * The switch: a 44×26 track with a 22px knob.
 *
 * iOS draws this at 51×31 and that is what it used to be here, which on a flow
 * row — an icon, two lines of text and this — made the control the largest
 * object in a row that is mostly reading. 44px on the long side is still the
 * whole hit target the guideline asks for, and the knob still carries the state
 * on its own: no label beside it, because the position of the knob is the
 * state and printing it next to itself is a tautology.
 *
 * Three details the plain version was missing, all of them about the *off*
 * state — which is the one a switch spends most of its life in:
 *
 * - **A rim.** Off, the track was `bg-neutral-800`, the same fill as the panel
 *   behind it and as half the other surfaces on the screen. A switch nobody can
 *   see the edge of does not read as a switch; it reads as a grey smudge with a
 *   dot on it. `ring-inset` rather than a border, so the rim costs no layout —
 *   a bordered 44px track is 42px of track.
 * - **A hover.** Off, nothing under the pointer changed, so there was no
 *   confirmation the thing was even interactive before committing to a click.
 * - **A press.** `oq-press` is what every other pressable thing in the app
 *   does, and the switch was the one control that stayed rigid under a finger.
 *
 * The knob moves on `transform` instead of `left`: the browser can hand a
 * transform to the compositor, and a list of twenty flows animating twenty
 * `left` values is twenty layout passes. `transition-transform` and not
 * `transition-all`, so the shadow is not re-interpolated for nothing.
 */
export function Toggle({
  checked,
  onToggle,
  disabled = false,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** For screen readers, when the row's own text is not the label. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic("light");
        onToggle();
      }}
      className={cn(
        "oq-press relative h-[26px] w-[44px] flex-none cursor-pointer rounded-full",
        "transition-colors duration-200",
        "disabled:cursor-default disabled:opacity-40",
        checked
          ? "bg-accent-700 hover:bg-accent-600 disabled:hover:bg-accent-700"
          : "bg-neutral-800 ring-1 ring-neutral-700 ring-inset hover:bg-neutral-700 disabled:hover:bg-neutral-800",
      )}
    >
      <span
        className={cn(
          // Positioned from the left edge and moved by `transform`, so the
          // resting geometry is readable in devtools as a single number.
          "absolute top-[2px] left-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-md",
          "transition-transform duration-200 ease-out",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}
