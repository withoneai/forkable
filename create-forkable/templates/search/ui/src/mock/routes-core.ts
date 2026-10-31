// Mock routes: identity, search, items, entities, saved and recent searches,
// settings, sources, runs, errors, profiles list (CONTRACT 6.2).
import type { ApiRun, ItemKind, MeResponse, SettingsData, SourcesResponse } from "@/contract/api-types";
import { logoUrl, platformName } from "@/lib/utils";
import { emit, fail, json, noContent, route, sleep } from "./http";
import { entityDetail, itemDetail, lastQueries, search, suggest, toRow } from "./search";
import { apiSource, persist, persisted, recent, saved, settings, sources, type MockSourceState } from "./state";
import { ENTITIES, ITEMS, ME } from "./world";
import { entityChip } from "./search";

const needUser = () => { if (!persisted.signedIn) fail(401, "not_signed_in", "Sign in or open the sample first."); };

export function me(): MeResponse {
  const configured = ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY"].every((f) => persisted.setup[f]);
  return {
    user: persisted.signedIn ? { id: "usr_sample", name: ME.name, email: ME.emails[0]!, avatarUrl: null, isSample: true } : null,
    signedIn: persisted.signedIn,
    connect: { configured, signInUrl: configured ? "/api/one/authorize" : null },
    capability: { mode: "hybrid", pgvector: "0.8.7", where: "embedded", vectorSchema: "public" },
    settings: persisted.signedIn ? settings : null,
  };
}

route("GET", "/api/health", () => ({ ok: true, version: "0.1.0-mock", capability: me().capability, db: "embedded", publicUrl: "http://localhost:52289" }));
route("GET", "/me", () => me());

route("GET", "/search", async ({ url }) => {
  needUser();
  await sleep(40 + Math.random() * 60);
  const q = url.searchParams.get("q") ?? "";
  return search(q, (url.searchParams.get("scope") ?? "all") as ItemKind | "all", url.searchParams.get("sort") ?? "best", Number(url.searchParams.get("limit") ?? 30));
});
route("POST", "/search/rerank", async ({ body }) => {
  const { queryId } = body as { queryId: string };
  await sleep(500);
  const order = lastQueries.get(queryId) ?? [];
  return { queryId, order, reranked: false, ms: 0, reason: "sample_no_fixture" };
});
route("GET", "/search/count", ({ url }) => ({ count: search(url.searchParams.get("q") ?? "", "all", "best", 500).total }));
route("GET", "/suggest", ({ url }) => suggest(url.searchParams.get("prefix") ?? ""));

const opened: string[] = [];
route("GET", "/items/:id", async ({ params }) => {
  await sleep(30);
  const it = ITEMS.find((i) => i.id === params.id);
  if (!it) fail(404, "not_found", "That item is not in your index.");
  opened.splice(0, opened.length, ...[it!.id, ...opened.filter((x) => x !== it!.id)].slice(0, 20));
  return itemDetail(it!);
});
route("GET", "/recent-items", ({ url }) => opened.slice(0, Number(url.searchParams.get("limit") ?? 8)).map((id) => ITEMS.find((i) => i.id === id)!).filter(Boolean).map((i) => toRow(i)));
route("GET", "/items/:id/raw", ({ params }) => {
  const it = ITEMS.find((i) => i.id === params.id);
  if (!it) fail(404, "not_found", "Not found");
  return { item: { id: it!.id, title: it!.title, ...it!.facets }, detail: null, children: {} };
});

route("GET", "/entities", ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const type = url.searchParams.get("type");
  return ENTITIES.filter((e) => (!type || e.type === type) && (!q || e.name.toLowerCase().includes(q) || e.emails.some((m) => m.includes(q)))).slice(0, Math.min(200, Number(url.searchParams.get("limit") ?? 10))).map(entityChip);
});
route("GET", "/entities/:id", ({ params }) => {
  const e = ENTITIES.find((x) => x.id === params.id);
  if (!e) fail(404, "not_found", "No such person or company.");
  return entityDetail(e!);
});
route("POST", "/entities/:id/merge", ({ params }) => entityDetail(ENTITIES.find((x) => x.id === params.id)!));
route("POST", "/entities/:id/unmerge", ({ params }) => entityDetail(ENTITIES.find((x) => x.id === params.id)!));
route("POST", "/entity-matches/:id", () => noContent());

route("GET", "/saved-searches", () => saved);
route("POST", "/saved-searches", ({ body }) => {
  const b = body as { name: string; query: string };
  const row = { id: `sv_${Date.now()}`, name: b.name, query: b.query, position: saved.length };
  saved.push(row);
  return row;
});
route("PATCH", "/saved-searches/:id", ({ params, body }) => {
  const row = saved.find((s) => s.id === params.id);
  if (!row) fail(404, "not_found", "No such saved search.");
  Object.assign(row!, body);
  return row;
});
route("DELETE", "/saved-searches/:id", ({ params }) => { const i = saved.findIndex((s) => s.id === params.id); if (i >= 0) saved.splice(i, 1); return noContent(); });
route("GET", "/recent-searches", () => recent.slice(0, 8));
route("DELETE", "/recent-searches", () => { recent.length = 0; return noContent(); });

route("GET", "/settings", () => settings);
// Claude Code installed and signed in, Codex installed but signed out (so its option shows disabled).
// localStorage search.mock.engine = "none" hides both, "hosted" plays SEARCH_HOSTED=1.
const MOCK_CLAUDE_MODELS = [
  { value: "default", label: "Claude Code default" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5, powerful" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5, balanced" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5, fastest" },
];
function mockEngine() {
  let mode: string | null = null;
  try { mode = localStorage.getItem("search.mock.engine"); } catch { /* no storage */ }
  const hosted = mode === "hosted";
  const none = mode === "none";
  const clis = hosted ? [] : [
    { id: "claude-code" as const, name: "Claude Code", installed: !none, path: none ? null : "~/.local/bin/claude", signedIn: none ? null : true, ready: !none, reason: none ? "Not installed" : null, models: MOCK_CLAUDE_MODELS },
    { id: "codex" as const, name: "Codex", installed: !none, path: none ? null : "~/.local/bin/codex", signedIn: none ? null : false, ready: false, reason: none ? "Not installed" : "Not signed in (run codex login)", models: [{ value: "default", label: "Codex default" }] },
  ];
  const choice = settings.engine;
  const effective = hosted ? "one" : choice;
  const ready = clis.filter((c) => c.ready).map((c) => c.id);
  const run = effective === "one" ? null : effective === "auto" ? ready[0] ?? null : ready.includes(effective) ? effective : null;
  const cli = clis.find((c) => c.id === run);
  return {
    engine: cli ? "local" : "one", local: cli ? { id: cli.id, name: cli.name, path: cli.path! } : null, hosted, choice, override: null, effective,
    reason: hosted ? "hosted" : cli ? null : effective === "one" ? "chosen" : effective === "auto" ? "not_found" : "unavailable", clis,
  };
}
route("GET", "/assistant/engine", () => mockEngine());
route("POST", "/assistant/engine/redetect", async () => { await sleep(400); return mockEngine(); });
route("PUT", "/settings", ({ body }) => {
  const patch = body as Partial<SettingsData>;
  const reembed = patch.embedding && patch.embedding.model !== settings.embedding.model;
  Object.assign(settings, patch);
  return { settings, effect: reembed ? { reembed: { chunks: 412, estimateCalls: 5 } } : null };
});

// ---- sources ------------------------------------------------------------------
export function sourcesResponse(): SourcesResponse {
  const list = [...sources.values()].map(apiSource);
  const slack = list.find((s) => s.platform === "slack" && s.health.status === "rate_limited");
  return {
    semantic: { model: "local:hash-v1", semantic: false, reason: "sample", platform: null, message: null },
    sources: list,
    available: [{ platform: "google-drive", name: "Google Drive", logoUrl: logoUrl("google-drive"), connectionKey: "sample:google-drive", connectionLabel: "dana@acme.com", builtinProfiles: [] }],
    notInApp: ["jira", "github", "salesforce", "asana"].map((p) => ({ platform: p, name: platformName(p), logoUrl: logoUrl(p) })),
    banner: slack ? { level: "warn", text: `Slack is rate limiting Search. Trying again at ${new Date(slack.health.retryAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`, sourceId: slack.id, action: "retry" } : null,
  };
}

route("GET", "/sources", () => { needUser(); return sourcesResponse(); });
route("POST", "/sources/sample", async () => {
  await sleep(500);
  persisted.signedIn = true;
  persist();
  return sourcesResponse();
});
const src = (id: string): MockSourceState => sources.get(id) ?? fail(404, "not_found", "No such source.");
route("GET", "/sources/:id", ({ params }) => apiSource(src(params.id!)));
route("PATCH", "/sources/:id", ({ params, body }) => {
  const s = src(params.id!);
  const b = body as { paused?: boolean; scheduleEvery?: string; settings?: Record<string, unknown> };
  if (b.paused !== undefined) s.paused = b.paused;
  if (b.scheduleEvery) s.scheduleEvery = b.scheduleEvery;
  if (b.settings) s.settings = { ...s.settings, ...b.settings };
  emit({ type: "source", sourceId: s.def.id, health: apiSource(s).health });
  return apiSource(s);
});
route("DELETE", "/sources/:id", ({ params }) => { sources.delete(params.id!); return noContent(); });
route("POST", "/sources/:id/update-profile", ({ params }) => apiSource(src(params.id!)));

const runs = new Map<string, ApiRun[]>();
function seedRuns(s: MockSourceState): ApiRun[] {
  if (runs.has(s.def.id)) return runs.get(s.def.id)!;
  const out: ApiRun[] = [];
  // A source made in the New profile sheet has no history yet.
  if (s.origin === "user") { runs.set(s.def.id, out); return out; }
  const every = 15 * 60_000;
  for (let i = 0; i < 24; i++) {
    const end = Date.now() - (4 * 60_000 + i * every);
    const fail = s.def.platform === "slack" && i % 5 === 0;
    const first = i === 23;
    out.push({
      runId: `run_${s.def.id}_${i}`, sourceId: s.def.id, trigger: first ? "first" : i === 6 ? "manual" : "schedule", outcome: fail ? "rate_limited" : "ok", fullPass: first,
      pages: first ? 3 : 1, fetched: first ? s.health.itemCount : (i * 7) % 5, hydrated: 0, upserted: first ? s.health.itemCount : (i * 3) % 3, unchanged: first ? 0 : (i * 7) % 5,
      tombstoned: 0, skipped: 0, calls: first ? 4 : 1, retries: fail ? 1 : 0, startedAt: new Date(end - (first ? 9000 : 700 + (i % 4) * 300)).toISOString(), finishedAt: new Date(end).toISOString(),
      retryAt: fail ? new Date(end + 60_000).toISOString() : undefined, error: fail ? { code: "rate_limited", message: "Slack answered 429. Retry-After 60 s.", at: new Date(end).toISOString(), httpStatus: 429 } : undefined,
    });
  }
  runs.set(s.def.id, out);
  return out;
}
route("GET", "/sources/:id/runs", ({ params }) => seedRuns(src(params.id!)));

/** A run that takes a few seconds and streams progress, like the real scheduler. */
export async function simulateRun(s: MockSourceState, trigger: ApiRun["trigger"], total: number) {
  const list = seedRuns(s);
  const run: ApiRun = { runId: `run_${Date.now()}`, sourceId: s.def.id, trigger, outcome: "running", fullPass: trigger === "first", pages: 0, fetched: 0, hydrated: 0, upserted: 0, unchanged: 0, tombstoned: 0, skipped: 0, calls: 0, retries: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  list.unshift(run);
  s.health = { ...s.health, status: "syncing", lastAttemptAt: run.startedAt, progress: { done: 0, estimate: total } };
  emit({ type: "source", sourceId: s.def.id, health: s.health });
  emit({ type: "run", sourceId: s.def.id, run });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await sleep(600);
    const done = Math.round((total * i) / steps);
    run.pages = i; run.calls = i; run.fetched = done; run.upserted = trigger === "first" ? done : Math.min(2, done);
    s.health = { ...s.health, progress: { done, estimate: total } };
    emit({ type: "source", sourceId: s.def.id, health: s.health });
  }
  run.outcome = "ok"; run.finishedAt = new Date().toISOString();
  s.health = { ...s.health, status: "healthy", lastSuccessAt: run.finishedAt, nextRunAt: new Date(Date.now() + 15 * 60_000).toISOString(), progress: undefined, itemCount: trigger === "first" ? total : s.health.itemCount, added24h: s.health.added24h + run.upserted, retryAt: null, lastError: null };
  emit({ type: "run", sourceId: s.def.id, run });
  emit({ type: "source", sourceId: s.def.id, health: s.health });
  emit({ type: "index", added: run.upserted, updated: 0, removed: 0, sourceId: s.def.id });
}

route("POST", "/sources/:id/sync", ({ params }) => {
  const s = src(params.id!);
  if (s.health.status === "syncing") fail(409, "conflict", "A run is already in flight for this source.");
  void simulateRun(s, "manual", Math.max(3, s.health.itemCount));
  return { runId: `run_${Date.now()}` };
});
route("GET", "/sources/:id/errors", ({ params }) => {
  const s = src(params.id!);
  if (s.def.platform === "teams") return [
    { externalId: "19:channel-general", stage: "fetch", code: "blocked_by_grant", message: "Search was not granted Read channel messages on Teams. Turn it on in One, or leave channel messages off.", attempts: 3, lastAt: new Date(Date.now() - 40 * 60_000).toISOString() },
    { externalId: "19:channel-sales", stage: "fetch", code: "blocked_by_grant", message: "Search was not granted Read channel messages on Teams.", attempts: 3, lastAt: new Date(Date.now() - 41 * 60_000).toISOString() },
  ];
  if (s.def.platform === "slack") return [{ externalId: "C0DEALS", stage: "fetch", code: "rate_limited", message: "Slack is rate limiting history calls. Search retries on the next window.", attempts: 1, lastAt: new Date(Date.now() - 2 * 60_000).toISOString() }];
  if (s.def.platform === "notion") return [{ externalId: "page_8c1e", stage: "normalize", code: "invalid_profile", message: "Body over 200,000 characters after decoding. Kept the first 200,000.", attempts: 1, lastAt: new Date(Date.now() - 26 * 3600_000).toISOString() }];
  return [];
});
route("POST", "/sources/:id/errors/retry", ({ body }) => ({ queued: (body as { externalIds?: string[] })?.externalIds?.length ?? 1 }));

route("GET", "/profiles", () => [...sources.values()].map((s) => ({
  id: `prf_${s.def.platform}_${s.def.model}`, slug: `${s.def.platform}.${s.def.model}`, platform: s.def.platform, model: s.def.model, title: `${platformName(s.def.platform)} ${s.def.title}`,
  origin: s.origin, currentVersion: 1, profileHash: "3f9a1c0d7b2e4a61", verified: "fixture", json: null,
})));

export { needUser };
