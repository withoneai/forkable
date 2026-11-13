// Me, sign out, disconnect, settings, Access and the ledger, OAuth clients, events.

import { homedir } from "node:os";
import { Hono } from "hono";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { budgetFor, planChanged, oneUsageTotals, type OnePlanStatus,
  dbSchema, forgetGrant, getSettings, listLedger, one, putSettings, RECEIPT_ACTION, embeddingModelId,
  type Db, type LedgerActor, type MeResponse, type OAuthClientRow, type SettingsData,
} from "@search/core";
import { ENGINE_CHOICES, engineStatus, redetectLocalEngine } from "@search/core/local-agent";
import { connectConfigured } from "../config.js";
import type { AppEnv } from "../deps.js";
import { badRequest } from "../errors.js";
import { currentUser, requireUser, signedInUser } from "../session.js";
import { accessResponse } from "../views.js";
import { endAgentSignInsOf } from "../agent-signins.js";
import { cookieOnly, int, need, readJson } from "./lib.js";

const { sessions, oauthTokens, oauthClients, chunks, pendingEmbeddings } = dbSchema;

export const accountRoutes = new Hono<AppEnv>();

const tildeHome = (p: string) => { const h = homedir(); return h && p.startsWith(h + "/") ? `~${p.slice(h.length)}` : p; };

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
    database: u ? { ...deps.dbInfo, dataDir: deps.dbInfo.dataDir ? tildeHome(deps.dbInfo.dataDir) : null } : null,
  };
  return c.json(body);
});

accountRoutes.post("/signout", async (c) => {
  cookieOnly(c);
  const u = await currentUser(c);
  // agents connected by this person stop with the sign-out, not in 30 days
  if (u) await endAgentSignInsOf(c.get("deps").db, u.id);
  await c.get("deps").db.delete(sessions).where(eq(sessions.sid, c.get("sid")));
  return c.body(null, 204);
});

/** Drops this computer's copy of the grant. The grant itself is revoked in One. */
accountRoutes.post("/connect/disconnect", async (c) => {
  cookieOnly(c);
  const deps = c.get("deps");
  const u = await currentUser(c);
  if (u) await endAgentSignInsOf(deps.db, u.id);
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

const KEYS: (keyof SettingsData)[] = ["embedding", "rerank", "engine", "chatModel", "proposalModel", "localChatModel", "localProposalModel", "jevModel", "backfillDefault", "slackTier", "vipEntityIds", "lanesOn", "paused", "onePlan", "oneRpm"];

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
  if (patch.onePlan !== undefined && !["auto", "free", "starter", "pro", "custom"].includes(patch.onePlan)) throw badRequest('onePlan is "auto", "free", "starter", "pro" or "custom".');
  if (patch.oneRpm !== undefined && patch.oneRpm !== null && !(Number.isInteger(patch.oneRpm) && patch.oneRpm >= 1 && patch.oneRpm <= 100_000)) throw badRequest("oneRpm is a whole number of calls a minute, 1 to 100000.");
  const before = await getSettings(deps.db, u.id);
  if ((patch.onePlan ?? before.onePlan) === "custom" && !(patch.oneRpm !== undefined ? patch.oneRpm : before.oneRpm)) throw badRequest("Custom needs oneRpm, the calls a minute your plan allows.");
  const next = await putSettings(deps.db, u.id, patch);
  if (patch.onePlan !== undefined || patch.oneRpm !== undefined) {
    planChanged(u.id, { plan: next.onePlan, rpm: next.oneRpm });
  }
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

/** How Search keeps to the One plan right now (Settings, General). */
accountRoutes.get("/one-plan", async (c) => {
  const u = await requireUser(c);
  const deps = c.get("deps");
  const st = await getSettings(deps.db, u.id);
  const b = budgetFor(u.id);
  if (b.setting.plan !== st.onePlan || b.setting.rpm !== st.oneRpm) planChanged(u.id, { plan: st.onePlan, rpm: st.oneRpm });
  const t = await oneUsageTotals(deps.db, u.id);
  const body: OnePlanStatus = { ...b.status(), todayCalls: t.today, monthCalls: t.month };
  return c.json(body);
});

accountRoutes.get("/access", async (c) => {
  need(c, "account:read");
  const u = await requireUser(c);
  return c.json(await accessResponse(c.get("deps"), u));
});

/**
 * The declined write, on the Acme sample only. A real Connect app asks for
 * everything, so a person's grant may allow a delete: Search never sends one.
 */
accountRoutes.post("/access/receipt-demo", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  if (!u.isSample) throw badRequest("The declined call is shown on the Acme sample only. Search never sends a write on a real account.");
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

/** Every OAuth client this user has tokens from, active first (CONTRACT 15). */
export async function oauthClientRows(db: Db, userId: string): Promise<OAuthClientRow[]> {
  const rows = (await db.execute(sql`
    select t.client_id, max(t.last_used_at) as last_used_at, min(t.created_at) as created_at,
      count(*) filter (where t.revoked_at is null and t.expires_at > now() and t.kind = 'refresh')::int as active,
      (array_agg(t.scopes order by t.created_at desc))[1] as scopes
    from oauth_tokens t where t.user_id = ${userId} group by t.client_id
    order by count(*) filter (where t.revoked_at is null and t.expires_at > now() and t.kind = 'refresh') > 0 desc, max(coalesce(t.last_used_at, t.created_at)) desc`)).rows as { client_id: string; last_used_at: Date | null; created_at: Date; active: number; scopes: string[] | null }[];
  if (!rows.length) return [];
  const clients = await db.select().from(oauthClients).where(inArray(oauthClients.clientId, rows.map((r) => r.client_id)));
  return rows.map((r) => {
    const cl = clients.find((x) => x.clientId === r.client_id);
    return { clientId: r.client_id, name: cl?.clientName ?? r.client_id, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null, scopes: r.scopes ?? (cl?.scope ?? "").split(/\s+/).filter(Boolean), activeTokens: r.active };
  });
}

/** Ends every live token of these clients for this user. */
export async function revokeClients(db: Db, userId: string, clientIds: string[]): Promise<void> {
  if (!clientIds.length) return;
  await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.userId, userId), inArray(oauthTokens.clientId, clientIds), isNull(oauthTokens.revokedAt)));
}

accountRoutes.get("/oauth-clients", async (c) => {
  cookieOnly(c);
  const u = await requireUser(c);
  return c.json(await oauthClientRows(c.get("deps").db, u.id));
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
