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
  check("the server sends instructions: when to use it, filters, paging", /Reach for it whenever/.test(client.getInstructions() ?? "") && /filters/.test(client.getInstructions() ?? "") && /next page/.test(client.getInstructions() ?? ""));
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check("lists the five tools", names.join() === "ask,fetch,get_entity,list_sources,search", names);
  check("every tool is marked read-only", tools.every((t) => t.annotations?.readOnlyHint === true));
  check("every tool description says when to use it", tools.every((t) => /Use this when/.test(t.description ?? "")), tools.map((t) => t.name));
  const searchProps = Object.keys((tools.find((t) => t.name === "search")?.inputSchema as any)?.properties ?? {}).sort().join();
  check("search takes query, filters, limit, offset and understand", searchProps === "after,before,container,from,limit,offset,query,source,type,understand,with", searchProps);

  const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<{ content: { type: string; text: string }[]; structuredContent?: any; isError?: boolean }>;
  const s = await call("search", { query: "globex renewal", limit: 5 });
  const results = s.structuredContent?.results ?? [];
  check("search: 5 results on the sample with ids, sources and dates", !s.isError && results.length === 5 && results.every((r: any) => r.id && r.source && r.date), s);
  check("search: the text is a numbered list", /^\d+ match/.test(s.content[0]!.text) && s.content[0]!.text.includes("1. "), s.content[0]?.text.slice(0, 200));
  const op = await call("search", { query: "from:priya type:mail after:30d", limit: 10 });
  check("search: operators work (3 mails from Priya)", op.structuredContent?.results?.length === 3, op.structuredContent?.results?.length);

  const sf = await call("search", { source: "gmail", type: "mail", from: "priya", after: "30d", limit: 10 });
  check("search: structured filters match the inline ones (3 mails from Priya)", sf.structuredContent?.results?.length === 3 && sf.structuredContent.query === "source:gmail type:mail from:priya after:30d", sf.structuredContent?.query);
  const sq = await call("search", { query: "renewal", with: "Globex Corp" });
  check("search: a filter value with a space is quoted", sq.structuredContent?.query === 'renewal with:"Globex Corp"', sq.structuredContent?.query);
  const clash = await call("search", { query: "source:gmail globex", source: "hubspot" });
  check("search: a filter in query and in its field with different values is an error naming both", clash.isError === true && /source:gmail/.test(clash.content[0]!.text) && /hubspot/.test(clash.content[0]!.text), clash.content[0]?.text);
  const dup = await call("search", { query: "source:gmail globex", source: "gmail" });
  check("search: the same filter in both places is used once", !dup.isError && dup.structuredContent.query === "source:gmail globex", dup.structuredContent?.query ?? dup.content[0]?.text);
  const yest = await call("search", { query: "globex", after: "yesterday" });
  check("search: date words work in after (yesterday)", !yest.isError && yest.structuredContent.query === "globex after:yesterday", yest.content[0]?.text);
  const lw = await call("search", { query: "globex", after: "last week" });
  check("search: two-word date words work (last week)", !lw.isError && lw.structuredContent.query === "globex after:last-week", lw.content[0]?.text);
  const bad = await call("search", { query: "globex", after: "sometime soon" });
  check("search: a date Search cannot read is a clear error", bad.isError === true && /could not read "sometime soon" as a date/.test(bad.content[0]!.text), bad.content[0]?.text);
  const badq = await call("search", { query: "globex after:blah" });
  check("search: an unreadable filter typed in query is an error too", badq.isError === true && /not a date/.test(badq.content[0]!.text), badq.content[0]?.text);
  const ppl = await call("search", { source: "gmail", type: "mail", limit: 10 });
  const withPeople = (ppl.structuredContent?.results ?? []).filter((r: any) => r.people?.some((p: any) => p.role === "from" && /@/.test(p.email ?? "")));
  check("search: results list people with address and role (who sent each mail)", withPeople.length > 0 && /from [^<\n]+<[^>]+@[^>]+>/.test(ppl.content[0]!.text), ppl.structuredContent?.results?.[0]?.people);
  const lit = await call("search", { query: "emails from priya last week" });
  check("search: understand is off by default (no understood, no searchedAs)", !lit.isError && !("understood" in lit.structuredContent) && !("searchedAs" in lit.structuredContent), Object.keys(lit.structuredContent ?? {}));
  const und = await call("search", { query: "emails from priya last week", understand: true });
  check("search understand: true reads the phrases and says what it read and ran", !und.isError && und.structuredContent.understood.length >= 2 && /from:/.test(und.structuredContent.searchedAs) && /type:/.test(und.structuredContent.searchedAs) && /^Understood: /.test(und.content[0]!.text), { u: und.structuredContent?.understood, s: und.structuredContent?.searchedAs });
  // unknown values say what is valid; channels have their own filter
  const ship = await call("search", { query: "globex type:spaceship" });
  check("search: an unknown type is an error that lists the types", ship.isError === true && /type:spaceship/.test(ship.content[0]!.text) && /one of: mail, event, meeting, deal/.test(ship.content[0]!.text), ship.content[0]?.text);
  const stOpen = await call("search", { query: "status:open", source: "linear" });
  check("search: status:open (not a Linear state) is an error that lists the statuses that exist", stOpen.isError === true && /status:open matches nothing/.test(stOpen.content[0]!.text) && /Linear: .*"in progress"/.test(stOpen.content[0]!.text), stOpen.content[0]?.text);
  const stProg = await call("search", { query: 'status:"in progress"', source: "linear" });
  check("search: the help's status example finds Linear issues", !stProg.isError && stProg.structuredContent?.results?.length >= 1, stProg.content[0]?.text?.slice(0, 200));
  const listed = await client.listTools();
  const searchHelp = listed.tools.find((t) => t.name === "search")?.description ?? "";
  check("search help no longer offers status:open", !/status:open/.test(searchHelp) && /status:"in progress"/.test(searchHelp), searchHelp.slice(0, 200));
  const shipF = await call("search", { query: "globex", type: "spaceship" });
  check("search: an unknown type in its field is the same error", shipF.isError === true && /type:spaceship is not a kind/.test(shipF.content[0]!.text), shipF.content[0]?.text);
  const ms = await call("search", { query: "globex", source: "myspace" });
  check("search: an unknown source is an error that lists the connected ones", ms.isError === true && /myspace is not a connected source/.test(ms.content[0]!.text) && /gmail/.test(ms.content[0]!.text) && /hubspot/.test(ms.content[0]!.text), ms.content[0]?.text);
  const okSrc = await call("search", { query: "globex", source: "outlook" });
  check("search: a short source name for a connected tool still works (outlook)", !okSrc.isError, okSrc.content[0]?.text);
  const ch = await call("search", { query: "in:#deals" });
  check("search: in:#deals reads as the deals channel (container), and says so", !ch.isError && ch.structuredContent.query === "container:deals" && /in:#deals as container:deals/.test(ch.content[0]!.text) && ch.structuredContent.total > 0, ch.content[0]?.text.slice(0, 300));
  const chs = await call("search", { query: "in:#deals", source: "slack" });
  check("search: in:#deals with source slack is no conflict", !chs.isError && chs.structuredContent.query === "container:deals source:slack" && chs.structuredContent.total > 0, chs.content[0]?.text.slice(0, 300));
  const chf = await call("search", { container: "#deals", source: "slack" });
  check("search: the container field filters by channel", !chf.isError && chf.structuredContent.total === chs.structuredContent.total, chf.content[0]?.text.slice(0, 200));
  const none = await call("search", {});
  check("search: no query and no filter is an error", none.isError === true, none);
  const p1 = await call("search", { query: "globex", limit: 3 });
  const p1s = p1.structuredContent;
  check("search: page 1 states the total and the next offset", !p1.isError && p1s.total > 3 && p1s.offset === 0 && p1s.nextOffset === 3 && p1s.results.length === 3 && /offset 3/.test(p1.content[0]!.text) && new RegExp(`of ${p1s.total}`).test(p1.content[0]!.text), { total: p1s?.total, next: p1s?.nextOffset, text: p1.content[0]?.text.slice(0, 120) });
  const p2 = await call("search", { query: "globex", limit: 3, offset: 3 });
  check("search: page 2 has new ids and numbering from 4", p2.structuredContent?.offset === 3 && p2.structuredContent.results.every((r: any) => !p1s.results.some((x: any) => x.id === r.id)) && /^4\. /m.test(p2.content[0]!.text), p2.content[0]?.text.slice(0, 200));
  const last = await call("search", { query: "globex", limit: 50, offset: p1s.total });
  check("search: past the end says all were shown", !last.isError && last.structuredContent.results.length === 0 && /all \d+ were shown/.test(last.content[0]!.text), last.content[0]?.text);
  check("search: every result has a url (the item's own link or Search's page)", p1s.results.every((r: any) => typeof r.url === "string" && r.url.length > 0), p1s.results.map((r: any) => r.url));

  const f = await call("fetch", { id: results[0].id });
  check("fetch: full text and metadata", !f.isError && f.structuredContent?.id === results[0].id && f.structuredContent.text.length > 20 && f.structuredContent.metadata.source, f);
  check("fetch: a short item is whole (truncated false, no next offset)", f.structuredContent?.truncated === false && f.structuredContent.nextOffset === null && f.structuredContent.totalChars === f.structuredContent.text.length, { t: f.structuredContent?.truncated, n: f.structuredContent?.totalChars });
  {
    const pool = (await call("search", { query: "globex", limit: 50 })).structuredContent.results as { id: string }[];
    let long: any = null;
    for (const r of pool) {
      const x = await call("fetch", { id: r.id, max_chars: 200 });
      if (x.structuredContent?.truncated) { long = x; break; }
    }
    check("fetch: an item over max_chars comes back truncated with the next offset", !!long && long.structuredContent.text.length === 200 && long.structuredContent.nextOffset === 200 && /Truncated: call fetch with id .+ and offset 200/.test(long.content[0].text), long?.structuredContent && { len: long.structuredContent.text.length, next: long.structuredContent.nextOffset });
    if (long) {
      const id = long.structuredContent.id;
      let text = long.structuredContent.text, next = long.structuredContent.nextOffset, parts = 1;
      while (next !== null && parts < 50) {
        const more = await call("fetch", { id, offset: next, max_chars: 200 });
        text += more.structuredContent.text; next = more.structuredContent.nextOffset; parts++;
      }
      const whole = await call("fetch", { id, max_chars: 50000 });
      check("fetch: reading on by offset gives back the whole text", text === whole.structuredContent.text && parts > 1 && whole.structuredContent.truncated === false, { parts, a: text.length, b: whole.structuredContent?.text.length });
    }
  }
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
