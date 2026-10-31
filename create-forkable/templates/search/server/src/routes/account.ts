// Me, sign out, disconnect, settings, Access and the ledger, OAuth clients, events.

import { Hono } from "hono";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  dbSchema, forgetGrant, getSettings, listLedger, one, putSettings, RECEIPT_ACTION, embeddingModelId,
  type LedgerActor, type MeResponse, type SettingsData,
} from "@search/core";
import { ENGINE_CHOICES, engineStatus, redetectLocalEngine } from "@search/core/local-agent";
import { connectConfigured } from "../config.js";
import type { AppEnv } from "../deps.js";
import { badRequest } from "../errors.js";
import { currentUser, requireUser, signedInUser } from "../session.js";
import { accessResponse } from "../views.js";
import { cookieOnly, int, need, readJson } from "./lib.js";

const { sessions, oauthTokens, oauthClients, chunks, pendingEmbeddings } = dbSchema;

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/me", async (c) => {
  const deps = c.get("deps");
  const u = await signedInUser(c);
  const configured = connectConfigured(deps.env) && !!deps.oneConnect;
  const body: MeResponse = {
    user: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, isSample: u.isSample } : null,
    signedIn: !!u,
    connect: { configured, signInUrl: configured ? "/api/one/authorize" : null },
    capability: deps.capability,
    settings: u ? await getSettings(deps.db, u.id) : null,
  };
  return c.json(body);
});

accountRoutes.post("/signout", async (c) => {
  cookieOnly(c);
  await c.get("deps").db.delete(sessions).where(eq(sessions.sid, c.get("sid")));
  return c.body(null, 204);
});

/** Drops this computer's copy of the grant. The grant itself is revoked in One. */
accountRoutes.post("/connect/disconnect", async (c) => {
  cookieOnly(c);
  const deps = c.get("deps");
  const u = await currentUser(c);
  if (u && !u.isSample && deps.oneConnect) {
    await deps.oneConnect.disconnect(u.id).catch(() => {});
    forgetGrant(u.id);
  }
  await deps.db.delete(sessions).where(eq(sessions.sid, c.get("sid")));
  return c.body(null, 204);
});

accountRoutes.get("/settings", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  return c.json(await getSettings(c.get("deps").db, u.id));
});

/** Which engine writes answers and proposals (the saved choice, the env override, each local CLI) and what runs. */
accountRoutes.get("/assistant/engine", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  return c.json(await engineStatus(await getSettings(c.get("deps").db, u.id)));
});

/** Check again: looks for Claude Code and Codex anew (after an install or a sign-in). */
accountRoutes.post("/assistant/engine/redetect", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  redetectLocalEngine();
  return c.json(await engineStatus(await getSettings(c.get("deps").db, u.id)));
});

const KEYS: (keyof SettingsData)[] = ["embedding", "rerank", "engine", "chatModel", "proposalModel", "localChatModel", "localProposalModel", "jevModel", "backfillDefault", "slackTier", "vipEntityIds", "lanesOn", "paused"];

accountRoutes.put("/settings", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  const b = await readJson<Partial<SettingsData>>(c);
  const patch: Partial<SettingsData> = {};
  for (const k of Object.keys(b) as (keyof SettingsData)[]) {
    if (!KEYS.includes(k)) throw badRequest(`Unknown setting ${k}.`);
    (patch as Record<string, unknown>)[k] = b[k];
  }
  if (patch.embedding && !["local", "openai", "gemini", "cohere", "mistral-ai"].includes(patch.embedding.provider)) throw badRequest("Unknown embedding provider.");
  if (patch.engine !== undefined && !ENGINE_CHOICES.includes(patch.engine)) throw badRequest('engine is "auto", "claude-code", "codex" or "one".');
  for (const k of ["chatModel", "proposalModel", "localChatModel", "localProposalModel"] as const) {
    if (patch[k] !== undefined && (typeof patch[k] !== "string" || !/^[\w.:-]{1,80}$/.test(patch[k]!))) throw badRequest(`${k} is a model id.`);
  }
  if (patch.backfillDefault && !["30d", "365d", "all"].includes(patch.backfillDefault)) throw badRequest('backfillDefault is "30d", "365d" or "all".');
  if (patch.slackTier && !["limited", "marketplace"].includes(patch.slackTier)) throw badRequest('slackTier is "limited" or "marketplace".');
  const before = await getSettings(deps.db, u.id);
  const next = await putSettings(deps.db, u.id, patch);
  let effect: { reembed: { chunks: number; estimateCalls: number } } | null = null;
  const oldModel = embeddingModelId(before), newModel = embeddingModelId(next);
  if (oldModel !== newModel) {
    const [{ n } = { n: 0 }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(chunks).where(eq(chunks.userId, u.id));
    // every chunk queues for the new model (the embedding cache answers repeats)
    await deps.db.execute(sql`insert into pending_embeddings (chunk_id, user_id, model, attempts, next_at)
      select id, user_id, ${newModel}, 0, now() from chunks where user_id = ${u.id}
      on conflict (chunk_id) do update set model = excluded.model, attempts = 0, next_at = now()`);
    deps.scheduler.markDirty(u.id);
    effect = { reembed: { chunks: n, estimateCalls: Math.ceil(n / 128) } };
  }
  void pendingEmbeddings;
  return c.json({ settings: next, effect });
});

accountRoutes.get("/access", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  return c.json(await accessResponse(c.get("deps"), u));
});

/** The declined write: Search attempts a Gmail delete and One refuses it (403, the provider is never called). */
accountRoutes.post("/access/receipt-demo", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  const row = await one.attempt(
    { db: deps.db, userId: u.id, actor: "user", mode: u.isSample ? "fixture" : "connect", oneConnect: deps.oneConnect, transport: deps.ctx.transport, emit: (ev) => deps.hub.emit(u.id, ev) },
    { platform: RECEIPT_ACTION.platform, action: "delete", level: "write", actionId: RECEIPT_ACTION.actionId, method: RECEIPT_ACTION.method, path: RECEIPT_ACTION.path, pathParams: { userId: "me", id: "receipt-demo" }, summary: "Show that Search cannot delete mail" },
  );
  return c.json(row);
});

accountRoutes.get("/ledger", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  return c.json(await listLedger(c.get("deps").db, u.id, {
    limit: int(c.req.query("limit"), 100, 1, 1000), actor: (c.req.query("actor") || undefined) as LedgerActor | undefined,
    sourceId: c.req.query("sourceId") || undefined, before: c.req.query("before") || undefined,
  }));
});

accountRoutes.get("/oauth-clients", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  const db = c.get("deps").db;
  const rows = (await db.execute(sql`
    select t.client_id, max(t.last_used_at) as last_used_at, min(t.created_at) as created_at,
      count(*) filter (where t.revoked_at is null and t.expires_at > now() and t.kind = 'refresh')::int as active,
      (array_agg(t.scopes order by t.created_at desc))[1] as scopes
    from oauth_tokens t where t.user_id = ${u.id} group by t.client_id
    order by count(*) filter (where t.revoked_at is null and t.expires_at > now() and t.kind = 'refresh') > 0 desc, max(coalesce(t.last_used_at, t.created_at)) desc`)).rows as { client_id: string; last_used_at: Date | null; created_at: Date; active: number; scopes: string[] | null }[];
  if (!rows.length) return c.json([]);
  const clients = await db.select().from(oauthClients).where(inArray(oauthClients.clientId, rows.map((r) => r.client_id)));
  return c.json(rows.map((r) => {
    const cl = clients.find((x) => x.clientId === r.client_id);
    return { clientId: r.client_id, name: cl?.clientName ?? r.client_id, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null, scopes: r.scopes ?? (cl?.scope ?? "").split(/\s+/).filter(Boolean), activeTokens: r.active };
  }));
});

accountRoutes.delete("/oauth-clients/:clientId", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  await c.get("deps").db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.userId, u.id), eq(oauthTokens.clientId, c.req.param("clientId")), isNull(oauthTokens.revokedAt)));
  return c.body(null, 204);
});

accountRoutes.get("/events", async (c) => {
  need(c, "search:read");
  const u = await requireUser(c);
  return c.get("deps").hub.subscribe(c, u.id);
});
