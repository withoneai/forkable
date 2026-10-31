// Typed fetch wrapper over docs/CONTRACT.md section 6.2. Every route the UI
// calls is here; ui/src/mock answers the same paths when VITE_MOCK=1.
import type {
  AccessResponse, AnswerRequest, AnswerResponse, ApiItemError, ApiProfile, ApiRun, ApiSource, ChatMessage, ConnectSetupResponse,
  CreateDraftInput, DraftPreview, DraftStep, DryRunResult, EntityChip, EntityDetail, GrantedConnection, ImportPreview, ItemDetail,
  LedgerRow, MeResponse, OAuthClientRow, ProfileDraft, ProfileHashes, RerankResponse, SaveDraftInput, SaveDraftResult, SearchProfile,
  SearchProfilePack, SearchResponse, SettingsData, SourcesResponse, SuggestResponse, ValidationReport, CatalogPlatform, DraftEdits,
  ItemKind, ResultRow,
} from "@/contract/api-types";
import { clearSearchCache } from "./searchCache";

export const API_BASE = "/api/v1";

/** GET /assistant/engine (packages/core/src/local-agent.ts EngineStatus). */
export type EngineChoice = "auto" | "claude-code" | "codex" | "one";
export interface CliStatus {
  id: "claude-code" | "codex";
  name: string;
  installed: boolean;
  path: string | null;
  signedIn: boolean | null;
  ready: boolean;
  reason: string | null;
  models: { value: string; label: string }[];
}
export interface EngineStatus {
  engine: "local" | "one";
  local: { id: "claude-code" | "codex"; name: string; path: string } | null;
  hosted: boolean;
  choice: EngineChoice;
  override: EngineChoice | null;
  effective: EngineChoice;
  reason: "hosted" | "off" | "chosen" | "not_found" | "unavailable" | null;
  clis: CliStatus[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;
  constructor(status: number, code: string, message: string, data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; data?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText ?? "Request failed", err?.data ?? data);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export type CatalogRow = CatalogPlatform & { inGrant: boolean; connectionLabel: string | null; accounts?: number; builtin: boolean };
export type SavedSearch = { id: string; name: string; query: string; position: number };
export type RecentSearch = { query: string; at: string; resultCount: number };
export type FieldName = ConnectSetupResponse["fields"][number]["name"];

export const api = {
  health: () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; version: string }>),
  me: () => request<MeResponse>("GET", "/me"),
  // saved results belong to the signed-in user (lib/searchCache)
  signout: () => { clearSearchCache(); return request<void>("POST", "/signout"); },
  disconnect: () => { clearSearchCache(); return request<void>("POST", "/connect/disconnect"); },

  search: (p: { q: string; sort?: string; scope?: ItemKind | "all"; limit?: number; offset?: number; fresh?: boolean }, signal?: AbortSignal) =>
    request<SearchResponse>("GET", `/search${qs({ q: p.q, sort: p.sort ?? "best", scope: p.scope ?? "all", limit: p.limit ?? 30, offset: p.offset, fresh: p.fresh ? 1 : undefined })}`, undefined, signal),
  rerank: (queryId: string, fresh?: boolean) => request<RerankResponse>("POST", "/search/rerank", fresh ? { queryId, fresh } : { queryId }),
  count: (q: string) => request<{ count: number }>("GET", `/search/count${qs({ q })}`),
  suggest: (prefix: string, signal?: AbortSignal) => request<SuggestResponse>("GET", `/suggest${qs({ prefix })}`, undefined, signal),
  item: (id: string) => request<ItemDetail>("GET", `/items/${id}`),
  recentItems: (limit = 8) => request<ResultRow[]>("GET", `/recent-items${qs({ limit })}`),
  itemRaw: (id: string) => request<{ item: unknown; detail: unknown; children: unknown }>("GET", `/items/${id}/raw`),
  entities: (q: string, type?: "person" | "company") => request<EntityChip[]>("GET", `/entities${qs({ q, type, limit: q ? 10 : 200 })}`),
  entity: (id: string) => request<EntityDetail>("GET", `/entities/${id}`),
  mergeEntity: (id: string, otherId: string) => request<EntityDetail>("POST", `/entities/${id}/merge`, { otherId }),
  unmergeEntity: (id: string) => request<EntityDetail>("POST", `/entities/${id}/unmerge`),
  decideMatch: (matchId: string, decision: "merge" | "reject") => request<void>("POST", `/entity-matches/${matchId}`, { decision }),

  chats: () => request<{ id: string; title: string; updatedAt: string }[]>("GET", "/chats"),
  chat: (id: string) => request<{ id: string; title: string; messages: ChatMessage[] }>("GET", `/chats/${id}`),
  deleteChat: (id: string) => request<void>("DELETE", `/chats/${id}`),
  answer: (body: AnswerRequest) => request<AnswerResponse>("POST", "/answer", body),

  sources: () => request<SourcesResponse>("GET", "/sources"),
  sampleSources: () => request<SourcesResponse>("POST", "/sources/sample"),
  createSource: (body: { platform: string; connectionKey: string; profileId: string }) => request<ApiSource>("POST", "/sources", body),
  source: (id: string) => request<ApiSource>("GET", `/sources/${id}`),
  patchSource: (id: string, body: { paused?: boolean; scheduleEvery?: string; settings?: Record<string, unknown> }) => request<ApiSource>("PATCH", `/sources/${id}`, body),
  syncSource: (id: string, full = false) => request<{ runId: string }>("POST", `/sources/${id}/sync`, { full }),
  updateSourceProfile: (id: string) => request<ApiSource>("POST", `/sources/${id}/update-profile`, {}),
  deleteSource: (id: string, keepItems = false) => request<void>("DELETE", `/sources/${id}`, { keepItems }),
  runs: (id: string, limit = 50) => request<ApiRun[]>("GET", `/sources/${id}/runs${qs({ limit })}`),
  errors: (id: string, stage?: string) => request<ApiItemError[]>("GET", `/sources/${id}/errors${qs({ stage })}`),
  retryErrors: (id: string, externalIds?: string[]) => request<{ queued: number }>("POST", `/sources/${id}/errors/retry`, { externalIds }),

  profiles: () => request<ApiProfile[]>("GET", "/profiles"),
  profile: (id: string) => request<ApiProfile>("GET", `/profiles/${id}`),
  profileVersions: (id: string) => request<{ version: number; profileHash: string; createdAt: string; note: string | null }[]>("GET", `/profiles/${id}/versions`),
  putProfile: (id: string, json: SearchProfile, note?: string) =>
    request<{ profile: ApiProfile; report: ValidationReport; effect: "none" | "remap" | "refetch" | "reindex"; affectedItems: number }>("PUT", `/profiles/${id}`, { json, note }),
  forkProfile: (id: string) => request<ApiProfile>("POST", `/profiles/${id}/fork`),
  exportProfileUrl: (id: string) => `${API_BASE}/profiles/${id}/export`,
  exportProfile: (id: string) => request<SearchProfilePack>("GET", `/profiles/${id}/export`),
  importProfile: (body: { pack: unknown } | { url: string }) => request<ImportPreview>("POST", "/profiles/import", body),
  acceptImport: (importId: string) => request<ApiProfile[]>("POST", `/profiles/import/${importId}/accept`),
  validateProfile: (json: unknown) => request<ValidationReport>("POST", "/profiles/validate", { json }),

  catalog: (q: string) => request<{ platforms: CatalogRow[] }>("GET", `/catalog/platforms${qs({ q })}`),
  connections: () => request<GrantedConnection[]>("GET", "/connections"),
  createDraft: (body: CreateDraftInput) => request<ProfileDraft>("POST", "/profile-drafts", body),
  draft: (id: string) => request<ProfileDraft>("GET", `/profile-drafts/${id}`),
  /** Step 2: map just these models (dry run, proposal, checks). */
  pickModels: (id: string, models: string[]) => request<ProfileDraft>("POST", `/profile-drafts/${id}/models`, { models }),
  patchDraft: (id: string, body: { step?: DraftStep; edits?: DraftEdits }) => request<ProfileDraft>("PATCH", `/profile-drafts/${id}`, body),
  dryRun: (id: string, actionId: string) => request<DryRunResult>("POST", `/profile-drafts/${id}/dry-run`, { actionId }),
  repropose: (id: string, hint?: string) => request<ProfileDraft>("POST", `/profile-drafts/${id}/repropose`, { hint }),
  /** The mapping assistant: a reply plus edit ops the sheet applies itself. */
  assistDraft: (id: string, body: { message: string; history: { role: "user" | "assistant"; text: string }[]; state: { step: string; active: string | null; selected: string[]; name: string; rows: Record<string, { path: string; target: string }[]>; identity: Record<string, unknown> } }) =>
    request<{ reply: string; ops: unknown[]; dropped: string[]; by: string }>("POST", `/profile-drafts/${id}/assist`, body),
  previewDraft: (id: string, profileId: string) => request<DraftPreview>("POST", `/profile-drafts/${id}/preview`, { profileId }),
  validateDraft: (id: string) => request<ValidationReport>("POST", `/profile-drafts/${id}/validate`),
  saveDraft: (id: string, body: SaveDraftInput) => request<SaveDraftResult>("POST", `/profile-drafts/${id}/save`, body),
  /** Adds the actions these profiles call to the Connect app's ask (connect.extra.json); added lists the new ids. */
  widenAsk: (id: string, profiles: string[]) => request<{ written: string | null; next: string; added: string[] }>("POST", `/profile-drafts/${id}/widen-ask`, { profiles }),
  discardDraft: (id: string) => request<void>("DELETE", `/profile-drafts/${id}`),

  settings: () => request<SettingsData>("GET", "/settings"),
  engine: () => request<EngineStatus>("GET", "/assistant/engine"),
  redetectEngine: () => request<EngineStatus>("POST", "/assistant/engine/redetect"),
  putSettings: (patch: Partial<SettingsData>) => request<{ settings: SettingsData; effect: null | { reembed: { chunks: number; estimateCalls: number } } }>("PUT", "/settings", patch),
  saved: () => request<SavedSearch[]>("GET", "/saved-searches"),
  createSaved: (name: string, query: string) => request<SavedSearch>("POST", "/saved-searches", { name, query }),
  patchSaved: (id: string, body: Partial<Pick<SavedSearch, "name" | "query" | "position">>) => request<SavedSearch>("PATCH", `/saved-searches/${id}`, body),
  deleteSaved: (id: string) => request<void>("DELETE", `/saved-searches/${id}`),
  recent: () => request<RecentSearch[]>("GET", "/recent-searches"),
  clearRecent: () => request<void>("DELETE", "/recent-searches"),

  access: () => request<AccessResponse>("GET", "/access"),
  receiptDemo: () => request<LedgerRow>("POST", "/access/receipt-demo"),
  ledger: (p: { limit?: number; actor?: string; sourceId?: string; before?: string } = {}) => request<LedgerRow[]>("GET", `/ledger${qs({ limit: p.limit ?? 100, actor: p.actor, sourceId: p.sourceId, before: p.before })}`),

  connectSetup: () => request<ConnectSetupResponse>("GET", "/setup/connect"),
  saveConnectSetup: (input: Partial<Record<FieldName, string>>) => request<ConnectSetupResponse>("POST", "/setup/connect", input),
  removeConnectSetup: (name: FieldName) => request<ConnectSetupResponse>("DELETE", `/setup/connect/${name}`),
  createConnectApp: () => request<ConnectSetupResponse>("POST", "/setup/connect/create"),
  pollConnectApp: () => request<ConnectSetupResponse>("GET", "/setup/connect/create"),

  oauthClients: () => request<OAuthClientRow[]>("GET", "/oauth-clients"),
  revokeClient: (clientId: string) => request<void>("DELETE", `/oauth-clients/${clientId}`),
};

export type Api = typeof api;
export type { ProfileHashes };
