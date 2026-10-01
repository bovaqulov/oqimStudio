/*
 * Geometry of the panels that float over the canvas.
 *
 * The palette and the inspector are drawn on top of the graph rather than
 * beside it, so a fit-to-view that measured the raw canvas would centre the
 * flow underneath one of them — which is how blocks end up hidden behind
 * "Bloklar". The panels and `fitView` therefore read their widths from here:
 * the numbers only mean anything as long as there is exactly one of them.
 */

/** Inset the floating panels sit at — the same on every side. */
export const PANEL_GUTTER = 14;

/** Full palette: icon, block name and its number shortcut. */
export const PALETTE_WIDTH = 196;
/** Icons only — what a collapsed palette, or a viewport too narrow for names, shows. */
export const PALETTE_RAIL_WIDTH = 52;

/** The inspector dock, and the narrower one a small viewport gets. */
export const DOCK_WIDTH = 296;
export const DOCK_NARROW_WIDTH = 272;

/** How wide the palette is drawn right now. Collapsed and narrow are the same rail. */
export function paletteWidth({ isNarrow, collapsed }: { isNarrow: boolean; collapsed: boolean }): number {
  return isNarrow || collapsed ? PALETTE_RAIL_WIDTH : PALETTE_WIDTH;
}

export function dockWidth(isNarrow: boolean): number {
  return isNarrow ? DOCK_NARROW_WIDTH : DOCK_WIDTH;
}

/** Canvas a floating panel takes away: its own width plus the gutter on either side of it. */
export function panelInset(width: number): number {
  return width + PANEL_GUTTER * 2;
}
