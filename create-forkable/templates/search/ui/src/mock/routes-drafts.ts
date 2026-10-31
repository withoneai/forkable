// Mock routes for the New profile flow and profile sharing (CONTRACT 6.2):
// catalog, connections, the /profile-drafts lifecycle on the Zendesk sample,
// profile import, export, fork, PUT and validate, and POST /sources.
import type {
  ApiProfile, CatalogModel, DraftPreview, Expr, GrantedConnection, ImportPreview, ItemFacets, NormalizedItem, ProfileDraft, ResultRow,
  SearchProfile, SearchProfilePack, SourceHealth, ValidationIssue, ValidationReport,
} from "@/contract/api-types";
import { getPath, renderTpl } from "@/components/profile/fieldmap";
import { logoUrl, platformName } from "@/lib/utils";
import { emit, fail, noContent, route, routes, sleep } from "./http";
import { simulateRun } from "./routes-core";
import { apiSource, sources, type MockSourceState } from "./state";
import { builtinProfile, CATALOG, catalogRow, ZD_ACTIONS, ZD_DATA, ZD_PROPOSAL, ZD_USERS } from "./catalog";
import { ITEMS, type MockItem } from "./world";
import HUBSPOT from "./hubspot-models.json";

const drafts = new Map<string, ProfileDraft>();
const userProfiles = new Map<string, SearchProfile>();
const imports = new Map<string, SearchProfilePack>();

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== "object" || Array.isArray(patch) || base === null || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k === "fields" || k === "entities" ? v : deepMerge(out[k], v);
  return out as T;
}

export function draftProfile(d: ProfileDraft, profileId: string): SearchProfile | null {
  const m = d.proposal?.models.find((x) => x.profile.id === profileId);
  if (!m) return null;
  return deepMerge(m.profile, d.edits.profiles[profileId]);
}

/** Profile paths are rooted at item; the mock reads them against the record itself. */
const rec = (p: string) => p.replace(/^item\./, "");
function evalExpr(e: Expr | undefined, item: unknown): unknown {
  if (e === undefined) return undefined;
  if (typeof e === "string") return getPath(item, rec(e));
  if ("template" in e) return renderTpl(e.template, item);
  if ("coalesce" in e) { for (const x of e.coalesce) { const v = evalExpr(x, item); if (v != null && v !== "") return v; } return undefined; }
  if ("join" in e) return e.join.map((x) => evalExpr(x, item)).filter((v) => v != null && v !== "").join(e.sep ?? " ");
  if ("path" in e) {
    const v = getPath(item, rec(e.path));
    if (e.pick === "count") return Array.isArray(v) ? v.length : 0;
    return v;
  }
  return undefined;
}
const str = (v: unknown) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
const userName = (id: unknown) => ZD_USERS.find((u) => u.id === id)?.name ?? null;

function normalize(p: SearchProfile, item: unknown): { item: NormalizedItem; row: ResultRow } {
  const f = p.fields;
  const title = str(evalExpr(f.title, item)) || "(untitled)";
  const body = str(evalExpr(f.body, item));
  const occurredAt = str(evalExpr(f.occurredAt, item)) || new Date().toISOString();
  const url = f.url ? renderTpl(f.url, item) : null;
  const priority = f.facets?.priority ? str(evalExpr(f.facets.priority, item)) : "";
  const facets = (p.kind === "task"
    ? { kind: "task", state: str(evalExpr(f.status, item)) || undefined, priority: ({ urgent: 1, high: 2, normal: 3, low: 4 } as Record<string, 1 | 2 | 3 | 4>)[priority] ?? 0, key: `#${str(getPath(item, p.list.idPath))}` }
    : p.kind === "person" ? { kind: "person", email: str(getPath(item, "email")) || undefined }
    : p.kind === "company" ? { kind: "company", domain: str(getPath(item, "domain_names[0]")) || undefined }
    : { kind: p.kind }) as ItemFacets;
  const refs = (p.entities?.refs ?? []).map((r) => {
    const tpl = r.externalId && typeof r.externalId === "object" && "template" in r.externalId ? r.externalId.template : "";
    const m = /item\.([a-z_]+)/.exec(tpl);
    const id = m ? getPath(item, m[1]!) : null;
    return { role: r.role, type: r.type, externalId: id != null ? `zendesk:${r.type === "company" ? "organization" : "user"}:${id}` : undefined, name: r.type === "person" ? userName(id) ?? undefined : undefined };
  });
  const n: NormalizedItem = {
    externalId: str(getPath(item, p.list.idPath)), kind: p.kind, title, body, snippet: body.slice(0, 280) || null, occurredAt, updatedAt: str(evalExpr(f.updatedAt, item)) || null,
    url, container: str(evalExpr(f.container, item)) || null, groupKey: null, status: str(evalExpr(f.status, item)) || null,
    labels: (() => { const v = evalExpr(f.labels, item); return Array.isArray(v) ? v.map(String) : v ? [String(v)] : []; })(), facets, refs, is: null, deleted: false,
  };
  const row: ResultRow = {
    id: `preview_${n.externalId}`, kind: p.kind, platform: p.platform, sourceId: "draft", sourceName: platformName(p.platform), logoUrl: logoUrl(p.platform),
    title, titleHighlights: [], context: n.status, snippet: n.snippet, snippetHighlights: [], occurredAt, updatedAt: n.updatedAt, url,
    people: refs.filter((r) => r.name).map((r, i) => ({ entityId: `ent_zd_${i}`, name: r.name!, role: r.role, avatarUrl: null })),
    facets, lane: null, importance: null, groupCount: 1, score: 0, ranks: { kw: null, vec: null, title: null, rerank: null },
  };
  return { item: n, row };
}

function validate(d: ProfileDraft): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (check: ValidationIssue["check"], level: ValidationIssue["level"], message: string, profileId?: string) => issues.push({ check, level, message, profileId });
  for (const pid of d.edits.selected) {
    const p = draftProfile(d, pid);
    if (!p) continue;
    const rows = ZD_DATA[p.list.actionId]?.rows ?? [];
    const n = rows.length;
    add("schema", "ok", "Matches profile-1", pid);
    add("actions", "ok", `${p.list.actionId} is read only and in the grant`, pid);
    add("fetch", "ok", `One page returned ${n} records`, pid);
    const ids = rows.map((r) => getPath(r, p.list.idPath)).filter((v) => v != null && v !== "");
    const uniq = new Set(ids.map(String)).size;
    if (!p.list.idPath) add("id", "error", "Pick a unique id field", pid);
    else add("id", uniq === n && ids.length === n ? "ok" : "error", `${uniq} of ${n} unique`, pid);
    const titled = rows.filter((r) => str(evalExpr(p.fields.title, r))).length;
    add("title", titled / Math.max(1, n) >= 0.8 ? "ok" : "error", titled === 0 ? "Title needs a field" : `Title on ${titled} of ${n}`, pid);
    const dated = rows.filter((r) => !Number.isNaN(new Date(str(evalExpr(p.fields.occurredAt, r))).getTime()) && str(evalExpr(p.fields.occurredAt, r))).length;
    add("dates", dated / Math.max(1, n) >= 0.8 ? "ok" : "error", dated === 0 ? "Date created needs a field" : `Dates parse on ${dated} of ${n}`, pid);
    if (p.fields.url) {
      const ok = rows.filter((r) => (renderTpl(p.fields.url!, r) ?? "").startsWith("https://")).length;
      add("link", ok / Math.max(1, n) >= 0.8 ? "ok" : "error", ok === n ? `Link resolves on ${n} of ${n}` : `Link template does not resolve on ${n - ok} of ${n} samples`, pid);
    } else add("link", "warn", "No link. Results will not open in Zendesk.", pid);
    add("pagination", "ok", "Cursor from meta.after_cursor", pid);
    add("incremental", "ok", "Watermark on updated_at", pid);
    add("size", "ok", "Largest body under 1,000 characters", pid);
    add("hashes", "ok", "fetch, map and index hashes computed", pid);
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

// ---- catalog and connections -----------------------------------------------------
route("GET", "/catalog/platforms", async ({ url }) => {
  await sleep(80);
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
  return { platforms: CATALOG.filter((c) => !q || c.name.toLowerCase().includes(q) || c.platform.includes(q) || c.category.toLowerCase().includes(q)).map(catalogRow) };
});
route("GET", "/connections", (): GrantedConnection[] => CATALOG.filter((c) => c.inGrant).map((c) => ({
  key: `sample:${c.platform}`, platform: c.platform, name: c.name, label: c.connectionLabel ?? undefined, access: { policy: "methods", methods: ["GET"] },
})));

// ---- drafts ---------------------------------------------------------------------
const stages = ["actions", "docs", "dry_run", "propose", "validate", "ready"] as const;
const stageMsg: Record<(typeof stages)[number], string> = {
  actions: "Reading Zendesk's list actions", docs: "Loading the docs for 4 actions", dry_run: "Dry run on your grant, one page each",
  propose: "Claude Haiku is proposing a map", validate: "Checking ids, dates and links", ready: "Ready",
};

// the Zendesk sample's models, as core's groupModels would make them
const ZD_KIND: Record<string, CatalogModel["kind"]> = { ticket: "task", user: "person", organization: "company", group: "record" };
const zdModels = (): CatalogModel[] => ZD_ACTIONS.map((a) => {
  const key = a.tags[0]!.replace(/s$/, "");
  return { key, label: a.tags[0]![0]!.toUpperCase() + a.tags[0]!.slice(1), kind: ZD_KIND[key] ?? "record", actions: [{ ...a, model: key }], more: 0, permitted: a.permitted, suggested: key !== "group", builtinProfile: null };
});

route("POST", "/profile-drafts", async ({ body }) => {
  const { platform } = body as { platform: string; connectionKey?: string };
  const cat = CATALOG.find((c) => c.platform === platform) ?? fail(404, "not_found", "That platform is not in the catalog.");
  const id = `drf_${Date.now().toString(36)}`;
  const isZd = platform === "zendesk";
  emit({ type: "draft", draftId: id, stage: "actions", message: stageMsg.actions });
  await sleep(500);
  emit({ type: "draft", draftId: id, stage: "ready", message: "Ready" });
  const files = { actionId: `sample::${platform}::files.list`, title: "List files", method: "GET", path: "/files", tags: [], listLike: true, readOnly: true, permitted: true, model: "file" };
  const models: CatalogModel[] = isZd ? zdModels() : platform === "hubspot" ? (HUBSPOT.models as CatalogModel[]) : cat.inGrant ? [{ key: "file", label: "Files", kind: "doc", actions: [files], more: 0, permitted: true, suggested: true, builtinProfile: null }] : [];
  const draft: ProfileDraft = {
    id, platform, step: "models", status: "open",
    connection: cat.inGrant ? { key: `sample:${platform}`, label: cat.connectionLabel ?? platform } : null,
    inGrant: cat.inGrant, models, accounts: cat.inGrant ? [{ key: `sample:${platform}`, label: cat.connectionLabel ?? platform }] : [], hiddenActions: isZd ? 3 : platform === "hubspot" ? HUBSPOT.hidden : 0, picked: [], candidates: [], samples: {},
    proposal: null, proposedBy: "rules", edits: { selected: [], profiles: {} }, validation: null,
  };
  drafts.set(id, draft);
  return draft;
});

route("POST", "/profile-drafts/:id/models", async ({ params, body }) => {
  const d = draftOf(params.id!);
  const keys = (body as { models: string[] }).models;
  const isZd = d.platform === "zendesk";
  for (const s of stages.slice(1)) { emit({ type: "draft", draftId: d.id, stage: s, message: stageMsg[s] }); await sleep(s === "propose" ? 900 : 420); }
  d.picked = keys;
  d.candidates = d.models.filter((m) => keys.includes(m.key)).flatMap((m) => m.actions);
  const samples = isZd ? Object.fromEntries(ZD_ACTIONS.filter((a) => a.permitted).map((a) => {
    const d = ZD_DATA[a.actionId]!;
    return [a.actionId, { actionId: a.actionId, status: 200, ok: true, count: d.rows.length, estimate: d.total, sample: d.rows.slice(0, 5), topLevelKeys: [d.key, "meta", "links"] }];
  })) : {};
  d.samples = samples;
  const ids = new Set(d.candidates.map((a) => a.actionId));
  const proposal = isZd ? structuredClone(ZD_PROPOSAL) : null;
  if (proposal) proposal.models = proposal.models.filter((m) => ids.has(m.profile.list.actionId)).map((m) => ({ ...m, recommended: true }));
  d.proposal = proposal;
  d.proposedBy = isZd ? "fixture" : "rules";
  d.edits = { selected: proposal?.models.map((m) => m.profile.id) ?? [], profiles: {} };
  d.validation = null;
  return d;
});
const draftOf = (id: string) => drafts.get(id) ?? fail(404, "not_found", "That draft is gone. Start again.");
route("GET", "/profile-drafts/:id", ({ params }) => draftOf(params.id!));
route("PATCH", "/profile-drafts/:id", ({ params, body }) => {
  const d = draftOf(params.id!);
  const b = body as Partial<Pick<ProfileDraft, "step" | "edits">>;
  if (b.step) d.step = b.step;
  if (b.edits) d.edits = { selected: b.edits.selected ?? d.edits.selected, profiles: { ...d.edits.profiles, ...b.edits.profiles } };
  d.validation = null;
  return d;
});
route("POST", "/profile-drafts/:id/dry-run", async ({ params, body }) => {
  const d = draftOf(params.id!);
  await sleep(300);
  return d.samples[(body as { actionId: string }).actionId] ?? fail(404, "not_found", "No dry run for that action.");
});
// The mapping assistant, mocked: "hourly" changes the schedule, "date" maps updated_at, else it explains.
route("POST", "/profile-drafts/:id/assist", async ({ params, body }) => {
  const d = draftOf(params.id!);
  await sleep(500);
  const msg = String((body as { message?: string })?.message ?? "").toLowerCase();
  const model = d.edits.selected[0] ?? d.proposal?.models[0]?.profile.id ?? "";
  if (/hour/.test(msg)) return { reply: "Done. It refreshes every hour now.", ops: [{ op: "identity", model, every: "60m" }], dropped: [], by: "mock" };
  if (/date|updated/.test(msg)) return { reply: "updated_at changes on every edit, so I mapped it as Date updated.", ops: [{ op: "map", model, path: "updated_at", target: "updatedAt" }], dropped: [], by: "mock" };
  return { reply: "This sample maps the ticket subject as the title, created_at as the date and the ticket URL as the link. Ask me to change any of them.", ops: [], dropped: [], by: "mock" };
});

route("POST", "/profile-drafts/:id/repropose", async ({ params }) => {
  const d = draftOf(params.id!);
  emit({ type: "draft", draftId: d.id, stage: "propose", message: stageMsg.propose });
  await sleep(900);
  d.proposal = structuredClone(ZD_PROPOSAL);
  d.edits.profiles = {};
  emit({ type: "draft", draftId: d.id, stage: "ready", message: "Ready" });
  return d;
});
route("POST", "/profile-drafts/:id/preview", async ({ params, body }) => {
  const d = draftOf(params.id!);
  const pid = (body as { profileId: string }).profileId;
  const p = draftProfile(d, pid) ?? fail(404, "not_found", "No such model in this draft.");
  await sleep(60);
  const rows = ZD_DATA[p.list.actionId]?.rows.slice(0, 5) ?? [];
  const out: DraftPreview = { profileId: pid, samples: rows.map((r) => { const n = normalize(p, r); return { externalId: n.item.externalId, ...n }; }) };
  return out;
});
route("POST", "/profile-drafts/:id/validate", async ({ params }) => {
  const d = draftOf(params.id!);
  await sleep(250);
  d.validation = validate(d);
  return d.validation;
});
route("POST", "/profile-drafts/:id/widen-ask", async ({ params }) => {
  draftOf(params.id!);
  await sleep(300);
  return { written: null, next: "sample", added: [] as string[] };
});
route("DELETE", "/profile-drafts/:id", ({ params }) => { drafts.delete(params.id!); return noContent(); });

route("POST", "/profile-drafts/:id/save", async ({ params, body }) => {
  const d = draftOf(params.id!);
  const b = body as { name?: string; profiles: string[] };
  const report = validate(d);
  if (!report.ok) fail(400, "invalid_profile", "Fix the errors before saving.", { report });
  await sleep(400);
  const sourceIds: string[] = [];
  for (const pid of b.profiles) {
    const p = draftProfile(d, pid)!;
    const saved: SearchProfile = { ...p, title: b.profiles.length === 1 && b.name ? b.name : p.title, proposal: { by: d.proposedBy, draftId: d.id, at: new Date().toISOString() } };
    userProfiles.set(`prf_${p.platform}_${p.model}`, saved);
    const sid = `src_${p.platform}_${p.model}`;
    const total = ZD_DATA[p.list.actionId]?.total ?? 5;
    const health: SourceHealth = { status: "new", lastSuccessAt: null, lastAttemptAt: null, nextRunAt: null, retryAt: null, consecutiveFailures: 0, itemCount: 0, added24h: 0, updated24h: 0, failed24h: 0, lastError: null, progress: { done: 0, estimate: total } };
    const s: MockSourceState = {
      def: { id: sid, platform: p.platform, model: p.model, title: p.model[0]!.toUpperCase() + p.model.slice(1), kind: p.kind, connectionLabel: d.connection?.label ?? p.platform, actions: [p.list.actionId] },
      health, paused: false, scheduleEvery: typeof p.schedule?.every === "string" ? p.schedule.every : "15m", settings: { backfill: p.incremental.strategy === "watermark" ? p.incremental.initial ?? "365d" : "all" }, extraItems: 0, origin: "user",
    };
    sources.set(sid, s);
    created.set(sid, Date.now());
    sourceIds.push(sid);
    void simulateRun(s, "first", total).then(() => indexDraftItems(p));
  }
  d.status = "saved";
  return { profileIds: b.profiles.map((pid) => `prf_${pid.replace(".", "_")}`), sourceIds, firstRunIds: sourceIds.map((s) => `run_first_${s}`) };
});

/** After the first run, the new source's records become searchable in the mock. */
function indexDraftItems(p: SearchProfile) {
  for (const r of ZD_DATA[p.list.actionId]?.rows ?? []) {
    const { item } = normalize(p, r);
    const id = `itm_zd_${p.model}_${item.externalId}`;
    if (ITEMS.some((i) => i.id === id)) continue;
    const mi: MockItem = {
      id, kind: p.kind, platform: p.platform, model: p.model, title: item.title, body: item.body, occurredAt: item.occurredAt, updatedAt: item.updatedAt ?? undefined,
      url: item.url, status: item.status, labels: item.labels, facets: item.facets, people: [], lane: null, importance: 0.5, by: "rules",
    };
    ITEMS.push(mi);
  }
}

// ---- sources ----------------------------------------------------------------------
route("POST", "/sources", ({ body }) => {
  const b = body as { platform: string; connectionKey: string; profileId: string };
  const ex = [...sources.values()].find((s) => `prf_${s.def.platform}_${s.def.model}` === b.profileId);
  if (ex) return apiSource(ex);
  return fail(404, "not_found", "No such profile.");
});

// ---- profiles: give GET /profiles real JSON (routes-core leaves it null) ----------------
function profileJson(id: string): SearchProfile | null {
  if (userProfiles.has(id)) return userProfiles.get(id)!;
  const s = [...sources.values()].find((x) => `prf_${x.def.platform}_${x.def.model}` === id);
  return s ? builtinProfile(s.def.platform, s.def.model, s.def.kind, s.def.title) : null;
}
// A source made by the sheet has no history: hide the demo runs routes-core seeds for every source.
const created = new Map<string, number>();
const runsRoute = routes.find((r) => r.method === "GET" && r.re.test("/sources/x/runs"));
if (runsRoute) {
  const inner = runsRoute.handler;
  runsRoute.handler = async (c) => {
    const list = (await inner(c)) as { startedAt: string }[];
    const since = created.get(c.params.id!);
    return since ? list.filter((r) => new Date(r.startedAt).getTime() >= since - 1000) : list;
  };
}
const listRoute = routes.find((r) => r.method === "GET" && r.re.test("/profiles"));
if (listRoute) {
  const inner = listRoute.handler;
  listRoute.handler = async (c) => {
    const rows = (await inner(c)) as ApiProfile[];
    return rows.map((r) => ({ ...r, json: r.json ?? profileJson(r.id), origin: userProfiles.has(r.id) ? "user" : r.origin }));
  };
}
const profileOf = (id: string) => profileJson(id) ?? fail(404, "not_found", "No such profile.");
const apiProfile = (id: string, p: SearchProfile, origin = "user"): ApiProfile => ({ id, slug: p.id, platform: p.platform, model: p.model, title: p.title, origin, currentVersion: (p.revision ?? 1), profileHash: "7d02e9a14c3b8f50", verified: p.verified ?? "fixture", json: p });

route("GET", "/profiles/:id", ({ params }) => { const p = profileOf(params.id!); return apiProfile(params.id!, p, userProfiles.has(params.id!) ? "user" : "builtin"); });
route("GET", "/profiles/:id/versions", ({ params }) => [{ version: profileOf(params.id!).revision ?? 1, profileHash: "3f9a1c0d7b2e4a61", createdAt: new Date(Date.now() - 86_400_000 * 3).toISOString(), note: "Built-in" }]);
route("PUT", "/profiles/:id", async ({ params, body }) => {
  const id = params.id!;
  const b = body as { json: SearchProfile; note?: string };
  const prev = profileOf(id);
  await sleep(300);
  const json = { ...b.json, revision: (prev.revision ?? 1) + 1, author: "user" };
  userProfiles.set(id, json);
  const s = [...sources.values()].find((x) => `prf_${x.def.platform}_${x.def.model}` === id);
  if (s) s.origin = "user";
  const fetchChanged = JSON.stringify(prev.list) !== JSON.stringify(json.list) || JSON.stringify(prev.incremental) !== JSON.stringify(json.incremental);
  return { profile: apiProfile(id, json), report: { ok: true, issues: [] }, effect: fetchChanged ? "refetch" : "remap", affectedItems: s?.health.itemCount ?? 0 };
});
route("POST", "/profiles/:id/fork", ({ params }) => {
  const p = profileOf(params.id!);
  const json = { ...p, author: "user" };
  userProfiles.set(params.id!, json);
  return apiProfile(params.id!, json);
});
route("GET", "/profiles/:id/export", ({ params }) => {
  const p = profileOf(params.id!);
  const pack: SearchProfilePack = { $schema: "https://search.forkable.dev/schema/pack-1.json", name: platformName(p.platform), platform: p.platform, profiles: [{ ...p, author: p.author === "builtin" ? "builtin" : "community", proposal: undefined }] };
  return new Response(JSON.stringify(pack, null, 2), { status: 200, headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${p.id}.json"` } });
});
route("POST", "/profiles/import", async ({ body }) => {
  const b = body as { pack?: SearchProfilePack; url?: string };
  await sleep(300);
  if (b.url && !b.url.startsWith("https://")) fail(400, "bad_request", "Import URLs must be https.");
  const pack: SearchProfilePack = b.pack ?? { $schema: "https://search.forkable.dev/schema/pack-1.json", name: "Zendesk", platform: "zendesk", profiles: [ZD_PROPOSAL.models[0]!.profile] };
  if (!pack.profiles?.length) fail(400, "invalid_profile", "That file has no profiles.", { report: { ok: false, issues: [{ check: "schema", level: "error", message: "profiles is empty" }] } });
  const importId = `imp_${Date.now().toString(36)}`;
  imports.set(importId, pack);
  const out: ImportPreview = {
    importId, pack, report: { ok: true, issues: [{ check: "schema", level: "ok", message: "Matches profile-1" }] },
    diff: pack.profiles.map((p) => ({ profileId: p.id, status: profileJson(`prf_${p.platform}_${p.model}`) ? "changed" : "new", changedSections: profileJson(`prf_${p.platform}_${p.model}`) ? ["fields"] : [] })),
  };
  return out;
});
route("POST", "/profiles/import/:importId/accept", ({ params }) => {
  const pack = imports.get(params.importId!) ?? fail(404, "not_found", "That import expired.");
  return pack.profiles.map((p) => { const id = `prf_${p.platform}_${p.model}`; userProfiles.set(id, p); return apiProfile(id, p, "import"); });
});
route("POST", "/profiles/validate", ({ body }) => {
  const j = (body as { json: Partial<SearchProfile> }).json;
  const issues: ValidationIssue[] = [];
  if (!j?.list?.idPath) issues.push({ check: "id", level: "error", message: "list.idPath is required" });
  if (!j?.fields?.title) issues.push({ check: "title", level: "error", message: "fields.title is required" });
  if (!j?.fields?.occurredAt) issues.push({ check: "dates", level: "error", message: "fields.occurredAt is required" });
  if (!issues.length) issues.push({ check: "schema", level: "ok", message: "Matches profile-1" });
  return { ok: !issues.some((i) => i.level === "error"), issues };
});
