// Jev rerank (SPEC 9.2 step 7, D30): a second request after the RRF answer. Jev scores
// the top 30 (unrelated, mentions it, about it, exactly it);
// final = 0.5 * (1 - rrf_rank / 30) + 0.5 * rel / 3.
// Score once (D47): every score lands in rerank_scores per user, normalized query and
// item, with a hash of what Jev read. A rerank asks Jev only about candidates without a
// stored score whose hash still matches, so a repeat search, a restart or a new page of
// the same query costs nothing. 2.5 s budget: past it the RRF order answers at once, the
// call keeps going and its scores are stored for the next view. One call per missing set
// is in flight at a time (single-flight). Sample users read fixtures/sample/rerank.json.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { RerankRequest, RerankResponse } from "../api-types.js";
import type { CallCtx, EngineCtx } from "../ctx.js";
import { items, rerankScores, users } from "../db/schema.js";
import { NotConnected } from "../errors.js";
import { one } from "../one.js";
import { platformName } from "../platforms.js";
import { canonicalJson, sha16 } from "../profile/hash.js";
import { parseQuery } from "../query/parse.js";
import { normalizeQuestion } from "../sample/world.js";
import { JEV_ACTION } from "../classify/jev.js";
import { rememberedQuery } from "./hybrid.js";

const TOP = 30;
/** The wait before the RRF order answers on its own. Tests lower it. */
export const RERANK = { budgetMs: 2500 };

type Fail = "jev_missing" | "timeout" | "sample_no_fixture";
type Ask = Promise<{ ok: true; scores: Map<string, number> } | { ok: false; reason: Fail }>;
const inflight = new Map<string, Ask>();

/** Jev calls still running (a late answer not yet stored). */
export function rerankInFlight(): number { return inflight.size; }
/** Waits for every running Jev call to finish and store its scores (tests, shutdown). */
export async function settleReranks(): Promise<void> { await Promise.allSettled([...inflight.values()]); }

export function fuseRerank(ids: string[], rel: Map<string, number>): string[] {
  const top = ids.slice(0, TOP);
  const score = (id: string, i: number) => 0.5 * (1 - i / TOP) + 0.5 * ((rel.get(id) ?? 0) / 3);
  return [...top.map((id, i) => ({ id, s: score(id, i) })).sort((a, b) => b.s - a.s).map((x) => x.id), ...ids.slice(TOP)];
}

interface Candidate { kind: string; source: string; title: string; date: string | undefined; excerpt: string }

export async function jevRerank(ctx: EngineCtx, userId: string, req: RerankRequest): Promise<RerankResponse> {
  const t0 = Date.now();
  const q = rememberedQuery(req.queryId);
  const base = (reason: RerankResponse["reason"], order = q?.ids ?? []): RerankResponse => ({ queryId: req.queryId, order, reranked: false, ms: Date.now() - t0, reason });
  if (!q || q.userId !== userId) return base("off", []);
  const settings = await ctx.settingsFor(userId);
  if (!settings.rerank) return base("off");
  const text = parseQuery(q.q).text.trim();
  const sample = await isSample(ctx, userId);
  if (text.split(/\s+/).filter(Boolean).length < (sample ? 1 : 3)) return base("short_query");
  const query = normalizeQuestion(text);
  const top = q.ids.slice(0, TOP);
  const rows = top.length ? await ctx.db.select({ id: items.id, platform: items.platform, externalId: items.externalId, kind: items.kind, title: items.title, occurredAt: items.occurredAt, snippet: items.snippet, body: items.body }).from(items).where(inArray(items.id, top)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cands = new Map<string, { c: Candidate; hash: string }>();
  for (const id of top) {
    const it = byId.get(id);
    if (!it) continue;
    const c: Candidate = { kind: it.kind, source: platformName(it.platform), title: it.title, date: it.occurredAt.toISOString().slice(0, 10), excerpt: (it.snippet || it.body || "").slice(0, 300) };
    cands.set(id, { c, hash: sha16(canonicalJson({ model: sample ? "sample" : settings.jevModel, ...c })) });
  }

  // what Jev already said about these items for this query, while they still read the same
  const rel = new Map<string, number>();
  if (!req.fresh && cands.size) {
    const kept = await ctx.db.select({ itemId: rerankScores.itemId, hash: rerankScores.contentHash, score: rerankScores.score }).from(rerankScores)
      .where(and(eq(rerankScores.userId, userId), eq(rerankScores.query, query), inArray(rerankScores.itemId, [...cands.keys()])));
    for (const k of kept) if (cands.get(k.itemId)?.hash === k.hash) rel.set(k.itemId, k.score);
  }
  const stored = rel.size;
  const missing = [...cands.keys()].filter((id) => !rel.has(id));
  const done = (asked: number): RerankResponse => ({ queryId: req.queryId, order: fuseRerank(q.ids, rel), reranked: true, ms: Date.now() - t0, stored, asked });
  if (!missing.length) return done(0);

  const key = `${userId}\u0000${query}\u0000${missing.map((id) => `${id}:${cands.get(id)!.hash}`).join(",")}`;
  let ask = inflight.get(key);
  if (!ask) {
    const call: CallCtx = { db: ctx.db, userId, actor: "classifier", mode: sample ? "fixture" : "connect", oneConnect: ctx.oneConnect, transport: ctx.transport };
    ask = askJev(ctx, call, { userId, text, query, sample, model: settings.jevModel, missing, cands, byId })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, ask);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([ask, new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), RERANK.budgetMs); timer.unref?.(); })]);
  clearTimeout(timer);
  if (res === "timeout") return base("timeout");
  if (!res.ok) return base(res.reason);
  for (const [id, s] of res.scores) rel.set(id, s);
  return done(missing.length);
}

/** One Jev call for the missing candidates; stores what it answers, even after the request that started it gave up. Never throws. */
async function askJev(ctx: EngineCtx, call: CallCtx, o: {
  userId: string; text: string; query: string; sample: boolean; model: string; missing: string[];
  cands: Map<string, { c: Candidate; hash: string }>; byId: Map<string, { platform: string; externalId: string }>;
}): Ask {
  const t0 = Date.now();
  const scores = new Map<string, number>();
  try {
    if (o.sample) {
      const r = await one.raw(call, { ...JEV_ACTION, action: "rerank", level: "read", summary: "Rerank search results", fixtureKey: `rerank:${o.text}`, body: {} }).catch(() => null);
      if (!r?.ok) return { ok: false, reason: "sample_no_fixture" };
      const refs = r.data as Record<string, number>;
      for (const id of o.missing) { const it = o.byId.get(id)!; const v = refs[`${it.platform}:${it.externalId}`]; scores.set(id, typeof v === "number" ? v : 0); }
    } else {
      const candidates = o.missing.map((id, n) => ({ n, ...o.cands.get(id)!.c }));
      const questions = Object.fromEntries(o.missing.map((_, n) => [`rel_${n}`, { type: "score", instructions: `How well does \`candidates[${n}]\` answer \`query\`?`, criteria: ["Unrelated to the query.", "Mentions it in passing.", "About the query.", "Exactly what was asked."] }]));
      const [u] = await ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, o.userId));
      const res = await one.call<{ answers?: Record<string, unknown> }>(call, { ...JEV_ACTION, action: "rerank", level: "read", summary: "Rerank search results", body: { model: o.model, state: { query: o.text, me: { name: u?.name, email: u?.email }, candidates }, questions } });
      for (const [n, id] of o.missing.entries()) {
        const v = res.answers?.[`rel_${n}`];
        const s = typeof v === "number" ? v : v && typeof v === "object" ? Number((v as Record<string, unknown>).score ?? (v as Record<string, unknown>).level ?? 0) : 0;
        scores.set(id, Math.max(0, Math.min(3, Math.round(s))));
      }
    }
  } catch (e) {
    return { ok: false, reason: e instanceof NotConnected ? "jev_missing" : "timeout" };
  }
  try {
    const values = [...scores].map(([itemId, score]) => ({ userId: o.userId, query: o.query, itemId, contentHash: o.cands.get(itemId)!.hash, score }));
    if (values.length) {
      await ctx.db.insert(rerankScores).values(values).onConflictDoUpdate({
        target: [rerankScores.userId, rerankScores.query, rerankScores.itemId],
        set: { contentHash: sql`excluded.content_hash`, score: sql`excluded.score`, at: sql`now()` },
      });
    }
    if (Date.now() - t0 > RERANK.budgetMs) ctx.log(`rerank: a late Jev answer stored ${values.length} scores`);
  } catch (e) {
    ctx.log(`rerank: could not store scores: ${(e as Error).message}`);
  }
  return { ok: true, scores };
}

async function isSample(ctx: EngineCtx, userId: string): Promise<boolean> {
  const [u] = await ctx.db.select({ s: users.isSample }).from(users).where(eq(users.id, userId));
  return !!u?.s;
}
