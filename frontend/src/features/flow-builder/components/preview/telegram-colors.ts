/**
 * Telegram's own Night-theme chat colors.
 *
 * The one deliberate exception to "never hardcode a hex value in a component":
 * everything that draws a *picture of Telegram* — the block preview, the test
 * chat in the editor, the flow preview in the no-code wizard — paints the real
 * client's surface, and that surface does not follow the studio's theme. A
 * light-mode chat preview would be a screenshot of a client the customer is not
 * looking at.
 *
 * Which is exactly why they live here rather than in each component: a preview
 * painted on this ground must take its *text* colors from here too. Reaching for
 * `text-neutral-100` on this background looks right in dark mode and turns into
 * dark-on-dark the moment the studio is switched to light.
 */

/** The chat wallpaper. */
export const CHAT_BG = "#0e1621";
/** Incoming (bot) bubble. */
export const BUBBLE_BG = "#182533";
/** Outgoing (user) bubble — Telegram's own selection blue. */
export const OWN_BUBBLE_BG = "#2b5278";
export const BUBBLE_TEXT = "#ffffff";
/** Timestamps, hints, service lines. */
export const META_TEXT = "#6d8ba0";
export const LINK = "#62a3e3";
/** Inline keyboard button ground. */
export const BUTTON_BG = "#1f3348";
/** Hairline used for the preview's own header and footer rules. */
export const CHAT_BORDER = "rgba(255,255,255,0.06)";

/**
 * The three colors Bot API 9.4's button `style` names — "danger" (red),
 * "success" (green), "primary" (blue) — as the Night theme paints them.
 * Everything that shows a styled button (the preview, the inspector's
 * swatches) reads them from here, so the picker can never promise a shade the
 * preview does not draw.
 */
export const BUTTON_STYLE_BG: Record<string, string> = {
  primary: "#4d9ceb",
  success: "#4fae4e",
  danger: "#e05a4f",
};
