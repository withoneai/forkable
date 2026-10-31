// The New profile flow (SPEC 10): a draft per platform in profile_drafts. Create
// reads the platform's actions and groups them into models (models.ts), with no
// AI. The user picks models; only their best read actions get docs, a dry run on
// the grant (one page), inference, a proposal (the local Claude Code or Codex,
// Haiku on the grant, fixture or rules) and validation.
// Save writes a user profile, version 1 and one source per chosen model.
// The platform does not have to be in the grant yet: the catalog and docs are
// One's, so the samples come from each action's documented example response, the
// checks that need real records wait for the first run, and the saved sources wait
// as "awaiting_grant" until a sign-in grants the platform (ensureSources).

import { and, eq } from "drizzle-orm";
import type {
  CatalogAction, CatalogModel, CatalogPlatform, CreateDraftInput, DraftEdits, DraftPreview, DraftStep, DryRunResult, GrantedConnection, InferenceHints,
  ItemFacets, NormalizedItem, ProfileDraft, ProposalOutput, SaveDraftInput, SaveDraftResult, SearchProfile, ValidationIssue, ValidationReport,
} from "../contract.js";
import type { ResultRow } from "../api-types.js";
import type { CallCtx, EngineCtx } from "../ctx.js";
import { profileDrafts, profiles as profilesTable, profileVersions } from "../db/schema.js";
import { normalize } from "../engine/normalize.js";
import { SearchError } from "../errors.js";
import { getPath, resolvePath } from "../expr/path.js";
import { toDate } from "../expr/time.js";
import { newId } from "../ids.js";
import { one } from "../one.js";
import { logoUrl, platformName } from "../platforms.js";
import { createSource, pendingKey, upsertProfileVersion } from "../profile/builtins.js";
import { hashProfile, profileActionIds } from "../profile/hash.js";
import { validateProfile } from "../profile/validate.js";
import { actionDoc, connectionsFor, listCatalogActions, toCatalogPlatform, userMode, fetchPlatforms } from "./catalog.js";
import { findResults, inferHints, signalsMore } from "./infer.js";
import { groupModels, MAX_PICKS, modelLabel } from "./models.js";
import { propose, type Candidate } from "./propose.js";

interface DraftInput {
  connection: { key: string; label: string } | null;
  accounts?: { key: string; label: string }[];
  inGrant: boolean;
  models?: CatalogModel[];
  hiddenActions?: number;
  picked?: string[];
  candidates: CatalogAction[];
  samples: Record<string, DryRunResult>;
  responses: Record<string, unknown>;
  docs: Record<string, { knowledge: string; ioSchema?: unknown }>;
  hints: Record<string, InferenceHints>;
  proposedBy: string;
  platformInfo: CatalogPlatform;
}

type Row = typeof profileDrafts.$inferSelect;

/** Strings cut to 300 chars, arrays to 5, depth 8: what a dry run keeps and sends to the model. */
export function trim(v: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 5).map((x) => trim(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trim(x, depth + 1)]));
  return v;
}

function estimateOf(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  for (const p of ["total", "total_count", "totalCount", "count", "meta.total", "paging.total", "totalResults", "@odata.count", "meta.count"]) {
    const v = getPath(data, p);
    if (typeof v === "number" && v >= 0) return v;
  }
  return null;
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== "object" || Array.isArray(patch) || base === null || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k === "fields" || k === "entities" ? v : deepMerge(out[k], v);
  return out as T;
}

function toDraft(r: Row): ProfileDraft {
  const i = r.input as unknown as DraftInput;
  return {
    id: r.id, platform: r.platform, step: r.step, status: r.status, connection: i.connection, inGrant: i.inGrant,
    models: i.models ?? [], accounts: i.accounts ?? (i.connection ? [i.connection] : []), hiddenActions: i.hiddenActions ?? 0, picked: i.picked ?? [], candidates: i.candidates ?? [],
    samples: i.samples ?? {}, proposal: r.proposal ?? null, proposedBy: i.proposedBy ?? r.model ?? "rules", edits: r.edits, validation: r.validation ?? null,
  };
}

async function load(ctx: EngineCtx, userId: string, id: string): Promise<Row> {
  const [r] = await ctx.db.select().from(profileDrafts).where(and(eq(profileDrafts.id, id), eq(profileDrafts.userId, userId)));
  if (!r || r.status === "discarded") throw new SearchError("not_found", "That draft is gone. Start again.");
  return r;
}

export async function getDraft(ctx: EngineCtx, userId: string, id: string): Promise<ProfileDraft> {
  return toDraft(await load(ctx, userId, id));
}

/** The draft's profile for one model: the proposal with the user's edits merged over it. */
export function draftProfile(d: Pick<ProfileDraft, "proposal" | "edits">, profileId: string): SearchProfile | null {
  const m = d.proposal?.models.find((x) => x.profile.id === profileId);
  return m ? deepMerge(m.profile, d.edits.profiles[profileId]) : null;
}

function callCtx(ctx: EngineCtx, userId: string, mode: "fixture" | "connect", conn: { key: string } | null): CallCtx {
  return { db: ctx.db, userId, actor: "mapper", mode, oneConnect: ctx.oneConnect, transport: ctx.transport, connectionKey: conn?.key, emit: (ev) => ctx.emit(userId, ev) };
}

async function runDry(ctx: EngineCtx, userId: string, platform: string, a: CatalogAction, conn: { key: string } | null, mode: "fixture" | "connect"): Promise<{ result: DryRunResult; response: unknown }> {
  const base: DryRunResult = { actionId: a.actionId, status: 0, ok: false, count: 0, estimate: null, sample: [], topLevelKeys: [] };
  if (!a.permitted) return { result: { ...base, error: "Not in your grant" }, response: null };
  const unfilled = [...a.path.matchAll(/\{\{?\s*([\w.-]+)\s*\}?\}/g)].some((m) => !a.pathVars?.[m[1]!]);
  if (mode === "connect" && unfilled) return { result: { ...base, error: "Needs values in its path; Search cannot list it on its own" }, response: null };
  try {
    const r = await one.raw(callCtx(ctx, userId, mode, conn), {
      platform, action: "dry-run", level: "read", actionId: a.actionId, method: a.method.toUpperCase() as "GET", path: mode === "fixture" ? a.path : "",
      ...(a.pathVars ? { pathParams: a.pathVars } : {}),
      ...(a.method.toUpperCase() === "POST" ? { body: {} } : {}), summary: `Dry run: one page of ${a.title}`, cursor: null,
    });
    const { path, rows } = findResults(r.data);
    void path;
    const response = trim(r.data);
    return {
      result: {
        actionId: a.actionId, status: r.status, ok: r.ok, count: rows.length, estimate: estimateOf(r.data), sample: rows.slice(0, 5).map((x) => trim(x)),
        topLevelKeys: r.data && typeof r.data === "object" && !Array.isArray(r.data) ? Object.keys(r.data as object) : [],
        ...(r.ok ? {} : { error: r.blockedByGrant ? "Not in your grant" : `Answered ${r.status}` }),
      },
      response,
    };
  } catch (e) {
    return { result: { ...base, error: String((e as Error).message ?? e).slice(0, 300) }, response: null };
  }
}

/** The documented example response: the ```json block in the docs with the most records. */
export function exampleFromDocs(knowledge: string): unknown {
  let best: { data: unknown; n: number } | null = null;
  // walk the fences line by line so a closing ``` never pairs with the next opening one
  let open: string[] | null = null;
  let lang = "";
  for (const line of knowledge.split(/\r?\n/)) {
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (!open) { if (fence) { open = []; lang = fence[1]!.toLowerCase(); } continue; }
    if (!fence) { open.push(line); continue; }
    const text = open.join("\n");
    open = null;
    if (lang && lang !== "json" && lang !== "jsonc") continue;
    let data: unknown;
    try { data = JSON.parse(text); } catch { continue; }
    if (!data || typeof data !== "object") continue;
    const n = findResults(data).rows.length;
    if (n && (!best || n > best.n)) best = { data, n };
  }
  return best?.data ?? null;
}

/** A dry run without a grant: the docs' example, marked fromDocs. */
function docSample(a: CatalogAction, knowledge: string | undefined): { result: DryRunResult; response: unknown } {
  const data = exampleFromDocs(knowledge ?? "");
  const rows = data ? findResults(data).rows : [];
  return {
    result: {
      actionId: a.actionId, status: 0, ok: true, count: rows.length, estimate: null, sample: rows.slice(0, 5).map((x) => trim(x)), fromDocs: true,
      topLevelKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data as object) : [],
    },
    response: data ? trim(data) : null,
  };
}

async function platformInfo(ctx: EngineCtx, userId: string, platform: string): Promise<CatalogPlatform> {
  const mode = await userMode(ctx, userId);
  const list = mode === "fixture" ? (ctx.world?.catalog.platforms ?? []).map((r) => toCatalogPlatform(r as Record<string, unknown>)) : await fetchPlatforms(ctx).catch(() => []);
  return list.find((p) => p.platform === platform) ?? { platform, name: platformName(platform), image: logoUrl(platform), tags: [], active: true };
}

async function proposeFor(ctx: EngineCtx, userId: string, input: DraftInput, platform: string, mode: "fixture" | "connect", hint?: string): Promise<{ output: ProposalOutput; by: string }> {
  const cands: Candidate[] = input.candidates.filter((c) => input.samples[c.actionId]?.ok).map((c) => ({
    actionId: c.actionId, title: c.title, method: c.method, path: c.path, model: c.model, pathVars: c.pathVars, knowledge: input.docs[c.actionId]?.knowledge ?? "",
    ioSchema: input.docs[c.actionId]?.ioSchema, sample: input.responses[c.actionId], hints: input.hints[c.actionId]!,
  }));
  const settings = await ctx.settingsFor(userId);
  const fixtureKeys = [...(ctx.world?.proposals.keys() ?? [])].filter((k) => k.startsWith(`${platform}.`));
  const p = await propose(callCtx(ctx, userId, mode, input.connection), { platform: input.platformInfo, candidates: cands, model: settings.proposalModel, userId, hint, fixtureKeys, log: ctx.log });
  return { ...p, output: fitToModels(p.output, input, platform) };
}

/** One profile per picked model, named and keyed by it, with the path values the model fills; all picked, so all recommended. */
function fitToModels(out: ProposalOutput, input: DraftInput, platform: string): ProposalOutput {
  if (!input.picked?.length) return out;
  const byAction = new Map(input.candidates.map((c) => [c.actionId, c]));
  const seen = new Set<string>();
  const models: ProposalOutput["models"] = [];
  for (const m of out.models) {
    const c = byAction.get(m.profile.list.actionId);
    // a model outside the picks (a replayed fixture, an eager answer) is dropped
    const key = c?.model;
    if (!c || !key || seen.has(key)) continue;
    seen.add(key);
    const meta = input.models?.find((x) => x.key === key);
    const slugKey = modelLabel(key).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const profile = { ...m.profile, list: { ...m.profile.list } };
    profile.id = `${platform}.${slugKey}`;
    profile.model = slugKey;
    if (!profile.title || /^\S+ \S*objecttype/i.test(profile.title) || profile.title.toLowerCase().includes("{{")) profile.title = `${input.platformInfo.name} ${modelLabel(key).toLowerCase()}`;
    if (profile.kind === "record" && meta && meta.kind !== "record") profile.kind = meta.kind;
    if (c.pathVars) profile.list.pathVars = { ...c.pathVars, ...(profile.list.pathVars ?? {}) };
    // a proposal that reads one page of a list the sample shows paging for (Stripe's has_more) would index only
    // that page and, on a full pass, tombstone the rest: take the paging the inference found
    const hp = input.hints[c.actionId]?.pagination;
    if ((!profile.list.pagination || profile.list.pagination.type === "none") && hp && hp.type !== "none") {
      profile.list.pagination = hp;
      if (hp.type === "lastId" && !profile.list.pageSize) profile.list.pageSize = { param: "limit", value: 100 };
    }
    models.push({ ...m, profile, recommended: true });
  }
  return { models, ...(out.notes ? { notes: out.notes } : {}) };
}

/** Built-in profiles for the platform, keyed by model and by action, so the picker can say "Built in". */
async function builtinIndex(ctx: EngineCtx, platform: string): Promise<Map<string, string>> {
  const rows = await ctx.db.select({ id: profilesTable.id, model: profilesTable.model, json: profileVersions.json })
    .from(profilesTable).leftJoin(profileVersions, eq(profileVersions.id, profilesTable.currentVersionId))
    .where(and(eq(profilesTable.platform, platform), eq(profilesTable.origin, "builtin")));
  const m = new Map<string, string>();
  for (const r of rows) {
    const key = r.model.replace(/-/g, "_").replace(/ies$/, "y").replace(/s$/, "");
    m.set(key, r.json?.id ?? r.id);
    if (r.json?.list.actionId) m.set(`action:${r.json.list.actionId}:${JSON.stringify(r.json.list.pathVars ?? {})}`, r.json.id);
  }
  return m;
}

export async function createDraft(ctx: EngineCtx, userId: string, req: CreateDraftInput): Promise<ProfileDraft> {
  const id = newId("drf");
  const stage = (s: "actions" | "docs" | "dry_run" | "propose" | "validate" | "ready" | "failed", message?: string) => ctx.emit(userId, { type: "draft", draftId: id, stage: s, ...(message ? { message } : {}) });
  const mode = await userMode(ctx, userId);
  const platform = req.platform;
  const conns = await connectionsFor(ctx, userId);
  const conn: GrantedConnection | null = conns.find((c) => c.platform === platform && (!req.connectionKey || c.key === req.connectionKey)) ?? null;
  const info = await platformInfo(ctx, userId, platform);
  const accounts = conns.filter((c) => c.platform === platform).map((c) => ({ key: c.key, label: c.title ?? c.name ?? platformName(platform) }));
  const input: DraftInput = { connection: conn ? { key: conn.key, label: conn.title ?? conn.name ?? platformName(platform) } : null, accounts, inGrant: !!conn, candidates: [], samples: {}, responses: {}, docs: {}, hints: {}, proposedBy: "rules", platformInfo: info };
  await ctx.db.insert(profileDrafts).values({ id, userId, platform, step: "platform", input: input as unknown as Record<string, unknown> });

  try {
    stage("actions", `Reading ${info.name}'s actions`);
    const all = await listCatalogActions(ctx, userId, platform, conn).catch(() => [] as CatalogAction[]);
    const { models, hidden } = groupModels(all, { platformName: info.name, builtin: await builtinIndex(ctx, platform) });
    input.models = models;
    input.hiddenActions = hidden;
    await ctx.db.update(profileDrafts).set({ input: input as unknown as Record<string, unknown>, step: "models", updatedAt: new Date() }).where(eq(profileDrafts.id, id));
    if (req.models?.length) await mapModels(ctx, userId, id, req.models, stage);
    stage("ready", "Ready");
  } catch (e) {
    stage("failed", (e as Error).message);
    throw e;
  }
  return getDraft(ctx, userId, id);
}

type Stage = (s: "actions" | "docs" | "dry_run" | "propose" | "validate" | "ready" | "failed", message?: string) => void;

/** Maps the picked models: docs, one dry-run page and inference for their best read actions, then one proposal for just those. */
async function mapModels(ctx: EngineCtx, userId: string, id: string, keys: string[], stage: Stage): Promise<void> {
  const r = await load(ctx, userId, id);
  const input = r.input as unknown as DraftInput;
  const mode = await userMode(ctx, userId);
  const picked = [...new Set(keys)].filter((k) => input.models?.some((m) => m.key === k));
  if (!picked.length) throw new SearchError("bad_request", "Pick at least one model.");
  if (picked.length > MAX_PICKS) throw new SearchError("bad_request", `Pick up to ${MAX_PICKS} models at a time.`);
  input.picked = picked;
  input.candidates = picked.flatMap((k) => input.models!.find((m) => m.key === k)!.actions);
  const fresh = input.candidates.filter((a) => !input.samples[a.actionId]);
  if (fresh.length) {
    stage("docs", `Loading the docs for ${fresh.length} ${fresh.length === 1 ? "action" : "actions"}`);
    const docs = await Promise.all(fresh.map((a) => actionDoc(ctx, userId, a.actionId)));
    const fullDocs: Record<string, string> = {};
    fresh.forEach((a, i) => { const d = docs[i]; if (d) { input.docs[a.actionId] = { knowledge: d.knowledge.slice(0, 6000), ioSchema: d.ioSchema }; fullDocs[a.actionId] = d.knowledge; } });
    stage("dry_run", input.connection ? "Dry run on your grant, one page each" : `${input.platformInfo.name} is not in your grant yet, so the samples come from its docs`);
    await Promise.all(fresh.map(async (a) => {
      const { result, response } = input.connection ? await runDry(ctx, userId, r.platform, a, input.connection, mode) : docSample(a, fullDocs[a.actionId]);
      input.samples[a.actionId] = result;
      if (result.ok) {
        input.responses[a.actionId] = response;
        input.hints[a.actionId] = inferHints(response, { model: modelLabel(a.model ?? "") || a.title, ioSchema: input.docs[a.actionId]?.ioSchema, knowledge: input.docs[a.actionId]?.knowledge });
      }
    }));
  }
  stage("propose", mode === "fixture" ? "Replaying the sample proposal" : `Mapping ${picked.length} ${picked.length === 1 ? "model" : "models"}`);
  const p = await proposeFor(ctx, userId, input, r.platform, mode);
  input.proposedBy = p.by;
  const edits: DraftEdits = { selected: p.output.models.map((m) => m.profile.id), profiles: {} };
  await ctx.db.update(profileDrafts).set({ input: input as unknown as Record<string, unknown>, proposal: p.output, edits, model: p.by, validation: null, updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  if (p.output.models.length) {
    stage("validate", "Checking ids, dates and links");
    await validateDraft(ctx, userId, id);
  }
}

/** Step 2: the user's models go to the AI. Re-picking keeps the samples already read. */
export async function pickModels(ctx: EngineCtx, userId: string, id: string, keys: string[]): Promise<ProfileDraft> {
  const stage: Stage = (s, message) => ctx.emit(userId, { type: "draft", draftId: id, stage: s, ...(message ? { message } : {}) });
  try {
    await mapModels(ctx, userId, id, keys, stage);
    stage("ready", "Ready");
  } catch (e) {
    stage("failed", (e as Error).message);
    throw e;
  }
  return getDraft(ctx, userId, id);
}

export async function patchDraft(ctx: EngineCtx, userId: string, id: string, body: { step?: DraftStep; edits?: Partial<DraftEdits> }): Promise<ProfileDraft> {
  const r = await load(ctx, userId, id);
  const edits: DraftEdits = body.edits ? { selected: body.edits.selected ?? r.edits.selected, profiles: { ...r.edits.profiles, ...(body.edits.profiles ?? {}) } } : r.edits;
  await ctx.db.update(profileDrafts).set({ ...(body.step ? { step: body.step } : {}), edits, ...(body.edits ? { validation: null } : {}), updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  return getDraft(ctx, userId, id);
}

export async function discardDraft(ctx: EngineCtx, userId: string, id: string): Promise<void> {
  await load(ctx, userId, id);
  await ctx.db.update(profileDrafts).set({ status: "discarded", updatedAt: new Date() }).where(eq(profileDrafts.id, id));
}

export async function dryRun(ctx: EngineCtx, userId: string, id: string, actionId: string): Promise<DryRunResult> {
  const r = await load(ctx, userId, id);
  const input = r.input as unknown as DraftInput;
  const a = input.candidates.find((c) => c.actionId === actionId);
  if (!a) throw new SearchError("not_found", "That action is not one of this draft's candidates.");
  const { result, response } = await runDry(ctx, userId, r.platform, a, input.connection, await userMode(ctx, userId));
  input.samples[actionId] = result;
  if (result.ok) { input.responses[actionId] = response; input.hints[actionId] = inferHints(response, { model: modelLabel(a.model ?? "") || a.title, ioSchema: input.docs[actionId]?.ioSchema }); }
  await ctx.db.update(profileDrafts).set({ input: input as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  return result;
}

export async function reproposeDraft(ctx: EngineCtx, userId: string, id: string, hint?: string): Promise<ProfileDraft> {
  const r = await load(ctx, userId, id);
  const input = r.input as unknown as DraftInput;
  ctx.emit(userId, { type: "draft", draftId: id, stage: "propose", message: "Proposing again" });
  const p = await proposeFor(ctx, userId, input, r.platform, await userMode(ctx, userId), hint);
  input.proposedBy = p.by;
  await ctx.db.update(profileDrafts).set({ input: input as unknown as Record<string, unknown>, proposal: p.output, model: p.by, edits: { selected: p.output.models.filter((m) => m.recommended || input.picked?.length).map((m) => m.profile.id), profiles: {} }, validation: null, updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  ctx.emit(userId, { type: "draft", draftId: id, stage: "ready", message: "Ready" });
  return getDraft(ctx, userId, id);
}

function normEnv(now: Date) {
  return { account: {}, settings: {}, now, selfAddresses: [] as string[] };
}

function settingsDefaults(p: SearchProfile): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p.settings ?? {}).map(([k, s]) => [k, s.default]));
}

function samplesFor(input: DraftInput, p: SearchProfile): Record<string, unknown>[] {
  const s = input.samples[p.list.actionId];
  return (s?.sample ?? []) as Record<string, unknown>[];
}

function previewRow(p: SearchProfile, n: NormalizedItem, i: number): ResultRow {
  const people = n.refs.filter((r) => r.type === "person" && (r.name || r.email)).slice(0, 4).map((r, j) => ({ entityId: `preview_${i}_${j}`, name: r.name ?? r.email!, role: r.role, avatarUrl: null }));
  return {
    id: `preview_${n.externalId}`, kind: n.kind, platform: p.platform, sourceId: "draft", sourceName: platformName(p.platform), logoUrl: logoUrl(p.platform),
    title: n.title, titleHighlights: [], context: n.status ?? n.container, snippet: n.snippet, snippetHighlights: [], occurredAt: n.occurredAt, updatedAt: n.updatedAt, url: n.url,
    people, facets: n.facets as ItemFacets, lane: null, importance: null, groupCount: 1, score: 0, ranks: { kw: null, vec: null, title: null, rerank: null },
  };
}

export async function previewDraft(ctx: EngineCtx, userId: string, id: string, profileId: string): Promise<DraftPreview> {
  const r = await load(ctx, userId, id);
  const d = toDraft(r);
  const p = draftProfile(d, profileId);
  if (!p) throw new SearchError("not_found", "No such model in this draft.");
  const input = r.input as unknown as DraftInput;
  const now = ctx.now();
  const out: DraftPreview["samples"] = [];
  samplesFor(input, p).forEach((rec, i) => {
    try {
      const n = normalize(p, { item: rec, fetchedAt: now.toISOString() }, { ...normEnv(now), settings: settingsDefaults(p) });
      out.push({ externalId: n.externalId, item: n, row: previewRow(p, n, i) });
    } catch { /* a sample that does not normalize shows up in validation */ }
  });
  return { profileId, samples: out };
}

/** SPEC 10.5. sampleIds are the failing samples' external ids, in the order of samples[actionId].sample. */
export async function validateDraft(ctx: EngineCtx, userId: string, id: string): Promise<ValidationReport> {
  const r = await load(ctx, userId, id);
  const d = toDraft(r);
  const input = r.input as unknown as DraftInput;
  const mode = await userMode(ctx, userId);
  const issues: ValidationIssue[] = [];
  const hashes: NonNullable<ValidationReport["hashes"]> = {};
  const now = ctx.now();
  for (const pid of d.edits.selected) {
    const p = draftProfile(d, pid);
    if (!p) { issues.push({ check: "schema", level: "error", message: `${pid} is not in the proposal`, profileId: pid }); continue; }
    // before the grant the records are the docs' example: a miss there warns, the first run decides
    const fromDocs = (check: ValidationIssue["check"]) => !input.connection && ["id", "title", "dates", "link", "pagination", "incremental"].includes(check);
    const add = (check: ValidationIssue["check"], level: ValidationIssue["level"], message: string, sampleIds?: string[]) => issues.push({ check, level: level === "error" && fromDocs(check) ? "warn" : level, message: level === "error" && fromDocs(check) ? `In the docs' example: ${message}` : message, profileId: pid, ...(sampleIds?.length ? { sampleIds } : {}) });
    const st = validateProfile(p);
    const stErr = st.issues.filter((i) => i.level === "error");
    if (stErr.length) for (const e of stErr) add("schema", "error", e.message);
    else add("schema", "ok", "Matches profile-1");
    const a = input.candidates.find((c) => c.actionId === p.list.actionId);
    if (!a) add("actions", "error", `${p.list.actionId} is not one of ${platformName(p.platform)}'s list actions`);
    else if (!a.readOnly) add("actions", "error", `${a.title} writes; Search only reads`);
    else if (!input.connection) add("actions", "warn", `${a.title} is read only. It runs once you grant ${platformName(p.platform)}`);
    else if (!a.permitted) add("actions", "error", `${a.title} is not in your grant`);
    else if (mode === "connect" && a.actionId.startsWith("sample::")) add("actions", "error", "Sample actions run only in the sample");
    else add("actions", "ok", `${a.title} is read only and in the grant`);
    // a fresh one-page dry run
    let dry = input.samples[p.list.actionId];
    if (a && a.permitted && input.connection) dry = (await runDry(ctx, userId, r.platform, a, input.connection, mode)).result;
    if (!input.connection) add("fetch", "warn", dry?.count ? `Not fetched yet. Checked against ${dry.count} example ${dry.count === 1 ? "record" : "records"} from the docs; the first run checks real ones` : "Not fetched yet. The docs have no example, so the first run checks the fields");
    else if (!dry?.ok) add("fetch", "error", dry?.error ?? "The dry run did not answer");
    else add("fetch", dry.count ? "ok" : "warn", dry.count ? `One page returned ${dry.count} records` : "The page was empty");
    const recs = samplesFor(input, p);
    if (!recs.length && !input.connection) {
      add("id", "warn", "Checked on the first run");
      try { hashes[pid] = hashProfile(p); add("hashes", "ok", "fetch, map and index hashes computed"); } catch (e) { add("hashes", "error", (e as Error).message); }
      continue;
    }
    const n = Math.max(1, recs.length);
    const items: { rec: Record<string, unknown>; n: NormalizedItem | null; ext: string }[] = recs.map((rec, i) => {
      const ext = String(getPath(rec, p.list.idPath) ?? `#${i + 1}`);
      try { return { rec, n: normalize(p, { item: rec, fetchedAt: now.toISOString() }, { ...normEnv(now), settings: settingsDefaults(p) }), ext }; } catch { return { rec, n: null, ext }; }
    });
    const ids = recs.map((rec) => getPath(rec, p.list.idPath));
    const okIds = ids.filter((v) => typeof v === "string" || typeof v === "number").map(String);
    const missingId = items.filter((_, i) => !(typeof ids[i] === "string" || typeof ids[i] === "number")).map((x) => x.ext);
    if (!recs.length) add("id", "warn", "No samples to check the id on");
    else if (missingId.length) add("id", "error", `The id is missing on ${missingId.length} of ${recs.length} samples`, missingId);
    else if (new Set(okIds).size !== okIds.length) add("id", "error", `${new Set(okIds).size} of ${okIds.length} unique`);
    else add("id", "ok", `${okIds.length} of ${okIds.length} unique`);
    const untitled = items.filter((x) => !x.n || !x.n.title || x.n.title === "(untitled)");
    add("title", recs.length && (recs.length - untitled.length) / n < 0.8 ? "error" : "ok", recs.length - untitled.length === 0 && recs.length ? "Title needs a field" : `Title on ${recs.length - untitled.length} of ${recs.length}`, untitled.map((x) => x.ext));
    const undated = items.filter((x) => !x.n || !x.n.occurredAt || Math.abs(Date.parse(x.n.occurredAt) - now.getTime()) < 1000);
    add("dates", recs.length && (recs.length - undated.length) / n < 0.8 ? "error" : "ok", `Dates parse on ${recs.length - undated.length} of ${recs.length}`, undated.map((x) => x.ext));
    if (p.fields.url) {
      const bad = items.filter((x) => !x.n?.url || !/^https:\/\//.test(x.n.url));
      // an API address answers JSON to a browser: it "resolves" but opens nothing a person can read
      const api = items.filter((x) => x.n?.url && isApiUrl(x.n.url));
      if (!bad.length && api.length) add("link", "warn", `This opens ${platformName(p.platform)}'s API, not the app. Results would open raw data.`, api.map((x) => x.ext));
      else add("link", recs.length && (recs.length - bad.length) / n < 0.8 ? "error" : "ok", bad.length ? `Link template does not resolve on ${bad.length} of ${recs.length} samples` : `Link opens on ${recs.length} of ${recs.length}`, bad.map((x) => x.ext));
    } else add("link", "warn", `No link. Results will not open in ${platformName(p.platform)}.`);
    const pg = p.list.pagination;
    if (pg.type === "none") {
      // the sample says there is more, but the map reads one page: it would index a slice and lose the rest
      if (signalsMore(input.responses[p.list.actionId])) add("pagination", "error", "The list has more pages, but the map reads only the first");
      else add("pagination", "ok", "One page");
    }
    else {
      const resp = input.responses[p.list.actionId];
      const next = pg.type === "cursor" || pg.type === "nextUrl" ? resolvePath(resp, pg.next) : pg.type === "relay" ? resolvePath(resp, pg.endCursor) : [true];
      const full = (dry?.count ?? 0) >= 5 && dry?.count !== 0;
      add("pagination", next.length || !full ? "ok" : "warn", next.length ? `Next page from ${"next" in pg ? pg.next : pg.type}` : "No next page on the first page");
    }
    if (p.incremental.strategy === "watermark") {
      const f = p.incremental.field;
      const bad = items.filter((x) => { const v = resolvePath({ item: x.rec }, f)[0]; return v === undefined || v === null || toDate(v) === null; });
      add("incremental", recs.length && (recs.length - bad.length) / n < 0.8 ? "error" : "ok", bad.length ? `The watermark ${f} does not parse on ${bad.length} of ${recs.length}` : `Watermark on ${f.replace(/^item\./, "")}`, bad.map((x) => x.ext));
    } else add("incremental", "ok", p.incremental.strategy === "full" ? "Full list every run" : "Delta token");
    const big = items.filter((x) => (x.n?.body.length ?? 0) >= 200_000);
    add("size", big.length ? "error" : "ok", big.length ? "A body is over 200,000 characters" : "Bodies under 200,000 characters", big.map((x) => x.ext));
    try { hashes[pid] = hashProfile(p); add("hashes", "ok", "fetch, map and index hashes computed"); } catch (e) { add("hashes", "error", (e as Error).message); }
  }
  if (!d.edits.selected.length) issues.push({ check: "schema", level: "error", message: "Pick at least one model" });
  const report: ValidationReport = { ok: !issues.some((i) => i.level === "error"), issues, hashes };
  await ctx.db.update(profileDrafts).set({ validation: report, updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  return report;
}

/** The actions the draft's chosen profiles call, so the Connect ask can name exactly those. */
export async function draftActionIds(ctx: EngineCtx, userId: string, id: string, profileIds?: string[]): Promise<{ platform: string; actionIds: string[] }> {
  const r = await load(ctx, userId, id);
  const d = toDraft(r);
  const want = profileIds?.length ? profileIds : d.edits.selected;
  const ids = new Set<string>();
  for (const pid of want) { const p = draftProfile(d, pid); if (p) profileActionIds(p).forEach((x) => ids.add(x)); }
  return { platform: r.platform, actionIds: [...ids] };
}

/** An API address rather than a page: an api. host, or a versioned REST path. */
export function isApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^api[.-]|\.api\.|^graph\.|^www\.googleapis\./i.test(u.hostname) || /\/(v\d+(\.\d+)?|\d{4}-\d{2}(-\d{2})?)\//i.test(u.pathname) && /\/(crm|objects|api)\//i.test(u.pathname);
  } catch { return false; }
}

export async function saveDraft(ctx: EngineCtx, userId: string, id: string, body: SaveDraftInput): Promise<SaveDraftResult> {
  const r = await load(ctx, userId, id);
  if (r.status === "saved") throw new SearchError("conflict", "This draft is already saved.");
  const d = toDraft(r);
  const want = body.profiles?.length ? body.profiles : d.edits.selected;
  if (!want.length) throw new SearchError("bad_request", "Pick at least one model.");
  // validate exactly what is being saved
  await ctx.db.update(profileDrafts).set({ edits: { ...d.edits, selected: want } }).where(eq(profileDrafts.id, id));
  const report = await validateDraft(ctx, userId, id);
  if (!report.ok) throw new SearchError("invalid_profile", "Fix the errors before saving.", { report });
  const input = r.input as unknown as DraftInput;
  const mode = await userMode(ctx, userId);
  // not granted yet: the sources wait, and the sign-in that grants the platform attaches them
  const conn = input.connection ?? { key: pendingKey(r.platform), label: `Waiting for ${platformName(r.platform)} in your grant` };
  const out: SaveDraftResult = { profileIds: [], sourceIds: [], firstRunIds: [] };
  for (const pid of want) {
    const base = draftProfile(d, pid)!;
    // the platform is granted, but not every action this profile calls (a new model on a
    // custom ask): the source waits like an ungranted one, and the next sign-in attaches it
    const ungranted = !!input.connection && mode === "connect" && profileActionIds(base).some((a) => input.candidates.find((c) => c.actionId === a)?.permitted === false);
    const waits = !input.connection || ungranted;
    // granted: one source per chosen account (every account when none are named); waiting: one pending row,
    // which the granting sign-in copies to every account (ensureSources)
    const accounts = input.accounts?.length ? input.accounts : [conn];
    const chosen = body.connectionKeys?.length ? accounts.filter((a) => body.connectionKeys!.includes(a.key)) : accounts;
    if (!waits && !chosen.length) throw new SearchError("bad_request", "Pick at least one account.");
    const targets = waits ? [{ key: pendingKey(r.platform), label: `Waiting for ${platformName(r.platform)} in your grant` }] : chosen;
    const p: SearchProfile = {
      ...base, title: want.length === 1 && body.name?.trim() ? body.name.trim() : base.title, author: userId, revision: 1, verified: base.verified ?? "none",
      proposal: { by: input.proposedBy, draftId: id, at: ctx.now().toISOString() },
    };
    const v = await upsertProfileVersion(ctx.db, userId, p, "user", userId, "Made in New profile");
    out.profileIds.push(v.profileId);
    for (const t of targets) out.sourceIds.push(await createSource(ctx.db, { userId, platform: r.platform, connectionKey: t.key, connectionLabel: t.label, profileId: v.profileId, versionId: v.versionId, profile: p, mode, awaitingGrant: waits }));
    if (waits) out.awaitingGrant = true;
  }
  await ctx.db.update(profileDrafts).set({ status: "saved", step: "review", updatedAt: new Date() }).where(eq(profileDrafts.id, id));
  return out;
}

/** The dry-run estimate of a saved source's first run, for the progress line. */
export async function draftEstimate(ctx: EngineCtx, userId: string, id: string, actionId: string): Promise<number | null> {
  const r = await load(ctx, userId, id).catch(() => null);
  const s = (r?.input as unknown as DraftInput | undefined)?.samples?.[actionId];
  return s?.estimate ?? s?.count ?? null;
}
