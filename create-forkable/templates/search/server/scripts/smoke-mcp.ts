// MCP smoke (SPEC 19, Phase 3): the official MCP SDK client against /mcp with no
// token, so it runs the whole MCP auth dance itself (401, protected resource
// metadata, AS metadata, DCR as a public client, /authorize with PKCE, token).
// The "browser" step picks "Use the Acme sample" on the consent page. Then it lists
// the five tools and runs each on the sample. Tmp SEARCH_HOME, own ports.
//
//   pnpm --filter @search/server smoke:mcp

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { sql } from "drizzle-orm";
import { startServer } from "../src/node.js";

const PORT = Number(process.env.SMOKE_PORT ?? 52380);
const home = mkdtempSync(join(tmpdir(), "search-smoke-mcp-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55454), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: () => {} });
const base = `http://localhost:${PORT}`;
const REDIRECT = "http://127.0.0.1:47777/callback";

/** The browser half: open the consent page, choose the sample, read the code off the redirect. */
async function consentWithSample(url: URL): Promise<string> {
  const jar: string[] = [];
  const res = await fetch(url, { redirect: "manual" });
  for (const c of res.headers.getSetCookie()) jar.push(c.split(";")[0]!);
  const html = await res.text();
  const pending = /name="pending" value="([^"]+)"/.exec(html)?.[1];
  if (!pending) throw new Error(`no consent page: ${res.status} ${html.slice(0, 200)}`);
  const r = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { cookie: jar.join("; "), "content-type": "application/x-www-form-urlencoded", origin: base }, body: new URLSearchParams({ pending, action: "sample" }).toString() });
  const loc = new URL(r.headers.get("location") ?? "http://x/");
  const code = loc.searchParams.get("code");
  if (!code) throw new Error(`no code: ${loc}`);
  return code;
}

class Provider implements OAuthClientProvider {
  info?: OAuthClientInformationFull; tok?: OAuthTokens; verifier = ""; authUrl?: URL;
  get redirectUrl() { return REDIRECT; }
  get clientMetadata(): OAuthClientMetadata { return { client_name: "MCP SDK smoke", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; }
  clientInformation() { return this.info; }
  saveClientInformation(i: OAuthClientInformationFull) { this.info = i; }
  tokens() { return this.tok; }
  saveTokens(t: OAuthTokens) { this.tok = t; }
  redirectToAuthorization(u: URL) { this.authUrl = u; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}

const provider = new Provider();
const mkTransport = () => new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider });
try {
  let transport = mkTransport();
  let client = new Client({ name: "smoke", version: "0" });
  try {
    await client.connect(transport);
    check("connect without a token is refused", false);
  } catch (e) {
    check("connect without a token asks for auth (UnauthorizedError)", e instanceof UnauthorizedError, String(e));
  }
  check("the SDK registered a public client by DCR", !!provider.info?.client_id && !provider.info.client_secret, provider.info);
  check("and built an /authorize URL with S256 and the /mcp resource", provider.authUrl?.pathname === "/authorize" && provider.authUrl.searchParams.get("code_challenge_method") === "S256" && provider.authUrl.searchParams.get("resource") === `${base}/mcp`, provider.authUrl?.toString());
  const code = await consentWithSample(provider.authUrl!);
  await transport.finishAuth(code);
  check("finishAuth exchanged the code for tokens", !!provider.tok?.access_token && !!provider.tok.refresh_token && provider.tok.scope === "search:read search:ask", provider.tok);

  transport = mkTransport();
  client = new Client({ name: "smoke", version: "0" });
  await client.connect(transport);
  check("connected with the token", client.getServerVersion()?.name === "search", client.getServerVersion());
  check("the server sends instructions with the operator grammar", /operators/.test(client.getInstructions() ?? ""));
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check("lists the five tools", names.join() === "ask,fetch,get_entity,list_sources,search", names);
  check("every tool is marked read-only", tools.every((t) => t.annotations?.readOnlyHint === true));

  const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: { type: string; text: string }[]; structuredContent?: any; isError?: boolean }>;
  const s = await call("search", { query: "globex renewal", limit: 5 });
  const results = s.structuredContent?.results ?? [];
  check("search: 5 results on the sample with ids, sources and dates", !s.isError && results.length === 5 && results.every((r: any) => r.id && r.source && r.date), s);
  check("search: the text is a numbered list", /^\d+ match/.test(s.content[0]!.text) && s.content[0]!.text.includes("1. "), s.content[0]?.text.slice(0, 200));
  const op = await call("search", { query: "from:priya type:mail after:30d", limit: 10 });
  check("search: operators work (3 mails from Priya)", op.structuredContent?.results?.length === 3, op.structuredContent?.results?.length);

  const f = await call("fetch", { id: results[0].id });
  check("fetch: full text and metadata", !f.isError && f.structuredContent?.id === results[0].id && f.structuredContent.text.length > 20 && f.structuredContent.metadata.source, f);
  const nf = await call("fetch", { id: "itm_nope" });
  check("fetch: an unknown id is an error with no structuredContent", nf.isError === true && !nf.structuredContent, nf);

  const e = await call("get_entity", { query: "priya@globex.com" });
  check("get_entity by email: Priya Shah with recent items", !e.isError && /Priya Shah/.test(e.structuredContent?.entity?.name ?? "") && e.structuredContent.recent.length > 0, e.content[0]?.text.slice(0, 300));
  const e2 = await call("get_entity", { query: "globex.com" });
  check("get_entity by domain: Globex", !e2.isError && e2.structuredContent?.entity?.type === "company", e2.content[0]?.text.slice(0, 200));

  const ls = await call("list_sources", {});
  check("list_sources: every sample source, healthy, with counts", !ls.isError && ls.structuredContent?.sources?.length >= 11 && ls.structuredContent.sources.every((x: any) => x.status === "healthy" && x.items >= 0), ls.structuredContent?.sources?.slice(0, 2));

  const a = await call("ask", { question: "Where are we with Globex?" });
  check("ask: a grounded answer with citations", !a.isError && a.structuredContent?.grounded === true && a.structuredContent.citations.length >= 3 && /\[1\]/.test(a.structuredContent.answer), a);
  const led = (await server.deps.db.execute(sql`select actor, client_id from ledger where actor = 'mcp' and client_id is not null limit 1`)).rows;
  check("ask logs in Activity as mcp with the OAuth client id", led.length === 1, led);
  await client.close();

  // a refreshed token keeps working (the SDK refreshes on 401 when the access token is gone)
  const old = provider.tok!;
  const r = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: provider.info!.client_id, refresh_token: old.refresh_token! }).toString() });
  provider.tok = await r.json() as OAuthTokens;
  client = new Client({ name: "smoke", version: "0" });
  await client.connect(mkTransport());
  check("after a refresh the new token lists tools", (await client.listTools()).tools.length === 5);
  await client.close();
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
