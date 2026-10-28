import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import { handleMcp } from "./mcp.js";
import { connectFor } from "./connect.js";
import { auth } from "./auth.js";
import { web } from "./web.js";

// Two modes, one Worker.
//  AUTH=off  /mcp is open and every UI answers from the Acme sample.
//  AUTH=one  /mcp needs a token from this server's OAuth, which signs the
//            user in with One; every UI then runs on their grant.

const mcpHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext & { props?: { userId?: string } }) {
    const userId = ctx.props?.userId;
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const connect = connectFor(env);
    return handleMcp(req, { userId, connect, kv: env.OAUTH_KV, db: env.DB, publicUrl: env.PUBLIC_URL });
  },
};

// Built on first request: the resource id is this server's public /mcp URL.
let provider: OAuthProvider<Env> | null = null;
const providerFor = (env: Env) =>
  (provider ??= new OAuthProvider<Env>({
  resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, resource_name: "Forkable blocks" },
  apiRoute: "/mcp",
  apiHandler: mcpHandler as any,
  defaultHandler: { fetch: (req: Request, env: Env, ctx: ExecutionContext) => auth.fetch(req, env, ctx) } as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
}));

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    if (env.AUTH === "off") {
      const url = new URL(req.url);
      if (url.pathname === "/mcp") return handleMcp(req, { userId: "sample", connect: null, kv: env.OAUTH_KV, db: env.DB, publicUrl: env.PUBLIC_URL });
      return web.fetch(req, env, ctx);
    }
    return providerFor(env).fetch(req, env, ctx);
  },
};
