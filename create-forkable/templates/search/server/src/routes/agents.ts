// The Agents screen's routes (CONTRACT 6.4): browser session only, this computer
// only (Host and Origin on loopback), and never on a hosted build. They read and
// write the coding agents' own config files, so nothing else may reach them.

import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "@search/core";
import type { AgentId, AgentsResponse } from "@search/core";
import { isHosted } from "@search/core/local-agent";
import { ConfigError } from "../agent-config.js";
import { setupSentence } from "../agent-docs.js";
import { AGENT_IDS, agentRows, bridgeClientName, connectAgent, disconnectAgent, type AgentContext } from "../agents.js";
import { issueAgentSignIn, origins } from "../oauth.js";
import { forgetAgentClients } from "../agent-signins.js";
import type { AppEnv } from "../deps.js";
import { ApiError } from "../errors.js";
import { requireUser } from "../session.js";
import { oauthClientRows, revokeClients } from "./account.js";
import { cookieOnly } from "./lib.js";
import { localOnly } from "./setup.js";

export const agentRoutes = new Hono<AppEnv>();

export const OWN_ACCOUNT_NOTE = "Connected to your own account, not the sample. It keeps searching your own things while this window shows the sample.";
export const SAMPLE_AGENTS_NOTE = "You are looking at the Acme sample. Apps you connected with your own account keep searching your own account. Press Connect here only if you want an app to search the sample instead.";

/** The real (not sample) account with the most recent live agent sign-in, if any. */
async function realAgentOwner(db: Db): Promise<string | null> {
  const rows = (await db.execute(sql`
    select t.user_id from oauth_tokens t join users u on u.id = t.user_id
    where not u.is_sample and t.kind = 'refresh' and t.revoked_at is null and t.expires_at > now()
    order by coalesce(t.last_used_at, t.created_at) desc limit 1`)).rows as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

function guard(c: Context<AppEnv>): void {
  cookieOnly(c);
  if (isHosted()) throw new ApiError(404, "not_found", "Agents connect only to a Search running on your own computer.");
  localOnly(c, AGENTS_LOCAL_ONLY);
}

/** Said when the Agents routes are reached from anywhere but this computer's own Search page. */
export const AGENTS_LOCAL_ONLY = "Apps can be connected only from Search on this computer. Open Search here, go to Agents, and try again.";

/** The pages allowed to change an agent's config: this server and its own dev UI, nothing else on localhost. */
export function allowedOrigins(c: Context<AppEnv>): string[] {
  const env = c.get("deps").env;
  const list = [...origins(c.get("deps"))];
  if (env.UI_URL) {
    const u = new URL(env.UI_URL);
    list.push(u.origin, `${u.protocol}//localhost:${u.port}`, `${u.protocol}//127.0.0.1:${u.port}`);
  }
  return [...new Set(list)];
}

/**
 * Every port on localhost is one "site" to the browser, so the SameSite session
 * cookie alone would let any local page click Connect. A write needs the exact
 * Origin of this server or its UI, and a browser that says it is not cross-site.
 */
function sameOriginWrite(c: Context<AppEnv>): void {
  const origin = c.req.header("origin");
  if (!origin) throw new ApiError(403, "forbidden_origin", "This change needs to come from Search's own page.");
  if (!allowedOrigins(c).includes(origin)) throw new ApiError(403, "forbidden_origin", `${origin} may not change your agents. Open Search itself.`);
  const site = c.req.header("sec-fetch-site");
  if (site && site !== "same-origin") throw new ApiError(403, "forbidden_origin", "This change needs to come from Search's own page.");
}

export function agentContext(c: Context<AppEnv>): AgentContext {
  const deps = c.get("deps");
  return { searchHome: deps.env.HOME, base: baseOf(c), root: deps.env.ROOT };
}

/** The address agents should use: the one this page came in on when it is loopback, else the server's own. */
function baseOf(c: Context<AppEnv>): string {
  const env = c.get("deps").env;
  const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" ? `http://127.0.0.1:${env.PORT}` : `http://localhost:${env.PORT}`;
}

function idOf(c: Context<AppEnv>): AgentId {
  const id = c.req.param("id") as AgentId;
  if (!AGENT_IDS.includes(id)) throw new ApiError(404, "not_found", "No such agent.");
  return id;
}

function toApiError(e: unknown): unknown {
  if (e instanceof ConfigError) return new ApiError(e.code === "not_found" ? 404 : e.code === "failed" ? 500 : 409, e.code === "failed" ? "agent_failed" : e.code, e.message);
  return e;
}

agentRoutes.get("/agents", async (c) => {
  guard(c);
  const deps = c.get("deps");
  const u = await requireUser(c);
  const ctx = agentContext(c);
  const clients = await oauthClientRows(deps.db, u.id);
  const mcpUrl = `${ctx.base}/mcp`;
  let agents = agentRows(ctx, clients);
  let sampleNote: string | null = null;
  if (u.isSample) {
    // The browser shows the sample, but agents connected under the real account keep
    // reading the real account (their token names it). Show them as they are.
    const owner = await realAgentOwner(deps.db);
    if (owner) {
      const real = agentRows(ctx, await oauthClientRows(deps.db, owner));
      const kept = real.filter((r) => r.state === "connected").map((r) => r.id);
      agents = agents.map((row) => (kept.includes(row.id) && row.state !== "connected" ? { ...real.find((r) => r.id === row.id)!, note: OWN_ACCOUNT_NOTE } : row));
      if (kept.length) sampleNote = SAMPLE_AGENTS_NOTE;
    }
  }
  const body: AgentsResponse = {
    local: true, mcpUrl, startUrl: `${ctx.base}/start.md`, setupSentence: setupSentence(ctx.base),
    genericJson: JSON.stringify({ mcpServers: { search: { type: "http", url: mcpUrl } } }, null, 2),
    agents, sampleNote,
  };
  return c.json(body);
});

agentRoutes.post("/agents/:id/connect", async (c) => {
  guard(c);
  sameOriginWrite(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  const ctx = agentContext(c);
  ctx.loadClients = () => oauthClientRows(deps.db, u.id);
  ctx.clients = await ctx.loadClients();
  // One click: the agent's own sign-in, bound to /mcp, issued from this session.
  ctx.issueSignIn = async (id) => {
    const { clientId, tokens } = await issueAgentSignIn(deps, u.id, { agentId: id, clientName: bridgeClientName(id), resource: `${ctx.base}/mcp` });
    return { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(), scopes: (tokens.scope ?? "").split(" ").filter(Boolean) };
  };
  try {
    const r = await connectAgent(idOf(c), ctx);
    return c.json({ ...r, agent: agentRows(ctx, await ctx.loadClients()).find((a) => a.id === r.agent.id)! });
  } catch (e) { throw toApiError(e); }
});

agentRoutes.delete("/agents/:id", async (c) => {
  guard(c);
  sameOriginWrite(c);
  const u = await requireUser(c);
  const deps = c.get("deps");
  const ctx = agentContext(c);
  const id = idOf(c);
  try {
    // sign the agent out too: its tokens stop working now, not in 30 days
    const before = agentRows(ctx, await oauthClientRows(deps.db, u.id)).find((a) => a.id === id)!;
    const r = await disconnectAgent(id, ctx);
    await revokeClients(deps.db, u.id, before.clientIds);
    await forgetAgentClients(deps.db, u.id, before.clientIds);
    return c.json({ ...r, agent: agentRows(ctx, await oauthClientRows(deps.db, u.id)).find((a) => a.id === id)! });
  } catch (e) { throw toApiError(e); }
});
