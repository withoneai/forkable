// One run = one source (one profile on one connection). Per page, so a crash loses at most
// one page (SPEC 7.1): fetch, extract, hydrate, store raw, normalize, entities, chunk,
// upsert, tombstone, checkpoint; then reconcile, commit cursors, record health.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import pg from "pg";
import type { Incremental, NormalizeEnv, PartitionSpec, ProfileSetting, RawRecord, RunOptions, RunOutcome, RunSummary, SearchProfile, SourceError, SourceHealth, SourceStatus } from "../contract.js";
import type { CallCtx, EngineCtx } from "../ctx.js";
import type { Db, Tx } from "../db/client.js";
import { chunks, entityLinks, items, pendingEmbeddings, profileVersions, rawItems, runs, selfAddresses, sourceCursors, sources } from "../db/schema.js";
import { decodeDomain } from "../decode/address.js";
import { getPath, resolvePath } from "../expr/path.js";
import { evalPredicate } from "../expr/predicate.js";
import { renderTemplate, type TemplateCtx } from "../expr/template.js";
import { parseDuration, toDate } from "../expr/time.js";
import { newId } from "../ids.js";
import { LedgerRollup } from "../ledger.js";
import { canonicalJson, effectiveFetchHash, fetchIsStale, fetchSettingsKeys, hashProfile, sha16 } from "../profile/hash.js";
import { markSelf, recountEntities, resolveItemEntities, type ResolveEnv } from "../entities/resolve.js";
import { chunkItem } from "./chunk.js";
import { fetchWithPolicy, RunStop, type Limiter } from "./fetch.js";
import { normalize } from "./normalize.js";
import { applyCursor, nextPage } from "./paginate.js";
import { signalsMore } from "../mapper/infer.js";
import { applyParam, buildRequest, queryFromUrl, toCallInput, type BuiltRequest } from "./request.js";

type SourceRow = typeof sources.$inferSelect;

const MAX_STRING = 256 * 1024;

/** Strips strings over 256 KB and base64 attachment bodies before storing raw payloads. */
export function stripLarge(v: unknown, key = ""): unknown {
  if (typeof v === "string") {
    if (v.length > MAX_STRING) return `[stripped ${v.length} chars]`;
    if (/^(data|attachment|content_bytes|contentBytes)$/i.test(key) && v.length > 2048 && /^[A-Za-z0-9+/_=-]+$/.test(v.slice(0, 2048))) return "[stripped base64]";
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => stripLarge(x));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    // A MIME text part (Gmail payload) keeps its base64url body: it is the message
    // text the mime-body decoder reads, not an attachment.
    const textPart = typeof (v as { mimeType?: unknown }).mimeType === "string" && /^text\//i.test((v as { mimeType: string }).mimeType) && !(v as { filename?: unknown }).filename;
    for (const [k, x] of Object.entries(v)) {
      const body = textPart && k === "body" && x && typeof x === "object" && typeof (x as { data?: unknown }).data === "string" ? (x as Record<string, unknown>) : null;
      out[k] = body ? { ...(stripLarge({ ...body, data: undefined }) as object), data: (body.data as string).length > MAX_STRING ? `[stripped ${(body.data as string).length} chars]` : body.data } : stripLarge(x, k);
    }
    return out;
  }
  return v;
}

export function settingsFor(profile: SearchProfile, overrides: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(profile.settings ?? {}) as [string, ProfileSetting][]) out[k] = s.default;
  return { ...out, ...(overrides ?? {}) };
}

function scheduleMs(profile: SearchProfile): number {
  return parseDuration(profile.schedule?.every ?? "30m") ?? 30 * 60_000;
}

function asArray(data: unknown, resultsPath: string): unknown[] {
  if (resultsPath === "" || resultsPath === "$" || resultsPath === ".") return Array.isArray(data) ? data : [];
  const v = resolvePath(data, resultsPath);
  if (v.length === 1 && Array.isArray(v[0])) return v[0] as unknown[];
  return v;
}

interface PartitionRef { key: string; element: unknown }

interface Counters { pages: number; fetched: number; hydrated: number; upserted: number; unchanged: number; tombstoned: number; skipped: number; calls: number; retries: number }

interface RunState {
  ctx: EngineCtx;
  db: Db;
  source: SourceRow;
  profile: SearchProfile;
  versionHashes: { fetchHash: string; mapHash: string; indexHash: string };
  call: CallCtx;
  limiter: Limiter;
  settings: Record<string, unknown>;
  /** The resolved settings the hydrate request reads, folded into every fingerprint ("" when none). */
  hydrateKey: string;
  account: Record<string, unknown>;
  env: NormalizeEnv;
  resolveEnv: ResolveEnv;
  counters: Counters;
  full: boolean;
  now: Date;
  sleep: (ms: number) => Promise<void>;
  embedModel: string | null;
  touchedEntities: Set<string>;
  added: number;
  updated: number;
  removed: number;
  runId: string;
  onProgress?: RunOptions["onProgress"];
  progressAt: number;
  countAt: number;
}

// ---------- live progress ----------

const PROGRESS_EVERY_MS = 2_000;
const COUNT_EVERY_MS = 5_000;

/**
 * After each page: the run's counters go to its runs row (every 2 s) and the
 * source's item count is refreshed (every 5 s), so the source page and the Runs
 * tab show a long backfill moving instead of zeros until it ends. Never throws.
 */
async function reportProgress(st: RunState, force = false): Promise<void> {
  const t = Date.now();
  if (!force && t - st.progressAt < PROGRESS_EVERY_MS) return;
  st.progressAt = t;
  try {
    await st.db.update(runs).set({ ...st.counters }).where(eq(runs.id, st.runId));
    let itemCount: number | undefined;
    if (force || t - st.countAt >= COUNT_EVERY_MS) {
      st.countAt = t;
      const [{ n } = { n: 0 }] = await st.db.select({ n: sql<number>`count(*)::int` }).from(items)
        .where(and(eq(items.sourceId, st.source.id), isNull(items.deletedAt), eq(items.directory, false)));
      itemCount = n;
      await st.db.update(sources).set({ itemCount: n }).where(eq(sources.id, st.source.id));
    }
    st.onProgress?.({ runId: st.runId, ...st.counters, ...(itemCount !== undefined ? { itemCount } : {}) });
  } catch { /* progress is best effort; the run's own writes still happen */ }
}

// ---------- persistence helpers ----------

async function tombstoneItem(tx: Tx, st: RunState, itemId: string, rawId: string | null): Promise<void> {
  const now = st.now;
  await tx.update(items).set({ deletedAt: now }).where(eq(items.id, itemId));
  if (rawId) await tx.update(rawItems).set({ deletedAt: now }).where(eq(rawItems.id, rawId));
  await deleteChunks(tx, st, itemId);
}

async function deleteChunks(tx: Tx, st: RunState, itemId: string, ids?: string[]): Promise<void> {
  const rows = ids ?? (await tx.select({ id: chunks.id }).from(chunks).where(eq(chunks.itemId, itemId))).map((r) => r.id);
  if (!rows.length) return;
  await tx.delete(pendingEmbeddings).where(inArray(pendingEmbeddings.chunkId, rows));
  if (st.ctx.capability.mode === "hybrid") await tx.execute(sql`delete from chunk_embeddings where chunk_id in (${sql.join(rows.map((r) => sql`${r}`), sql`, `)})`);
  await tx.delete(chunks).where(inArray(chunks.id, rows));
}

/** Normalizes one raw record and writes the item, its entities and chunks. */
export async function upsertNormalized(tx: Tx, st: RunState, rawId: string, raw: RawRecord): Promise<"added" | "updated" | "unchanged" | "tombstoned" | "skipped"> {
  const n = normalize(st.profile, raw, st.env);
  if (!n.externalId) return "skipped";
  const [existing] = await tx.select({ id: items.id, contentHash: items.contentHash, deletedAt: items.deletedAt, occurredAt: items.occurredAt }).from(items)
    .where(and(eq(items.sourceId, st.source.id), eq(items.externalId, n.externalId)));
  // a record with no date keeps the day Search first saw it, so a re-fetch is not a change (D45)
  if (n.occurredAtGuessed && existing && !existing.deletedAt) n.occurredAt = existing.occurredAt.toISOString();
  const { occurredAtGuessed: _guessed, ...hashed } = n;
  if (n.deleted) {
    if (existing && !existing.deletedAt) { await tombstoneItem(tx, st, existing.id, rawId); return "tombstoned"; }
    if (!existing) await tx.update(rawItems).set({ deletedAt: st.now }).where(eq(rawItems.id, rawId));
    return existing ? "unchanged" : "skipped";
  }
  const contentHash = sha16(canonicalJson(hashed) + st.versionHashes.mapHash);
  if (existing && existing.contentHash === contentHash && !existing.deletedAt) return "unchanged";
  const directory = !!st.profile.entities?.directory && !n.is?.email;
  const values = {
    userId: st.source.userId, sourceId: st.source.id, rawItemId: rawId, externalId: n.externalId, platform: st.source.platform,
    kind: n.kind, title: n.title, body: n.body, snippet: n.snippet, url: n.url, container: n.container, groupKey: n.groupKey,
    status: n.status, labels: n.labels, facets: n.facets, occurredAt: new Date(n.occurredAt), updatedAt: n.updatedAt ? new Date(n.updatedAt) : null,
    deletedAt: null, mapHash: st.versionHashes.mapHash, bodyHash: sha16(n.body), contentHash, directory, indexedAt: st.now,
  };
  let itemId: string;
  if (existing) {
    itemId = existing.id;
    await tx.update(items).set(values).where(eq(items.id, itemId));
    await tx.delete(entityLinks).where(and(eq(entityLinks.itemId, itemId), eq(entityLinks.sourceId, st.source.id)));
  } else {
    itemId = newId("itm");
    await tx.insert(items).values({ id: itemId, ...values });
  }
  for (const id of await resolveItemEntities(tx, st.resolveEnv, itemId, n)) st.touchedEntities.add(id);

  // chunks: unchanged text_hash at the same ord keeps its row (and its embedding)
  const drafts = chunkItem(n, st.profile, raw, st.env);
  const old = await tx.select({ id: chunks.id, ord: chunks.ord, textHash: chunks.textHash }).from(chunks).where(eq(chunks.itemId, itemId));
  const byOrd = new Map(old.map((c) => [c.ord, c]));
  const drop: string[] = [];
  for (const c of old) if (c.ord >= drafts.length || drafts[c.ord]!.textHash !== c.textHash) drop.push(c.id);
  if (drop.length) await deleteChunks(tx, st, itemId, drop);
  for (const d of drafts) {
    const prev = byOrd.get(d.ord);
    if (prev && prev.textHash === d.textHash) continue;
    const id = newId("chk");
    await tx.insert(chunks).values({ id, itemId, userId: st.source.userId, ord: d.ord, text: d.text, textHash: d.textHash, tokens: d.tokens });
    if (st.embedModel) await tx.insert(pendingEmbeddings).values({ chunkId: id, userId: st.source.userId, model: st.embedModel }).onConflictDoNothing();
  }
  return existing && !existing.deletedAt ? "updated" : "added";
}

// ---------- fetch helpers ----------

async function fetchPage(st: RunState, req: BuiltRequest, action: string, meta: { cursor: string | null; partition: string | null; delta?: string | null }, opts: { notFoundOk?: boolean; passStatuses?: number[] } = {}) {
  const input = toCallInput(req, { platform: st.source.platform, action, summary: `${action} ${st.profile.title} for search`, cursor: meta.cursor, partition: meta.partition, delta: meta.delta ?? null });
  const r = await fetchWithPolicy(st.call, input, { limiter: st.limiter, sleep: st.sleep, ...opts });
  st.counters.calls += r.calls;
  st.counters.retries += r.retries;
  return r.res;
}

function tctx(st: RunState, extra: Record<string, unknown>): TemplateCtx {
  return { account: st.account, settings: st.settings, now: st.now, ...extra };
}

/** One titles connections with the platform name ("Gmail"), so two accounts look alike. The account's own
 *  address names it instead, on every source of that connection (D46). */
async function labelWithAddress(st: RunState, vars: Record<string, unknown>): Promise<void> {
  const v = (st.profile.account?.self ?? []).filter((s) => s.kind === "email").map((s) => vars[s.var]).find((x): x is string => typeof x === "string" && x.includes("@"));
  if (!v || st.source.connectionLabel.includes("@")) return;
  const label = v.trim().toLowerCase();
  await st.db.update(sources).set({ connectionLabel: label })
    .where(and(eq(sources.userId, st.source.userId), eq(sources.connectionKey, st.source.connectionKey), sql`position('@' in ${sources.connectionLabel}) = 0`));
  st.source = { ...st.source, connectionLabel: label };
}

async function resolveAccount(st: RunState): Promise<void> {
  const acc = st.profile.account;
  const cached = st.source.accountVars;
  const fresh = st.source.accountVarsAt && st.now.getTime() - st.source.accountVarsAt.getTime() < 24 * 3_600_000;
  if (!acc) { st.account = cached ?? {}; return; }
  if (cached && fresh) { st.account = cached; await labelWithAddress(st, cached); return; }
  try {
    const req = buildRequest(acc.request, tctx(st, {}));
    const res = await fetchPage(st, req, "account", { cursor: null, partition: null });
    const vars: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(acc.vars)) { const v = getPath(res.data, p); if (v !== undefined) vars[k] = v; }
    st.account = vars;
    await st.db.update(sources).set({ accountVars: vars, accountVarsAt: st.now }).where(eq(sources.id, st.source.id));
    await labelWithAddress(st, vars);
    for (const s of acc.self ?? []) {
      const v = vars[s.var];
      if (typeof v !== "string" || !v) continue;
      // ext values are stored as entity keys spell them: "<platform>:<id>", lowercased (ext:slack:u01dana)
      const value = s.kind === "email" ? v.toLowerCase() : s.kind === "domain" ? (decodeDomain(v) ?? v.toLowerCase()) : (v.includes(":") ? v : `${st.source.platform}:${v}`).toLowerCase();
      await st.db.insert(selfAddresses).values({ userId: st.source.userId, kind: s.kind, value, sourceId: st.source.id }).onConflictDoNothing();
      if (s.kind === "email") {
        const d = decodeDomain(value);
        if (d) await st.db.insert(selfAddresses).values({ userId: st.source.userId, kind: "domain", value: d, sourceId: st.source.id }).onConflictDoNothing();
      }
    }
  } catch (e) {
    if (acc.optional && !(e instanceof RunStop && (e.kind === "auth_needed"))) { st.account = cached ?? {}; return; }
    throw e;
  }
}

async function loadSelf(db: Db, userId: string): Promise<{ emails: Set<string>; domains: Set<string>; exts: Set<string> }> {
  const rows = await db.select().from(selfAddresses).where(eq(selfAddresses.userId, userId));
  return {
    emails: new Set(rows.filter((r) => r.kind === "email").map((r) => r.value)),
    domains: new Set(rows.filter((r) => r.kind === "domain").map((r) => r.value)),
    exts: new Set(rows.filter((r) => r.kind === "ext").map((r) => r.value.toLowerCase())),
  };
}

async function listPartitions(st: RunState, spec: PartitionSpec, parent: unknown): Promise<PartitionRef[]> {
  const ctxBase = tctx(st, { partition: parent, run: { now: st.now, full: st.full } });
  const req = buildRequest(spec, ctxBase);
  const out: PartitionRef[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const res = await fetchPage(st, req, "partitions", { cursor, partition: parent ? String(getPath(parent, "__key") ?? "") || null : null });
    const els = asArray(res.data, spec.resultsPath);
    for (const el of els) {
      if (spec.keep && !evalPredicate(spec.keep, { ...ctxBase, partition: el, item: el })) continue;
      const key = String(getPath(el, spec.idPath) ?? "");
      if (!key) continue;
      const element = parent && typeof el === "object" ? { ...(el as object), parent, __key: key } : typeof el === "object" ? { ...(el as object), __key: key } : el;
      out.push({ key, element });
    }
    const next = nextPage(spec.pagination, res.data, { page, offset: out.length, pageSize: null }, els);
    if (!next) break;
    next.apply(req);
    cursor = next.cursor;
  }
  if (spec.order) {
    const { by, dir } = spec.order;
    out.sort((a, b) => {
      const va = getPath(a.element, by), vb = getPath(b.element, by);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""));
      return dir === "desc" ? -c : c;
    });
  }
  const max = typeof spec.max === "string" ? Number(renderTemplate(spec.max, ctxBase)) : spec.max;
  const limited = max && Number.isFinite(max) ? out.slice(0, max) : out;
  if (!spec.next) return limited;
  const nested: PartitionRef[] = [];
  for (const p of limited) for (const c of await listPartitions(st, spec.next, p.element)) nested.push({ key: `${p.key}/${c.key}`, element: c.element });
  return nested;
}

// ---------- hydrate ----------

async function hydrateOne(st: RunState, item: unknown, partition: PartitionRef, prev: { fingerprint: string | null; detail: unknown; children: Record<string, unknown[]> | null } | undefined): Promise<{ detail?: unknown; children?: Record<string, unknown[]>; fingerprint: string | null; gone: boolean; reused: boolean }> {
  const h = st.profile.hydrate!;
  const ctxI = tctx(st, { item, partition: partition.element });
  if (h.when && !evalPredicate(h.when, ctxI)) return { fingerprint: null, gone: false, reused: true };
  const fp = h.fingerprint ? renderTemplate(h.fingerprint, ctxI) : null;
  // a setting the request reads (Granola's include=transcript) changes what comes back, so it is part of "unchanged"
  const fingerprint = fp !== null && st.hydrateKey ? `${fp}#s=${st.hydrateKey}` : fp;
  if (prev && fingerprint !== null && prev.fingerprint === fingerprint && prev.detail !== null && prev.detail !== undefined) {
    return { detail: prev.detail, children: prev.children ?? undefined, fingerprint, gone: false, reused: true };
  }
  const req = buildRequest(h.request, ctxI);
  const res = await fetchPage(st, req, "hydrate", { cursor: null, partition: partition.key || null }, { notFoundOk: h.notFoundIsDelete !== false });
  if (res.status === 404 || res.status === 410) return { fingerprint, gone: true, reused: false };
  const detail = h.resultsPath ? getPath(res.data, h.resultsPath) : res.data;
  const children: Record<string, unknown[]> = {};
  for (const c of h.children ?? []) {
    if (c.when && !evalPredicate(c.when, { ...ctxI, detail })) continue;
    const creq = buildRequest(c.request, { ...ctxI, detail });
    const list: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < (c.maxPages ?? 5); page++) {
      const cres = await fetchPage(st, creq, `children:${c.as}`, { cursor, partition: partition.key || null }, { notFoundOk: true });
      if (cres.status === 404 || cres.status === 410) break;
      const els = asArray(cres.data, c.resultsPath);
      list.push(...els);
      const next = c.pagination ? nextPage(c.pagination, cres.data, { page, offset: list.length, pageSize: null }, els) : null;
      if (!next) break;
      next.apply(creq);
      cursor = next.cursor;
    }
    children[c.as] = list;
  }
  return { detail: stripLarge(detail), children: Object.keys(children).length ? (stripLarge(children) as Record<string, unknown[]>) : undefined, fingerprint, gone: false, reused: false };
}

async function processItems(st: RunState, list: unknown[], partition: PartitionRef, seen: Set<string>): Promise<{ maxField: Date | null }> {
  const p = st.profile;
  const ids = list.map((it) => String(getPath(it, p.list.idPath) ?? ""));
  const valid = ids.filter(Boolean);
  const prevRows = valid.length ? await st.db.select({ id: rawItems.id, externalId: rawItems.externalId, fingerprint: rawItems.fingerprint, detail: rawItems.detail, children: rawItems.children })
    .from(rawItems).where(and(eq(rawItems.sourceId, st.source.id), inArray(rawItems.externalId, valid))) : [];
  const prev = new Map(prevRows.map((r) => [r.externalId, r]));

  // hydrate in batches of `concurrency`
  const hyd = new Map<number, Awaited<ReturnType<typeof hydrateOne>>>();
  if (p.hydrate) {
    const conc = p.hydrate.concurrency ?? 4;
    for (let i = 0; i < list.length; i += conc) {
      const batch = list.slice(i, i + conc).map((it, j) => ({ it, idx: i + j })).filter(({ idx }) => ids[idx]);
      const done = await Promise.all(batch.map(async ({ it, idx }) => [idx, await hydrateOne(st, it, partition, prev.get(ids[idx]!) as never)] as const));
      for (const [idx, r] of done) { hyd.set(idx, r); if (!r.reused && !r.gone) st.counters.hydrated++; }
    }
  }

  let maxField: Date | null = null;
  const inc = p.incremental;
  await st.db.transaction(async (tx) => {
    for (let i = 0; i < list.length; i++) {
      const externalId = ids[i]!;
      if (!externalId) { st.counters.skipped++; continue; }
      seen.add(`${partition.key}\u0000${externalId}`);
      const item = stripLarge(list[i]);
      const h = hyd.get(i);
      const raw: RawRecord = { item, detail: h?.detail, children: h?.children, partition: partition.element, fetchedAt: st.now.toISOString() };
      if (inc.strategy === "watermark") {
        const d = toDate(resolvePath({ item, detail: h?.detail, children: h?.children ?? {} }, inc.field.replace(/^(item|detail|children)\./, "$1.")).find((v) => v !== undefined));
        if (d && (!maxField || d > maxField)) maxField = d;
      }
      const values = {
        sourceId: st.source.id, externalId, partitionKey: partition.key, item: item as object, detail: (h?.detail ?? null) as object | null,
        children: h?.children ?? null, partition: (partition.element ?? null) as object | null, fingerprint: h?.fingerprint ?? null,
        fetchHash: st.versionHashes.fetchHash, fetchedAt: st.now, deletedAt: null,
      };
      const existing = prev.get(externalId);
      let rawId: string;
      if (existing) { rawId = existing.id; await tx.update(rawItems).set(values).where(eq(rawItems.id, rawId)); }
      else { rawId = newId("raw"); await tx.insert(rawItems).values({ id: rawId, ...values }); }
      if (h?.gone) {
        const [it] = await tx.select({ id: items.id, deletedAt: items.deletedAt }).from(items).where(and(eq(items.sourceId, st.source.id), eq(items.externalId, externalId)));
        if (it && !it.deletedAt) { await tombstoneItem(tx, st, it.id, rawId); st.counters.tombstoned++; st.removed++; }
        else await tx.update(rawItems).set({ deletedAt: st.now }).where(eq(rawItems.id, rawId));
        continue;
      }
      const r = await upsertNormalized(tx, st, rawId, raw);
      if (r === "added") { st.counters.upserted++; st.added++; }
      else if (r === "updated") { st.counters.upserted++; st.updated++; }
      else if (r === "unchanged") st.counters.unchanged++;
      else if (r === "tombstoned") { st.counters.tombstoned++; st.removed++; }
      else st.counters.skipped++;
    }
  });
  return { maxField };
}

// ---------- partitions ----------

interface PartitionResult { completed: boolean; stop?: RunStop; capped: boolean; since: Date | null }

function initialSince(inc: Incremental, st: RunState): Date | null {
  const initial = "initial" in inc && inc.initial ? renderTemplate(inc.initial, tctx(st, {})) ?? inc.initial : null;
  const fallback = st.settings.backfill as string | undefined;
  const d = parseDuration(initial ?? fallback ?? "365d");
  if (d === null || d === Number.POSITIVE_INFINITY) return new Date(0);
  return new Date(st.now.getTime() - d);
}

async function runPartition(st: RunState, part: PartitionRef, seen: Set<string>, maxPages: number): Promise<PartitionResult> {
  const p = st.profile;
  const inc = p.incremental;
  const [cur] = await st.db.select().from(sourceCursors).where(and(eq(sourceCursors.sourceId, st.source.id), eq(sourceCursors.partitionKey, part.key)));
  const watermark = cur?.watermark ? toDate(cur.watermark) : null;
  let token = cur?.deltaToken ?? null;
  const partFull = st.full || (inc.strategy === "watermark" && !watermark) || (inc.strategy === "delta" && !token) || inc.strategy === "full";

  let since: Date | null = null;
  if (inc.strategy === "watermark") {
    if (!partFull && watermark) since = new Date(watermark.getTime() - (parseDuration(inc.overlap ?? "0m") ?? 0));
    else since = initialSince(inc, st);
  } else if (inc.strategy === "delta") {
    since = initialSince(inc, st);
  }

  const build = (sinceAt: Date | null): { req: BuiltRequest; first: string | null } => {
    const ahead = parseDuration(String(st.settings.lookahead ?? "0m")) ?? 0;
    const until = new Date(st.now.getTime() + (Number.isFinite(ahead) ? ahead : 0));
    const ctxR = tctx(st, { partition: part.element, run: { since: sinceAt ?? new Date(0), until, now: st.now, full: partFull }, cursor: { watermark: cur?.watermark ?? null, token } });
    const useBootstrap = inc.strategy === "delta" && (!token || partFull) && inc.bootstrap;
    const spec = useBootstrap ? { ...p.list, ...inc.bootstrap } : p.list;
    const req = buildRequest(spec, ctxR);
    if (p.list.pageSize) {
      const per = p.limits?.perAction?.[req.actionId]?.pageSize;
      applyParam(req, `${p.list.pageSize.in ?? "query"}:${p.list.pageSize.param}`, per ?? p.list.pageSize.value);
    }
    let first: string | null = null;
    if (inc.strategy === "delta" && token && !partFull) {
      if (inc.tokenPassAs === "url" || /^https?:\/\//.test(token)) req.query = { ...queryFromUrl(token) };
      else applyParam(req, inc.tokenPassAs ?? "query:syncToken", token);
      first = token;
    }
    return { req, first };
  };

  let { req, first } = build(since);
  let cursor: string | null = null;
  let deltaSent: string | null = first;
  let page = 0;
  let offset = 0;
  const resume = cur?.pageCursor as { cursor?: string; since?: string | null; page?: number; offset?: number } | null | undefined;
  if (resume?.cursor && st.full === false) {
    since = resume.since ? new Date(resume.since) : since;
    ({ req } = build(since));
    applyCursor(p.list.pagination, req, resume.cursor);
    cursor = resume.cursor;
    page = resume.page ?? 0;
    offset = resume.offset ?? 0;
  }

  let maxSeen: Date | null = null;
  let newToken: string | null = null;
  let fetchedInQuery = 0;
  let resetDone = false;
  let truncated = false;
  const pageSizeVal = p.list.pageSize?.value ?? null;
  const cap = inc.strategy === "watermark" ? inc.restartOnCap : undefined;

  try {
    for (let n = 0; ; n++) {
      if (n >= maxPages) return { completed: false, capped: true, since };
      const passStatuses = inc.strategy === "delta" ? inc.resetOn ?? [410] : undefined;
      const res = await fetchPage(st, req, "list", { cursor, partition: part.key || null, delta: deltaSent }, { passStatuses });
      if (inc.strategy === "delta" && res.status >= 400) {
        if (resetDone) throw new RunStop("page_failed", "upstream_error", `delta reset failed (${res.status})`, { status: res.status });
        // the provider dropped our token: start over with a full pass
        resetDone = true;
        token = null;
        await st.db.update(sourceCursors).set({ deltaToken: null, pageCursor: null }).where(and(eq(sourceCursors.sourceId, st.source.id), eq(sourceCursors.partitionKey, part.key)));
        since = initialSince(inc, st);
        ({ req } = build(since));
        cursor = null; deltaSent = null; page = 0; offset = 0;
        continue;
      }
      st.counters.pages++;
      let list = asArray(res.data, p.list.resultsPath);
      st.counters.fetched += list.length;
      fetchedInQuery += list.length;
      if (inc.strategy === "delta") {
        const t = getPath(res.data, inc.tokenPath);
        if (t !== undefined && t !== null && t !== "") newToken = String(t);
      }
      let stopDesc = false;
      if (inc.strategy === "watermark" && inc.order === "desc" && watermark && !partFull) {
        const keepList: unknown[] = [];
        for (const it of list) {
          const d = toDate(resolvePath({ item: it }, inc.field).find((v) => v !== undefined));
          if (d && d <= watermark) { stopDesc = true; continue; }
          keepList.push(it);
        }
        list = keepList;
      }
      if (p.keep) list = list.filter((it) => evalPredicate(p.keep!, tctx(st, { item: it, partition: part.element })));
      const { maxField } = await processItems(st, list, part, seen);
      if (maxField && (!maxSeen || maxField > maxSeen)) maxSeen = maxField;

      const all = asArray(res.data, p.list.resultsPath);
      const next = stopDesc ? null : nextPage(p.list.pagination, res.data, { page, offset, pageSize: pageSizeVal }, all);
      // a one-page map on a list that says it has more: this pass read a slice, so it must not reconcile deletes
      if (!next && p.list.pagination.type === "none" && signalsMore(res.data)) {
        truncated = true;
        st.ctx.log?.(`${st.source.id}: the list has more pages but the profile reads only the first; deletes are not reconciled`);
      }
      if (!next) break;
      page++;
      offset += all.length;
      if (cap && fetchedInQuery >= cap && maxSeen) {
        // HubSpot search caps a query: restart from the newest watermark seen
        since = maxSeen;
        ({ req } = build(since));
        cursor = null; page = 0; offset = 0; fetchedInQuery = 0;
        continue;
      }
      next.apply(req);
      cursor = next.cursor;
      await st.db.insert(sourceCursors).values({ sourceId: st.source.id, partitionKey: part.key, pageCursor: { cursor, since: since?.toISOString() ?? null, page, offset }, pendingWatermark: maxSeen?.toISOString() ?? null, updatedAt: st.now })
        .onConflictDoUpdate({ target: [sourceCursors.sourceId, sourceCursors.partitionKey], set: { pageCursor: { cursor, since: since?.toISOString() ?? null, page, offset }, pendingWatermark: maxSeen?.toISOString() ?? cur?.pendingWatermark ?? null, updatedAt: st.now } });
      await reportProgress(st);
    }
  } catch (e) {
    if (e instanceof RunStop) return { completed: false, stop: e, capped: false, since };
    throw e;
  }

  // completed: commit cursors (data time, never wall clock)
  const committedWatermark = inc.strategy === "watermark"
    ? [maxSeen, watermark, cur?.pendingWatermark ? toDate(cur.pendingWatermark) : null].filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0]?.toISOString() ?? cur?.watermark ?? null
    : cur?.watermark ?? null;
  const set = {
    watermark: committedWatermark,
    deltaToken: inc.strategy === "delta" ? newToken ?? token : null,
    pageCursor: null, pendingWatermark: null,
    lastFullPassAt: partFull ? st.now : cur?.lastFullPassAt ?? null,
    updatedAt: st.now,
  };
  await st.db.insert(sourceCursors).values({ sourceId: st.source.id, partitionKey: part.key, ...set })
    .onConflictDoUpdate({ target: [sourceCursors.sourceId, sourceCursors.partitionKey], set });
  return { completed: true, capped: truncated, since: partFull ? since : null };
}

// ---------- reconcile ----------

async function reconcile(st: RunState, completed: { key: string; since: Date | null }[], seen: Set<string>): Promise<number> {
  let n = 0;
  for (const { key, since } of completed) {
    const rows = await st.db.select({ id: items.id, externalId: items.externalId, rawId: items.rawItemId, occurredAt: items.occurredAt })
      .from(items).innerJoin(rawItems, eq(rawItems.id, items.rawItemId))
      .where(and(eq(items.sourceId, st.source.id), isNull(items.deletedAt), eq(rawItems.partitionKey, key)));
    const gone = rows.filter((r) => !seen.has(`${key}\u0000${r.externalId}`) && (!since || since.getTime() === 0 || r.occurredAt >= since));
    if (!gone.length) continue;
    await st.db.transaction(async (tx) => { for (const g of gone) await tombstoneItem(tx, st, g.id, g.rawId); });
    n += gone.length;
  }
  return n;
}

// ---------- health ----------

const STATUS_FOR: Record<RunOutcome, SourceStatus> = {
  ok: "healthy", partial: "degraded", failed: "error", rate_limited: "rate_limited", auth_needed: "auth_needed",
  grant_blocked: "grant_blocked", cancelled: "healthy", running: "syncing",
};

export async function sourceHealth(db: Db, sourceId: string): Promise<SourceHealth> {
  const [s] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!s) throw new Error(`no source ${sourceId}`);
  const since = new Date(Date.now() - 86_400_000);
  const [c] = await db.select({
    added: sql<number>`count(*) filter (where ${items.indexedAt} >= ${since} and ${items.deletedAt} is null)::int`,
  }).from(items).where(eq(items.sourceId, sourceId));
  const [r] = await db.select({
    upd: sql<number>`coalesce(sum(${runs.upserted}),0)::int`,
    failed: sql<number>`coalesce(sum(case when ${runs.outcome} in ('failed','partial') then 1 else 0 end),0)::int`,
  }).from(runs).where(and(eq(runs.sourceId, sourceId), sql`${runs.startedAt} >= ${since}`));
  return {
    status: s.status, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
    nextRunAt: s.nextRunAt?.toISOString() ?? null, retryAt: s.retryAt?.toISOString() ?? null, consecutiveFailures: s.consecutiveFailures,
    itemCount: s.itemCount, added24h: c?.added ?? 0,
    // a run's upserts count new items too: "updated" is only the writes to items that already existed
    updated24h: Math.max(0, (r?.upd ?? 0) - (c?.added ?? 0)), failed24h: r?.failed ?? 0, lastError: s.lastError ?? null,
  };
}

// ---------- the run ----------

export async function runSource(ctx: EngineCtx, sourceId: string, opts: RunOptions = { trigger: "manual" }): Promise<RunSummary> {
  const db = ctx.db;
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error(`no source ${sourceId}`);
  const [version] = await db.select().from(profileVersions).where(eq(profileVersions.id, source.profileVersionId));
  if (!version) throw new Error(`source ${sourceId} has no profile version`);
  const profile = version.json;
  if (source.status === "awaiting_grant") {
    const at = ctx.now().toISOString();
    return { runId: newId("run"), sourceId, outcome: "cancelled", fullPass: false, pages: 0, fetched: 0, hydrated: 0, upserted: 0, unchanged: 0, tombstoned: 0, skipped: 0, calls: 0, retries: 0, startedAt: at, finishedAt: at, error: { code: "not_connected", message: `${source.platform} is not in your grant yet`, at } };
  }

  // lease: one run per source at a time, across processes. The advisory lock
  // lives on its own connection, outside the pool: a run holds it for minutes,
  // and pooled lock holders once took every pool slot so /me never answered.
  const lockClient = new pg.Client((db.$client as pg.Pool).options);
  lockClient.on("error", () => { /* Postgres restarted under a run: never crash the process */ });
  await lockClient.connect();
  const startedAt = ctx.now();
  const runId = newId("run");
  let locked = false;
  try {
    const lr = await lockClient.query("select pg_try_advisory_lock(hashtext($1)) as ok", [sourceId]);
    locked = !!lr.rows[0]?.ok;
    if (!locked) {
      return { runId, sourceId, outcome: "cancelled", fullPass: false, pages: 0, fetched: 0, hydrated: 0, upserted: 0, unchanged: 0, tombstoned: 0, skipped: 0, calls: 0, retries: 0, startedAt: startedAt.toISOString(), finishedAt: startedAt.toISOString(), error: { code: "conflict", message: "a run is already in flight", at: startedAt.toISOString() } };
    }
    // the map hash as this engine computes it: a newer normalize re-maps a source stored under an older one
    return await runLocked(ctx, source, profile, { fetchHash: version.fetchHash, mapHash: hashProfile(profile).mapHash, indexHash: version.indexHash }, opts, runId, startedAt);
  } finally {
    if (locked) await lockClient.query("select pg_advisory_unlock(hashtext($1))", [sourceId]).catch(() => {});
    await lockClient.end().catch(() => {});
  }
}

async function runLocked(ctx: EngineCtx, source: SourceRow, profile: SearchProfile, versionHashes: RunState["versionHashes"], opts: RunOptions, runId: string, startedAt: Date): Promise<RunSummary> {
  const db = ctx.db;
  const now = startedAt;
  const userSettings = await ctx.settingsFor(source.userId);
  const embedModel = ctx.capability.mode === "hybrid" ? embeddingModelId(userSettings) : null;
  const settings = settingsFor(profile, source.settings);
  // settings the fetch reads are part of the fetch: a changed one resets cursors and runs a full pass
  const fetchStale = fetchIsStale(source.fetchHash, versionHashes.fetchHash, profile, settings);
  versionHashes = { ...versionHashes, fetchHash: effectiveFetchHash(versionHashes.fetchHash, profile, settings) };
  const self = await loadSelf(db, source.userId);
  const rollup = new LedgerRollup();
  const st: RunState = {
    ctx, db, source, profile, versionHashes,
    call: { db, userId: source.userId, sourceId: source.id, actor: "indexer", mode: source.mode, oneConnect: ctx.oneConnect, transport: ctx.transport, connectionKey: source.connectionKey, rollup },
    limiter: { connectionKey: `${source.userId}:${source.connectionKey}`, rpm: profile.limits?.requestsPerMinute ?? 60, perAction: profile.limits?.perAction, enabled: source.mode === "connect" },
    settings, hydrateKey: fetchSettingsKeys(profile, settings).hydrate, account: {}, env: { account: {}, settings, now, selfAddresses: [...self.emails] },
    resolveEnv: { userId: source.userId, sourceId: source.id, platform: source.platform, selfEmails: self.emails, selfDomains: self.domains, selfExts: self.exts, ignoreDomains: new Set(profile.entities?.ignoreDomains ?? []), now },
    counters: { pages: 0, fetched: 0, hydrated: 0, upserted: 0, unchanged: 0, tombstoned: 0, skipped: 0, calls: 0, retries: 0 },
    full: false, now, sleep: ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), embedModel,
    touchedEntities: new Set(), added: 0, updated: 0, removed: 0,
    runId, onProgress: opts.onProgress, progressAt: 0, countAt: Date.now(),
  };

  // a changed fetch part drops cursors and forces a full pass
  const fetchChanged = fetchStale;
  if (fetchChanged) await db.update(sourceCursors).set({ watermark: null, deltaToken: null, pageCursor: null, pendingWatermark: null }).where(eq(sourceCursors.sourceId, source.id));
  const fullEvery = profile.deletes?.fullPassEvery ? parseDuration(profile.deletes.fullPassEvery) : null;
  const fullDue = !!fullEvery && (!source.lastFullPassAt || now.getTime() - source.lastFullPassAt.getTime() >= fullEvery);
  st.full = !!opts.full || fetchChanged || fullDue || !source.lastSuccessAt || profile.incremental.strategy === "full";

  await db.insert(runs).values({ id: runId, sourceId: source.id, trigger: opts.trigger, fullPass: st.full, startedAt, outcome: "running" });
  await db.update(sources).set({ status: "syncing", lastAttemptAt: now }).where(eq(sources.id, source.id));

  let outcome: RunOutcome = "ok";
  let error: SourceError | undefined;
  let retryAt: Date | undefined;
  let httpStatus: number | undefined;
  try {
    // a changed map re-runs normalize from stored raw payloads, zero API calls
    if (source.mapHash && source.mapHash !== versionHashes.mapHash) await remapWith(st);

    await resolveAccount(st);
    st.env = { ...st.env, account: st.account };
    const self2 = await loadSelf(db, source.userId);
    st.resolveEnv.selfEmails = self2.emails;
    st.resolveEnv.selfDomains = self2.domains;
    st.resolveEnv.selfExts = self2.exts;
    st.env.selfAddresses = [...self2.emails];
    // self_addresses may have grown (another connection's account call): fold those people into self
    if (await markSelf(db, source.userId, self2)) st.touchedEntities.add("self");

    const parts: PartitionRef[] = profile.partitions ? await listPartitions(st, profile.partitions, undefined) : [{ key: "", element: undefined }];
    const seen = new Set<string>();
    const completed: { key: string; since: Date | null }[] = [];
    let anyCapped = false;
    const maxPages = opts.maxPages ?? profile.limits?.maxPagesPerRun ?? 1000;
    for (const part of parts) {
      if (opts.signal?.aborted) { outcome = "cancelled"; break; }
      const r = await runPartition(st, part, seen, maxPages);
      if (r.completed) completed.push({ key: part.key, since: r.since });
      if (r.capped) anyCapped = true;
      if (r.stop) {
        const k = r.stop.kind;
        httpStatus = r.stop.extra.status;
        error = { code: r.stop.code, message: r.stop.message, at: ctx.now().toISOString(), actionId: r.stop.extra.actionId, httpStatus };
        if (k === "page_failed") { outcome = "partial"; continue; }
        outcome = k === "rate_limited" ? "rate_limited" : k === "auth_needed" ? "auth_needed" : k === "grant_blocked" ? "grant_blocked" : k === "plan_limit" ? "partial" : "failed";
        if (k === "rate_limited") retryAt = r.stop.extra.retryAt;
        break;
      }
    }
    // reconcile by absence: only after a complete, non-empty, uncapped full pass
    if (st.full && !anyCapped && outcome === "ok" && st.counters.pages > 0 && st.counters.fetched > 0 && profile.deletes?.reconcile === "onFullPass") {
      const n = await reconcile(st, completed.filter((c) => c.since !== null || profile.incremental.strategy === "full").map((c) => ({ key: c.key, since: c.since })), seen);
      st.counters.tombstoned += n;
      st.removed += n;
    }
    if (st.touchedEntities.size || st.removed) await recountEntities(db, source.userId);
  } catch (e) {
    if (e instanceof RunStop) {
      outcome = e.kind === "rate_limited" ? "rate_limited" : e.kind === "auth_needed" ? "auth_needed" : e.kind === "grant_blocked" ? "grant_blocked" : "failed";
      error = { code: e.code, message: e.message, at: ctx.now().toISOString(), actionId: e.extra.actionId, httpStatus: e.extra.status };
      httpStatus = e.extra.status;
      if (e.kind === "rate_limited") retryAt = e.extra.retryAt;
    } else {
      outcome = "failed";
      error = { code: "internal", message: String((e as Error)?.message ?? e).slice(0, 500), at: ctx.now().toISOString() };
      ctx.log(`run ${source.id} failed: ${(e as Error)?.stack ?? e}`);
    }
  }

  await rollup.flush(db);
  const finishedAt = ctx.now();
  const ok = outcome === "ok";
  const failures = ok ? 0 : source.consecutiveFailures + 1;
  const every = scheduleMs(profile);
  const jitter = 1 + (Math.random() * 0.2 - 0.1);
  const nextRunAt = new Date(finishedAt.getTime() + Math.min(every * 2 ** (ok ? 0 : failures), 6 * 3_600_000) * jitter);
  const status: SourceStatus = !ok && failures >= 3 && outcome !== "auth_needed" && outcome !== "grant_blocked" && outcome !== "rate_limited" ? "error" : STATUS_FOR[outcome];
  const [{ n: itemCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(items).where(and(eq(items.sourceId, source.id), isNull(items.deletedAt), eq(items.directory, false)));
  await db.update(sources).set({
    status, lastSuccessAt: ok ? finishedAt : source.lastSuccessAt, lastFullPassAt: ok && st.full ? finishedAt : source.lastFullPassAt,
    consecutiveFailures: failures, retryAt: retryAt ?? null, lastError: error ?? null, nextRunAt: retryAt ?? nextRunAt,
    itemCount, fetchHash: ok || outcome === "partial" ? versionHashes.fetchHash : source.fetchHash, mapHash: versionHashes.mapHash,
    indexHash: versionHashes.indexHash,
  }).where(eq(sources.id, source.id));
  const c = st.counters;
  await db.update(runs).set({ finishedAt, outcome, ...c, httpStatus: httpStatus ?? null, retryAfterAt: retryAt ?? null, error: error ?? null }).where(eq(runs.id, runId));
  const summary: RunSummary = { runId, sourceId: source.id, outcome, fullPass: st.full, ...c, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), ...(retryAt ? { retryAt: retryAt.toISOString() } : {}), ...(error ? { error } : {}) };
  try {
    ctx.emit(source.userId, { type: "run", sourceId: source.id, run: { ...summary, trigger: opts.trigger } });
    if (st.added || st.updated || st.removed) ctx.emit(source.userId, { type: "index", sourceId: source.id, added: st.added, updated: st.updated, removed: st.removed });
    ctx.emit(source.userId, { type: "source", sourceId: source.id, health: await sourceHealth(db, source.id) });
  } catch { /* emit never fails a run */ }
  return summary;
}

export function embeddingModelId(s: { embedding: { provider: string; model: string; dims: number } }): string {
  return `${s.embedding.provider}:${s.embedding.model}@${s.embedding.dims}`;
}

// ---------- remap ----------

async function remapWith(st: RunState): Promise<number> {
  const rows = await st.db.select().from(rawItems).where(and(eq(rawItems.sourceId, st.source.id), isNull(rawItems.deletedAt)));
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    await st.db.transaction(async (tx) => {
      for (const r of rows.slice(i, i + 100)) {
        const res = await upsertNormalized(tx, st, r.id, { item: r.item, detail: r.detail ?? undefined, children: r.children ?? undefined, partition: r.partition ?? undefined, fetchedAt: r.fetchedAt.toISOString() });
        if (res === "updated" || res === "added") n++;
      }
    });
  }
  await st.db.update(sources).set({ mapHash: st.versionHashes.mapHash }).where(eq(sources.id, st.source.id));
  return n;
}

/** Re-normalizes a source from raw_items after a map change (zero API calls). */
export async function remapSource(ctx: EngineCtx, sourceId: string): Promise<{ remapped: number }> {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error(`no source ${sourceId}`);
  const [version] = await ctx.db.select().from(profileVersions).where(eq(profileVersions.id, source.profileVersionId));
  if (!version) throw new Error(`no version for ${sourceId}`);
  const userSettings = await ctx.settingsFor(source.userId);
  const settings = settingsFor(version.json, source.settings);
  const self = await loadSelf(ctx.db, source.userId);
  const now = ctx.now();
  const st = {
    ctx, db: ctx.db, source, profile: version.json, versionHashes: { fetchHash: effectiveFetchHash(version.fetchHash, version.json, settings), mapHash: hashProfile(version.json).mapHash, indexHash: version.indexHash },
    settings, hydrateKey: fetchSettingsKeys(version.json, settings).hydrate, account: source.accountVars ?? {}, env: { account: source.accountVars ?? {}, settings, now, selfAddresses: [...self.emails] },
    resolveEnv: { userId: source.userId, sourceId: source.id, platform: source.platform, selfEmails: self.emails, selfDomains: self.domains, selfExts: self.exts, ignoreDomains: new Set(version.json.entities?.ignoreDomains ?? []), now },
    now, embedModel: ctx.capability.mode === "hybrid" ? embeddingModelId(userSettings) : null, touchedEntities: new Set<string>(),
  } as unknown as RunState;
  const remapped = await remapWith(st);
  await recountEntities(ctx.db, source.userId);
  return { remapped };
}

