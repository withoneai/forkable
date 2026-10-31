// Saved searches in the browser (instant refresh): the last 20 result pages with their
// Jev order and the answer strip's answer, per signed-in user, for 30 minutes. A refresh
// or a return to the same query, scope and sort renders from here with no rerank or
// answer call. Dropped on sign-out and when another user signs in.
import type { AnswerResponse, RerankResponse, SearchResponse } from "@/contract/api-types";

const STORE = "search.results.v1";
export const CACHE_TTL_MS = 30 * 60_000;
const MAX = 20;

export interface CachedSearch {
  k: string;
  at: number;
  search: SearchResponse;
  /** The Jev order for search.queryId, once it answered. */
  order: string[] | null;
  /** Why there is no order (a timeout means Jev may have stored scores since). */
  rerankReason: RerankResponse["reason"] | null;
  answer: AnswerResponse | null;
}

interface Store { userId: string; entries: CachedSearch[] }

export const cacheKey = (q: string, scope: string, sort: string) => JSON.stringify([q, scope, sort]);

function read(): Store | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Store) : null;
  } catch {
    return null;
  }
}

function write(s: Store): void {
  // over quota: drop the oldest until it fits, else give up quietly
  for (let entries = s.entries; ; entries = entries.slice(0, -1)) {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...s, entries }));
      return;
    } catch {
      if (!entries.length) return;
    }
  }
}

function live(userId: string): Store {
  const s = read();
  const now = Date.now();
  if (!s || s.userId !== userId) {
    clearSearchCache();
    return { userId, entries: [] };
  }
  return { userId, entries: s.entries.filter((e) => now - e.at < CACHE_TTL_MS) };
}

export function readCached(userId: string, k: string): CachedSearch | null {
  return live(userId).entries.find((e) => e.k === k) ?? null;
}

/** A fresh result page: replaces any entry for the key and keeps the newest MAX. */
export function saveSearch(userId: string, k: string, search: SearchResponse, keep: Partial<Pick<CachedSearch, "answer">> = {}): void {
  const s = live(userId);
  const entry: CachedSearch = { k, at: Date.now(), search, order: null, rerankReason: null, answer: keep.answer ?? null };
  write({ userId, entries: [entry, ...s.entries.filter((e) => e.k !== k)].slice(0, MAX) });
}

/** Adds the rerank or the answer to the entry that holds `queryId`. */
export function patchCached(userId: string, queryId: string, patch: Partial<Pick<CachedSearch, "order" | "rerankReason" | "answer">>): void {
  const s = live(userId);
  let hit = false;
  const entries = s.entries.map((e) => (e.search.queryId === queryId ? ((hit = true), { ...e, ...patch }) : e));
  if (hit) write({ userId, entries });
}

/** The answer belongs to the question text, so every entry for the same q gets it. */
export function patchAnswer(userId: string, q: string, answer: AnswerResponse): void {
  const s = live(userId);
  let hit = false;
  const entries = s.entries.map((e) => ((JSON.parse(e.k) as string[])[0] === q ? ((hit = true), { ...e, answer }) : e));
  if (hit) write({ userId, entries });
}

export function dropCached(userId: string, k: string): void {
  const s = live(userId);
  write({ userId, entries: s.entries.filter((e) => e.k !== k) });
}

export function clearSearchCache(): void {
  try { localStorage.removeItem(STORE); } catch { /* storage unavailable */ }
}
