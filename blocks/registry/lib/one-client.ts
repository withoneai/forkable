import { useCallback, useEffect, useState } from "react";

// The browser half of every component: fetch your own route, get back
// `{ data, meta }`. `meta.mode` is "sample" until Sign in with One is set up.

export type OneMode = "sample" | "grant";
export interface OneMeta {
  mode: OneMode;
  platform: string;
  access: "read" | "write";
  status: number;
}

export class OneClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Where the routes live. Change it once if your API is not same-origin. */
export const ONE_API_BASE = "";

export async function oneFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<{ data: T; meta: OneMeta }> {
  const res = await fetch(ONE_API_BASE + path, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new OneClientError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`);
  return json as { data: T; meta: OneMeta };
}

export function useOneQuery<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; meta: OneMeta | null; loading: boolean; error: OneClientError | null }>({
    data: null,
    meta: null,
    loading: path !== null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    oneFetch<T>(path)
      .then((r) => live && setState({ data: r.data, meta: r.meta, loading: false, error: null }))
      .catch((e) => live && setState({ data: null, meta: null, loading: false, error: e instanceof OneClientError ? e : new OneClientError(0, "network", String(e)) }));
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { ...state, reload };
}

export function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
