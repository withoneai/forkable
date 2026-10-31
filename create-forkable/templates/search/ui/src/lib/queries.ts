// TanStack Query keys (CONTRACT section 9) and the hooks every screen uses.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemKind, SettingsData } from "@/contract/api-types";
import { api } from "./api";

export const keys = {
  me: ["me"] as const,
  search: (q: string, sort: string, scope: string) => ["search", q, sort, scope] as const,
  item: (id: string) => ["item", id] as const,
  entity: (id: string) => ["entity", id] as const,
  sources: ["sources"] as const,
  source: (id: string) => ["source", id] as const,
  runs: (id: string) => ["runs", id] as const,
  errors: (id: string) => ["errors", id] as const,
  profiles: ["profiles"] as const,
  draft: (id: string) => ["draft", id] as const,
  settings: ["settings"] as const,
  engine: ["engine"] as const,
  access: ["access"] as const,
  ledger: (filters: Record<string, unknown>) => ["ledger", filters] as const,
  saved: ["saved"] as const,
  recent: ["recent"] as const,
  catalog: (q: string) => ["catalog", q] as const,
  chats: ["chats"] as const,
  chat: (id: string) => ["chat", id] as const,
  setup: ["setup", "connect"] as const,
  oauthClients: ["oauth-clients"] as const,
  connections: ["connections"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: 30_000 });

/** `rev` starts a new query after Refresh; `fresh()` is read when the request goes out (Refresh skips the server caches). */
export function useSearch(q: string, sort: string, scope: ItemKind | "all", enabled = true, o: { rev?: number; fresh?: () => boolean } = {}) {
  return useQuery({
    queryKey: [...keys.search(q, sort, scope), o.rev ?? 0],
    // TanStack passes an AbortSignal: a new keystroke cancels the old request.
    queryFn: ({ signal }) => api.search({ q, sort, scope, fresh: o.fresh?.() }, signal),
    enabled: enabled && q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export const useItem = (id: string | null) => useQuery({ queryKey: keys.item(id ?? ""), queryFn: () => api.item(id!), enabled: !!id, staleTime: 30_000 });
export const useEntity = (id: string | null) => useQuery({ queryKey: keys.entity(id ?? ""), queryFn: () => api.entity(id!), enabled: !!id });
export const useSources = () => useQuery({ queryKey: keys.sources, queryFn: api.sources });
export const useSource = (id: string | null) => useQuery({ queryKey: keys.source(id ?? ""), queryFn: () => api.source(id!), enabled: !!id });
export const useRuns = (id: string | null) => useQuery({ queryKey: keys.runs(id ?? ""), queryFn: () => api.runs(id!), enabled: !!id });
export const useErrors = (id: string | null) => useQuery({ queryKey: keys.errors(id ?? ""), queryFn: () => api.errors(id!), enabled: !!id });
export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: api.profiles });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useEngine = () => useQuery({ queryKey: keys.engine, queryFn: api.engine, staleTime: 60_000 });
export const useAccess = () => useQuery({ queryKey: keys.access, queryFn: api.access });
export const useLedger = (filters: { limit?: number; actor?: string; sourceId?: string } = {}) =>
  useQuery({ queryKey: keys.ledger(filters), queryFn: () => api.ledger(filters) });
export const useSaved = () => useQuery({ queryKey: keys.saved, queryFn: api.saved });
export const useRecent = () => useQuery({ queryKey: keys.recent, queryFn: api.recent });
export const useCatalog = (q: string) => useQuery({ queryKey: keys.catalog(q), queryFn: () => api.catalog(q), placeholderData: keepPreviousData });
export const useChats = () => useQuery({ queryKey: keys.chats, queryFn: api.chats });
export const useOAuthClients = () => useQuery({ queryKey: keys.oauthClients, queryFn: api.oauthClients });
export const useConnections = () => useQuery({ queryKey: keys.connections, queryFn: api.connections });

export function useSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsData>) => api.putSettings(patch),
    onSuccess: (r) => { qc.setQueryData(keys.settings, r.settings); void qc.invalidateQueries({ queryKey: keys.me }); void qc.invalidateQueries({ queryKey: keys.engine }); },
  });
}

export function useSaveSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, query }: { name: string; query: string }) => api.createSaved(name, query),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.saved }),
  });
}

export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, full }: { id: string; full?: boolean }) => api.syncSource(id, full),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: keys.source(v.id) }); void qc.invalidateQueries({ queryKey: keys.sources }); void qc.invalidateQueries({ queryKey: keys.runs(v.id) }); },
  });
}

export function usePatchSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; paused?: boolean; scheduleEvery?: string; settings?: Record<string, unknown> }) => api.patchSource(id, body),
    onSuccess: (s) => { qc.setQueryData(keys.source(s.id), s); void qc.invalidateQueries({ queryKey: keys.sources }); },
  });
}
