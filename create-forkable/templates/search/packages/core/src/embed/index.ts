// Embedders and the embed worker: pending_embeddings -> embedding_cache -> chunk_embeddings.

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { SettingsData } from "../contract.js";
import type { EngineCtx } from "../ctx.js";
import { chunks, pendingEmbeddings, users } from "../db/schema.js";
import type { EmbedderStatus, SemanticOffReason } from "../api-types.js";
import { BlockedByGrant, NotConnected } from "../errors.js";
import { one } from "../one.js";
import { platformName } from "../platforms.js";
import { hashEmbed, LOCAL_LABEL, LOCAL_MODEL } from "./local-hash.js";
import { DIMS, PROVIDERS, type TaskType } from "./providers.js";

export interface EmbedderSpec { id: string; label: string; semantic: boolean; local: boolean; provider: string; model: string }

export function modelId(s: SettingsData): string {
  return `${s.embedding.provider}:${s.embedding.model}@${s.embedding.dims}`;
}

export function pickEmbedder(settings: SettingsData, mode: "fixture" | "connect"): EmbedderSpec {
  if (mode === "fixture" || settings.embedding.provider === "local") return { id: LOCAL_MODEL, label: LOCAL_LABEL, semantic: false, local: true, provider: "local", model: "hash-v1" };
  return { id: modelId(settings), label: `${settings.embedding.provider} ${settings.embedding.model}`, semantic: true, local: false, provider: settings.embedding.provider, model: settings.embedding.model };
}

export function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(7)) : 0)).join(",")}]`;
}

async function userMode(ctx: EngineCtx, userId: string): Promise<"fixture" | "connect"> {
  const [u] = await ctx.db.select({ s: users.isSample }).from(users).where(eq(users.id, userId));
  return u?.s ? "fixture" : "connect";
}

async function embedTexts(ctx: EngineCtx, userId: string, spec: EmbedderSpec, texts: string[], task: TaskType): Promise<number[][]> {
  if (spec.local) return texts.map(hashEmbed);
  const factory = PROVIDERS[spec.provider];
  if (!factory) throw new Error(`unknown embedding provider ${spec.provider}`);
  const p = factory(spec.model);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += p.batch) {
    const part = texts.slice(i, i + p.batch).map((t) => t.slice(0, 24_000));
    const vecs = await one.call(
      { db: ctx.db, userId, actor: "embedder", mode: "connect", oneConnect: ctx.oneConnect, transport: ctx.transport },
      p.build(part, task),
    );
    if (vecs.length !== part.length) throw new Error(`embedder returned ${vecs.length} vectors for ${part.length} texts`);
    out.push(...vecs.map((v) => (v.length === DIMS ? v : v.slice(0, DIMS))));
  }
  return out;
}

/** Embeds pending chunks for a user (cache first). A no-op in keyword mode. */
export async function embedPending(ctx: EngineCtx, userId: string, limit = 512): Promise<{ embedded: number; cached: number; failed: number }> {
  if (ctx.capability.mode !== "hybrid") return { embedded: 0, cached: 0, failed: 0 };
  const settings = await ctx.settingsFor(userId);
  const spec = pickEmbedder(settings, await userMode(ctx, userId));
  let embedded = 0, cached = 0, failed = 0;
  for (;;) {
    const rows = await ctx.db.select({ chunkId: pendingEmbeddings.chunkId, attempts: pendingEmbeddings.attempts, text: chunks.text, textHash: chunks.textHash })
      .from(pendingEmbeddings).innerJoin(chunks, eq(chunks.id, pendingEmbeddings.chunkId))
      .where(and(eq(pendingEmbeddings.userId, userId), lte(pendingEmbeddings.nextAt, ctx.now())))
      .limit(Math.min(128, limit - embedded - cached - failed));
    if (!rows.length) break;
    const hashes = [...new Set(rows.map((r) => r.textHash))];
    const hit = await ctx.db.execute(sql`select text_hash from embedding_cache where model = ${spec.id} and text_hash in (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`);
    const have = new Set((hit.rows as { text_hash: string }[]).map((r) => r.text_hash));
    const miss = rows.filter((r) => !have.has(r.textHash));
    const uniqMiss = [...new Map(miss.map((r) => [r.textHash, r])).values()];
    try {
      if (uniqMiss.length) {
        const vecs = await embedTexts(ctx, userId, spec, uniqMiss.map((r) => r.text), "document");
        for (let i = 0; i < uniqMiss.length; i++) {
          await ctx.db.execute(sql`insert into embedding_cache (text_hash, model, embedding) values (${uniqMiss[i]!.textHash}, ${spec.id}, ${vectorLiteral(vecs[i]!)}::vector) on conflict do nothing`);
        }
      }
      await ctx.db.execute(sql`
        insert into chunk_embeddings (chunk_id, user_id, model, embedding)
        select c.id, c.user_id, ${spec.id}, ec.embedding from chunks c join embedding_cache ec on ec.text_hash = c.text_hash and ec.model = ${spec.id}
        where c.id in (${sql.join(rows.map((r) => sql`${r.chunkId}`), sql`, `)})
        on conflict (chunk_id) do update set model = excluded.model, embedding = excluded.embedding`);
      await ctx.db.delete(pendingEmbeddings).where(inArray(pendingEmbeddings.chunkId, rows.map((r) => r.chunkId)));
      embedded += uniqMiss.length;
      cached += rows.length - miss.length;
      if (uniqMiss.length) noteEmbed(userId, spec, null);
    } catch (e) {
      failed += rows.length;
      noteEmbed(userId, spec, e);
      ctx.log(`embed failed for ${rows.length} chunks: ${(e as Error).message}`);
      for (const r of rows) {
        await ctx.db.update(pendingEmbeddings).set({ attempts: r.attempts + 1, nextAt: new Date(ctx.now().getTime() + Math.min(60_000 * 2 ** r.attempts, 6 * 3_600_000)) }).where(eq(pendingEmbeddings.chunkId, r.chunkId));
      }
      break;
    }
    if (embedded + cached + failed >= limit) break;
  }
  return { embedded, cached, failed };
}

const queryCache = new Map<string, { at: number; v: number[] }>();

// ---------- is the semantic arm working (D41) ----------

/** The last embed outcome per user, from queries and from the embed worker. In memory: a restart asks again. */
const health = new Map<string, { ok: boolean; reason: SemanticOffReason | null; platform: string | null; message: string | null; at: number }>();

function failureOf(e: unknown, spec: EmbedderSpec): { reason: SemanticOffReason; message: string } {
  const name = platformName(spec.provider);
  if (e instanceof NotConnected || e instanceof BlockedByGrant) return { reason: "not_in_grant", message: `${name} is not in your grant.` };
  const code = (e as { code?: string })?.code;
  if (code === "reconnect_required") return { reason: "not_in_grant", message: `One will not act for you on ${name} until you sign in again.` };
  return { reason: "error", message: `${name} did not answer: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
}

function noteEmbed(userId: string, spec: EmbedderSpec, e: unknown | null): void {
  if (spec.local) return;
  if (e === null) { health.set(userId, { ok: true, reason: null, platform: spec.provider, message: null, at: Date.now() }); return; }
  const f = failureOf(e, spec);
  health.set(userId, { ok: false, reason: f.reason, platform: spec.provider, message: f.message, at: Date.now() });
}

/** What a search would get from the vector arm right now, without calling anything. */
export async function semanticStatus(ctx: EngineCtx, userId: string): Promise<EmbedderStatus> {
  const spec = pickEmbedder(await ctx.settingsFor(userId), await userMode(ctx, userId));
  return statusFor(ctx, userId, spec);
}

function statusFor(ctx: EngineCtx, userId: string, spec: EmbedderSpec): EmbedderStatus {
  if (ctx.capability.mode !== "hybrid") return { model: spec.id, semantic: false, reason: "keyword_mode", platform: null, message: "pgvector is not available, so search runs on keywords." };
  if (spec.local) return { model: spec.id, semantic: false, reason: "sample", platform: null, message: null };
  const h = health.get(userId);
  if (h && !h.ok) return { model: spec.id, semantic: false, reason: h.reason, platform: h.platform, message: h.message };
  return { model: spec.id, semantic: true, reason: null, platform: spec.provider, message: null };
}

/** Test hook: forget what the embedder did. */
export function resetSemanticHealth(): void { health.clear(); queryCache.clear(); }

export interface QueryVector { vector: number[] | null; status: EmbedderStatus }

/** The query vector (query task type), cached 10 minutes by text, with what happened when it could not be made. `fresh` skips the cache read. */
export async function embedQueryWithStatus(ctx: EngineCtx, userId: string, text: string, o: { fresh?: boolean } = {}): Promise<QueryVector> {
  const settings = await ctx.settingsFor(userId);
  const spec = pickEmbedder(settings, await userMode(ctx, userId));
  if (ctx.capability.mode !== "hybrid" || !text.trim()) return { vector: null, status: statusFor(ctx, userId, spec) };
  const key = `${spec.id}\u0000${text.trim().toLowerCase()}`;
  const hit = queryCache.get(key);
  if (hit && !o.fresh && Date.now() - hit.at < 600_000) return { vector: hit.v, status: statusFor(ctx, userId, spec) };
  try {
    const [v] = await embedTexts(ctx, userId, spec, [text], "query");
    if (!v) throw new Error("the embedder returned no vector");
    queryCache.set(key, { at: Date.now(), v });
    noteEmbed(userId, spec, null);
    return { vector: v, status: statusFor(ctx, userId, spec) };
  } catch (e) {
    ctx.log(`query embed failed: ${(e as Error).message}`);
    noteEmbed(userId, spec, e);
    return { vector: null, status: statusFor(ctx, userId, spec) };
  }
}

/** The query vector, or null in keyword mode or when the embedder fails. */
export async function embedQuery(ctx: EngineCtx, userId: string, text: string): Promise<number[] | null> {
  return (await embedQueryWithStatus(ctx, userId, text)).vector;
}

export { LOCAL_LABEL, LOCAL_MODEL, hashEmbed };
