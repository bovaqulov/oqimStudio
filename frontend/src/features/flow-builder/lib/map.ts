/**
 * Web Mercator ("slippy map") math for the location picker — the same
 * projection OpenStreetMap tiles and Telegram's own map use, so a point picked
 * in the editor lands where the user expects in the chat.
 *
 * Deliberately dependency-free: the picker paints raster tiles into a div
 * itself rather than pulling a map library (and its CSS bundle) into the
 * editor for one field.
 */

export interface MapPoint {
  lat: number;
  lon: number;
}

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;

/** Mercator runs to infinity at the poles — the cutoff every tile scheme uses. */
const MAX_LATITUDE = 85.05112878;

/** Six decimals is ~0.1 m: past that a coordinate is noise, not precision. */
const COORD_DECIMALS = 6;

/** Toshkent markazi — the view a block with no coordinates yet opens on. */
export const DEFAULT_CENTER: MapPoint = { lat: 41.311081, lon: 69.240562 };
export const DEFAULT_ZOOM = 13;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** Panning past the date line wraps rather than dead-ends. */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Geographic point → world pixel at this zoom (origin: top-left of the world). */
export function project(point: MapPoint, zoom: number): { x: number; y: number } {
  const size = worldSize(zoom);
  const lat = (clampLatitude(point.lat) * Math.PI) / 180;
  return {
    x: ((wrapLongitude(point.lon) + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/** World pixel → geographic point — the inverse of [[project]]. */
export function unproject(x: number, y: number, zoom: number): MapPoint {
  const size = worldSize(zoom);
  const n = Math.PI - 2 * Math.PI * (y / size);
  return {
    lat: clampLatitude((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))),
    lon: wrapLongitude((x / size) * 360 - 180),
  };
}

export function tileUrl(x: number, y: number, zoom: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/** Trailing zeros dropped — "41.3111" reads better in a field than "41.311100". */
export function formatCoordinate(value: number): string {
  return String(Number(value.toFixed(COORD_DECIMALS)));
}

/** A hand-typed coordinate, or `null` when the field is empty or not a number. Accepts the comma decimal separator. */
export function parseCoordinate(value: string | undefined): number | null {
  const text = value?.trim().replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The pair as a point — `null` unless both sides are present and in range. */
export function toPoint(latitude: string, longitude: string): MapPoint | null {
  const lat = parseCoordinate(latitude);
  const lon = parseCoordinate(longitude);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Same spot for the picker's purposes — guards the map against re-centering on its own output. */
export function samePoint(a: MapPoint | null, b: MapPoint | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}
