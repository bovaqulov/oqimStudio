import type { MapPoint } from "./map";

/** Shorter than this matches half the planet — not worth a request. */
export const GEOCODE_MIN_QUERY = 3;

export interface GeocodePlace {
  id: string;
  /** Short name for the first line — "Amir Temur xiyoboni". */
  name: string;
  /** Full comma-separated address, and what fills the venue's address field. */
  label: string;
  point: MapPoint;
}

interface GeocodeResponse {
  results: GeocodePlace[];
}

/**
 * Both directions of the lookup go through this app's own `/api/geocode`
 * rather than the browser calling Nominatim: see the route handler for why.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodePlace[]> {
  return request(`/api/geocode?q=${encodeURIComponent(query)}`, signal);
}

/** The place at a coordinate — used to name a spot the browser just located. */
export async function reverseGeocode(point: MapPoint, signal?: AbortSignal): Promise<GeocodePlace | null> {
  const results = await request(`/api/geocode?lat=${point.lat}&lon=${point.lon}`, signal);
  return results[0] ?? null;
}

async function request(url: string, signal?: AbortSignal): Promise<GeocodePlace[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Geocode request failed: ${response.status}`);
  const data = (await response.json()) as GeocodeResponse;
  return data.results;
}
