/**
 * The single seam between the interface and its backend.
 *
 * Today every route under `/api/*` is served by this app from the in-memory
 * repositories; pointing `NEXT_PUBLIC_API_BASE_URL` at a real service is the
 * only change needed to talk to it instead — no component or hook is aware of
 * where the data came from.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Drops empty values so `?botId=` never reaches the backend as a filter. */
export function buildUrl(path: string, params?: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return `${API_BASE_URL}${path}${query ? `?${query}` : ""}`;
}

/**
 * Typed GET. Errors arrive as `ApiError` with the HTTP status, so callers can
 * tell "nothing found" from "the server is down" without parsing text.
 */
export async function apiGet<T>(path: string, params?: QueryParams, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new ApiError(message || `So'rov ${response.status} bilan yakunlandi`, response.status);
  }
  return (await response.json()) as T;
}

/** Typed POST/PATCH/DELETE with a JSON body. */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new ApiError(message || `So'rov ${response.status} bilan yakunlandi`, response.status);
  }
  return (await response.json()) as T;
}
