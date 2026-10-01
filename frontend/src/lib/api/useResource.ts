"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, type QueryParams } from "./client";

export interface ResourceState<T> {
  data: T | null;
  /** True while a request is in flight. `data` keeps the previous result meanwhile. */
  loading: boolean;
  /** Message ready to be shown to the user; `null` when the last request succeeded. */
  error: string | null;
  reload: () => void;
}

export interface UseResourceOptions<T> {
  /** Server-rendered first result, so the first paint needs no request and shows no spinner. */
  initialData?: T;
  /** Skips fetching entirely while false — for panels behind a closed disclosure. */
  enabled?: boolean;
}

/**
 * The app's read-side data hook. One place owns loading, error, cancellation
 * and refetching, so every screen reports those three states the same way and
 * a real backend needs no per-component changes.
 *
 * Requests are keyed by URL: a filter change cancels the in-flight request and
 * only the newest response is allowed to land, which is what keeps a fast
 * click-through from painting stale numbers.
 */
export function useResource<T>(
  path: string,
  params?: QueryParams,
  options: UseResourceOptions<T> = {},
): ResourceState<T> {
  const { initialData, enabled = true } = options;
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Serialised here so the effect depends on a stable primitive rather than on
  // a params object that is a new reference on every render.
  const key = JSON.stringify(params ?? {});
  const latestRequest = useRef(0);
  // The server already rendered `initialData` for the initial params; refetching
  // them immediately would be a wasted round trip.
  const skipFirst = useRef(initialData !== undefined);
  const initialKey = useRef(key);

  useEffect(() => {
    if (!enabled) return;
    if (skipFirst.current && key === initialKey.current && nonce === 0) {
      skipFirst.current = false;
      return;
    }

    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    const controller = new AbortController();
    setLoading(true);

    apiGet<T>(path, JSON.parse(key) as QueryParams, { signal: controller.signal })
      .then((result) => {
        if (latestRequest.current !== requestId) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || latestRequest.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : "Ma'lumotni yuklab bo'lmadi");
      })
      .finally(() => {
        if (latestRequest.current === requestId) setLoading(false);
      });

    return () => controller.abort();
  }, [path, key, enabled, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload };
}
