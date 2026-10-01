import { NextResponse } from "next/server";
import { GEOCODE_MIN_QUERY, type GeocodePlace } from "@/features/flow-builder/lib/geocode";

/**
 * Place lookup for the flow editor's location picker — `?q=` searches by
 * name, `?lat=&lon=` names a coordinate.
 *
 * It is proxied through the app instead of called from the browser because
 * Nominatim's usage policy asks for one identifiable client per application
 * (the `User-Agent` below) and caps the request rate — neither of which a
 * page full of typing users can promise on its own. Responses are cached for
 * a day: place names do not move, and the cache is what keeps a re-typed
 * query off the upstream service entirely.
 */

const SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
/** Nominatim rejects requests without a real contact — this identifies the app. */
const USER_AGENT = "OqimStudio/0.1 (Telegram bot flow editor)";
const RESULT_LIMIT = 6;
const CACHE_SECONDS = 86_400;

interface NominatimPlace {
  place_id?: number;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const lat = params.get("lat");
  const lon = params.get("lon");

  const url = lat && lon ? reverseUrl(lat, lon) : searchUrl(query);
  if (!url) return NextResponse.json({ results: [] });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "uz,ru,en" },
      next: { revalidate: CACHE_SECONDS },
    });
    if (!response.ok) {
      return NextResponse.json({ results: [], error: "upstream" }, { status: 502 });
    }
    const payload = (await response.json()) as NominatimPlace | NominatimPlace[];
    const places = Array.isArray(payload) ? payload : [payload];
    return NextResponse.json({ results: places.map(toPlace).filter(isPlace) });
  } catch {
    // Offline, DNS, timeout — the picker still works by hand, so this is not fatal.
    return NextResponse.json({ results: [], error: "unreachable" }, { status: 502 });
  }
}

function searchUrl(query: string): URL | null {
  if (query.length < GEOCODE_MIN_QUERY) return null;
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  return url;
}

function reverseUrl(lat: string, lon: string): URL | null {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const url = new URL(REVERSE_ENDPOINT);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "18");
  return url;
}

function toPlace(place: NominatimPlace): GeocodePlace | null {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const label = place.display_name ?? "";
  // Addresses come back with an empty `name`; their first segment is the closest thing to one.
  const name = place.name?.trim() || label.split(",")[0]?.trim() || `${lat}, ${lon}`;
  return {
    id: String(place.place_id ?? place.osm_id ?? `${lat},${lon}`),
    name,
    label,
    point: { lat, lon },
  };
}

function isPlace(place: GeocodePlace | null): place is GeocodePlace {
  return place !== null;
}
