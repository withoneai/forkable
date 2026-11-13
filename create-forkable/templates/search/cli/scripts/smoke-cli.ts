// CLI smoke (SPEC 19, Phase 3): a Search server on the sample (tmp SEARCH_HOME, own
// ports), then the real `search` bin as a child process: login (the scripted browser
// picks "Use the Acme sample" on the consent page and the CLI's loopback catches the
// code), whoami, a query, ask, sources, profiles list/export/validate/import, open's
// error path, mcp-config, an expired access token refreshed on the fly, logout.
//
//   pnpm --filter @withone/search smoke

// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "@search/server/node";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/search.mjs");
const PORT = Number(process.env.SMOKE_PORT ?? 52381);
const home = mkdtempSync(join(tmpdir(), "search-smoke-cli-"));
const cliHome = mkdtempSync(join(tmpdir(), "search-smoke-cli-home-"));
const agentHome = mkdtempSync(join(tmpdir(), "search-smoke-cli-agents-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail)?.slice(0, 400)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55455), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: () => {} });
const base = `http://localhost:${PORT}`;
// SEARCH_AGENT_HOME: `search install` only ever sees a temp agent home; PATH without
// any real claude or codex, so install never runs them.
// a no-op `open` first on PATH: nothing in this smoke may open a browser window
const noOpen = mkdtempSync(join(tmpdir(), "search-smoke-cli-noopen-"));
for (const n of ["open", "xdg-open"]) { writeFileSync(join(noOpen, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(noOpen, n), 0o755); }
const env = { ...process.env, SEARCH_HOME: cliHome, SEARCH_SERVER: base, NO_COLOR: "1", SEARCH_AGENT_HOME: agentHome, SEARCH_NO_OPEN: "1", PATH: `${noOpen}:${dirname(process.execPath)}:/usr/bin:/bin` };

function run(args: string[], onLine?: (line: string) => void): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [BIN, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", buf = "";
    p.stdout.on("data", (d) => {
      out += d; buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { onLine?.(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => done({ code: code ?? 1, out, err }));
  });
}

/** The browser: consent page -> "Use the Acme sample" -> follow the redirect to the CLI's loopback. */
async function browse(url: string): Promise<void> {
  const res = await fetch(url, { redirect: "manual" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const pending = /name="pending" value="([^"]+)"/.exec(await res.text())?.[1];
  const r = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { cookie, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ pending: pending ?? "", action: "sample" }).toString() });
  await fetch(r.headers.get("location")!);
}

try {
  let r = await run(["whoami"]);
  check("whoami before login exits 3", r.code === 3 && /search login/.test(r.err), r);
  r = await run(["globex"]);
  check("a query before login exits 3", r.code === 3, r);

  let browsed: Promise<void> | null = null;
  r = await run(["login", "--no-open"], (line) => {
    const m = /^\s+(http\S+\/authorize\?\S+)$/.exec(line);
    if (m && !browsed) browsed = browse(m[1]!);
  });
  await browsed;
  check("search login signs in through the browser (sample)", r.code === 0 && /Signed in as Dana Oyelaran \(Acme sample\)/.test(r.out), r);
  const tokFile = join(cliHome, "cli-token.json");
  const tok = JSON.parse(readFileSync(tokFile, "utf8"));
  check("the token file is 0600 with the four scopes", (statSync(tokFile).mode & 0o777) === 0o600 && tok.scopes.length === 4 && tok.server === base && tok.refreshToken.startsWith("srt_"), tok.scopes);

  r = await run(["whoami"]);
  check("whoami", r.code === 0 && r.out.includes("Dana Oyelaran") && r.out.includes("search:read"), r);
  r = await run(["globex"]);
  check('search "globex" prints rows', r.code === 0 && /HubSpot/.test(r.out) && /\d+ matches, (hybrid|keyword)/.test(r.out) && r.out.split("\n").filter((l) => /^\s*\d+\s{2}/.test(l)).length >= 5, r.out);
  r = await run(["globex", "--json", "--limit", "3", "--type", "deal"]);
  const sj = JSON.parse(r.out);
  check("--json --limit --type gives a SearchResponse", r.code === 0 && sj.results.length <= 3 && sj.results.every((x: any) => x.kind === "deal") && !!sj.queryId, sj.results?.map((x: any) => x.kind));
  r = await run(["from:priya", "type:mail", "after:30d", "--json"]);
  check("operators pass through (3 mails from Priya)", JSON.parse(r.out).total === 3);
  r = await run(["ask", "where are we with globex?"]);
  check("search ask answers with numbered sources", r.code === 0 && /Priya Shah/.test(r.out) && /\[1\]/.test(r.out) && /^\[3\]/m.test(r.out), r.out);
  r = await run(["ask", "where are we with globex?", "--json"]);
  check("search ask --json", JSON.parse(r.out).citations.length >= 3);
  r = await run(["sources"]);
  check("search sources lists the sample sources", r.code === 0 && /Gmail/.test(r.out) && /healthy/.test(r.out) && r.out.trim().split("\n").length >= 11, r.out);
  r = await run(["profiles", "list"]);
  check("search profiles list", r.code === 0 && /gmail\.threads/.test(r.out), r.out.slice(0, 300));
  const pid = (JSON.parse((await run(["profiles", "list", "--json"])).out) as any[]).find((p) => p.slug === "linear.issues")?.id;
  const packFile = join(cliHome, "linear.json");
  r = await run(["profiles", "export", pid, packFile]);
  check("search profiles export writes a pack", r.code === 0 && JSON.parse(readFileSync(packFile, "utf8")).platform === "linear", r);
  r = await run(["profiles", "validate", packFile]);
  check("search profiles validate (offline) passes the export", r.code === 0 && /^ok\s+linear\./m.test(r.out), r.out);
  const broken = JSON.parse(readFileSync(packFile, "utf8"));
  delete broken.profiles[0].list;
  writeFileSync(join(cliHome, "broken.json"), JSON.stringify(broken));
  r = await run(["profiles", "validate", join(cliHome, "broken.json")]);
  check("validate fails a broken pack with exit 1", r.code === 1, r.out);
  r = await run(["profiles", "import", packFile]);
  check("search profiles import previews without --yes", r.code === 0 && /linear/.test(r.out) && /Not imported/.test(r.out), r);
  r = await run(["open", "itm_nope"]);
  check("search open on an unknown id exits 1", r.code === 1 && /not found/i.test(r.err), r);
  r = await run(["sources", "sync"]);
  check("a usage error exits 2", r.code === 2, r);

  // ---------- fetch ----------
  const anId = JSON.parse((await run(["globex", "--json", "--limit", "1"])).out).results[0].id as string;
  r = await run(["fetch", anId]);
  check("search fetch <id> prints the title and the full text", r.code === 0 && r.out.split("\n").length > 3 && /Globex/i.test(r.out), r.out.slice(0, 300));
  r = await run(["fetch", anId, "--json"]);
  const fj = JSON.parse(r.out);
  check("search fetch --json gives id, title, text and metadata", r.code === 0 && fj.id === anId && typeof fj.text === "string" && fj.text.length > 20 && !!fj.metadata.source, fj);
  r = await run(["fetch", "itm_nope"]);
  check("search fetch on an unknown id exits 1", r.code === 1 && /not found/i.test(r.err), r);
  r = await run(["fetch"]);
  check("search fetch with no id exits 2", r.code === 2, r);

  // ---------- a sign-in folder Search cannot write ----------
  {
    const tokPath = join(cliHome, "cli-token.json");
    const saved = readFileSync(tokPath, "utf8");
    // an access token that needs a refresh, so the CLI has to write to the folder
    writeFileSync(tokPath, JSON.stringify({ ...JSON.parse(saved), expiresAt: new Date(Date.now() - 60_000).toISOString() }));
    chmodSync(cliHome, 0o500);
    try {
      r = await run(["sources"]);
      check("read-only sign-in folder: the CLI says what is wrong and what to do, no stack trace", r.code === 1 && /do not have permission to write in/.test(r.err) && /chmod u\+w/.test(r.err) && !/\n\s+at /.test(r.err) && !/EACCES/.test(r.err), r.err.slice(0, 400));
      const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--server", base], env: env as Record<string, string>, stderr: "pipe" });
      const client = new Client({ name: "smoke-readonly", version: "0" });
      await client.connect(transport);
      const t = (await client.callTool({ name: "list_sources", arguments: {} })) as any;
      const text = String(t.content?.[0]?.text ?? "");
      check("read-only sign-in folder: the bridge says the same, not \"Search is not running\"", t.isError === true && /permission to write/.test(text) && !/not running/.test(text), text.slice(0, 300));
      await client.close();
    } finally {
      chmodSync(cliHome, 0o700);
      writeFileSync(tokPath, saved, { mode: 0o600 });
    }
  }

  // ---------- the stdio bridge with the CLI's sign-in ----------
  {
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--server", base], env: env as Record<string, string>, stderr: "pipe" });
    const client = new Client({ name: "smoke-stdio", version: "0" });
    await client.connect(transport);
    check("search mcp: an MCP client over stdio initializes", client.getServerVersion()?.name === "search", client.getServerVersion());
    const { tools } = await client.listTools();
    check("search mcp: lists the five tools", tools.length === 5, tools.map((t) => t.name));
    const res = await client.callTool({ name: "search", arguments: { query: "globex", limit: 2 } }) as any;
    check("search mcp: search runs through the bridge with paging", !res.isError && res.structuredContent.results.length === 2 && res.structuredContent.nextOffset === 2, res);
    const f = await client.callTool({ name: "fetch", arguments: { id: anId } }) as any;
    check("search mcp: fetch runs through the bridge", !f.isError && f.structuredContent.id === anId, f.content?.[0]?.text?.slice(0, 200));
    await client.close();
  }

  // ---------- the bridge with its own sign-in (Claude Desktop's --as) ----------
  {
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--server", base, "--as", "claude-desktop"], env: env as Record<string, string>, stderr: "pipe" });
    let browsedAs: Promise<void> | null = null, errText = "";
    transport.stderr?.on("data", (d) => {
      errText += String(d);
      const m = /(http\S+\/authorize\?\S+)/.exec(errText);
      if (m && !browsedAs) browsedAs = browse(m[1]!);
    });
    const client = new Client({ name: "smoke-desktop", version: "0" });
    await client.connect(transport);
    for (let i = 0; i < 50 && !browsedAs; i++) await new Promise((res) => setTimeout(res, 100));
    await browsedAs;
    const agentTok = join(cliHome, "agents", "claude-desktop-token.json");
    const at = existsSync(agentTok) ? JSON.parse(readFileSync(agentTok, "utf8")) : null;
    check("search mcp --as claude-desktop: first start signs itself in through the browser", !!at && at.scopes.join(" ") === "search:read search:ask" && (statSync(agentTok).mode & 0o777) === 0o600, { at: at?.scopes, err: errText.slice(0, 300) });
    let ls: any = null;
    for (let i = 0; i < 30; i++) {
      ls = await client.callTool({ name: "list_sources", arguments: {} });
      if (!ls.isError) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    check("search mcp --as: list_sources answers once it is signed in", !ls.isError && ls.structuredContent.sources.length >= 11, ls.content?.[0]?.text?.slice(0, 200));
    check("the agent's token is bound to /mcp: refused on the REST API", (await fetch(`${base}/api/v1/sources`, { headers: { authorization: `Bearer ${at.accessToken}` } })).status === 401);
    const cliTok = JSON.parse(readFileSync(join(cliHome, "cli-token.json"), "utf8"));
    check("the person's own CLI token works on both /api/v1 and /mcp", (await fetch(`${base}/api/v1/sources`, { headers: { authorization: `Bearer ${cliTok.accessToken}` } })).status === 200
      && (await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${cliTok.accessToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status === 200);
    await client.close();
    const { dbSchema } = await import("@search/core");
    const names = (await server.deps.db.select({ n: dbSchema.oauthClients.clientName }).from(dbSchema.oauthClients)).map((x) => x.n);
    check("its sign-in shows up as Search for Claude Desktop", names.includes("Search for Claude Desktop"), names);
    const second = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--server", base, "--as", "claude-desktop"], env: env as Record<string, string>, stderr: "pipe" });
    const c2 = new Client({ name: "smoke-desktop-2", version: "0" });
    await c2.connect(second);
    check("the next start reuses that sign-in (no browser)", (await c2.listTools()).tools.length === 5);
    // the sign-in really ends (Remove on the Agents screen): the person is told what to do, in plain words
    await fetch(`${base}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: at.clientId, token: JSON.parse(readFileSync(agentTok, "utf8")).refreshToken }).toString() });
    const gone: any = await c2.callTool({ name: "list_sources", arguments: {} });
    const goneText = String(gone.content?.[0]?.text ?? "");
    check("an ended agent sign-in tells the person to open Search, Agents and press Connect again (no command to run)", gone.isError && /Open Search/.test(goneText) && /Agents/.test(goneText) && /Connect/.test(goneText) && !/pnpm|search login/.test(goneText), goneText);
    await c2.close();
  }

  // ---------- the launcher: no node on the agent's PATH ----------
  {
    const launcher = resolve(dirname(BIN), "search-mcp");
    const transport = new StdioClientTransport({ command: launcher, args: ["--server", base], env: { ...(env as Record<string, string>), PATH: "/usr/bin:/bin", SEARCH_NODE: process.execPath }, stderr: "pipe" });
    const client = new Client({ name: "smoke-launcher", version: "0" });
    await client.connect(transport);
    check("cli/bin/search-mcp starts the bridge with no node on PATH (SEARCH_NODE)", (await client.listTools()).tools.length === 5);
    await client.close();
  }

  // ---------- the bridge when Search is not running yet, then is ----------
  {
    const { createServer, request } = await import("node:http");
    const probe = createServer(); await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", () => ok()));
    const pport = (probe.address() as { port: number }).port; await new Promise((ok) => probe.close(ok));
    const proxyUrl = `http://localhost:${pport}`;
    const home2 = mkdtempSync(join(tmpdir(), "search-smoke-cli-home2-"));
    writeFileSync(join(home2, "cli-token.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(cliHome, "cli-token.json"), "utf8")), server: proxyUrl }), { mode: 0o600 });
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--server", proxyUrl], env: { ...(env as Record<string, string>), SEARCH_HOME: home2 }, stderr: "pipe" });
    const client = new Client({ name: "smoke-recover", version: "0" }, { capabilities: {} });
    let listChanged = false;
    const { ToolListChangedNotificationSchema } = await import("@modelcontextprotocol/sdk/types.js");
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { listChanged = true; });
    await client.connect(transport);
    check("Search down: the bridge still answers initialize (it does not exit)", client.getServerVersion()?.name === "search");
    const down = await client.callTool({ name: "list_sources", arguments: {} }) as any;
    check("Search down: a tool call is a clear tool error", down.isError === true && /not running at/.test(down.content?.[0]?.text ?? ""), down);
    // Search comes up (a proxy to the running one)
    const proxy = createServer((req, res) => {
      const up = request({ host: "127.0.0.1", port: PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${PORT}` } }, (r2) => { res.writeHead(r2.statusCode ?? 502, r2.headers); r2.pipe(res); });
      req.pipe(up);
    });
    await new Promise<void>((ok) => proxy.listen(pport, "127.0.0.1", () => ok()));
    let upNow: any = null;
    for (let i = 0; i < 40; i++) {
      upNow = await client.callTool({ name: "list_sources", arguments: {} });
      if (!upNow.isError) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    check("Search up: the same bridge recovers and answers", !upNow.isError && upNow.structuredContent.sources.length >= 11, upNow?.content?.[0]?.text?.slice(0, 200));
    for (let i = 0; i < 20 && !listChanged; i++) await new Promise((res) => setTimeout(res, 100));
    check("and tells the client its tools changed", listChanged);
    await client.close();
    await new Promise((ok) => proxy.close(ok));
    rmSync(home2, { recursive: true, force: true });
  }

  // ---------- install (same code as the Connect button), on a temp agent home ----------
  mkdirSync(join(agentHome, ".cursor"), { recursive: true });
  writeFileSync(join(agentHome, ".cursor", "mcp.json"), `${JSON.stringify({ mcpServers: { other: { url: "https://example.com/mcp" } } }, null, 2)}\n`);
  r = await run(["install", "--json"]);
  const listed = JSON.parse(r.out);
  check("search install lists the four agents with what it found", r.code === 0 && listed.length === 4 && listed.find((x: any) => x.id === "cursor").found === true && listed.find((x: any) => x.id === "claude-code").found === false, listed.map((x: any) => [x.id, x.found]));
  r = await run(["install", "cursor"]);
  const cur = JSON.parse(readFileSync(join(agentHome, ".cursor", "mcp.json"), "utf8"));
  check("search install cursor merges the bridge entry and keeps the rest", r.code === 0 && /Added Search to Cursor/.test(r.out) && /search-mcp$/.test(cur.mcpServers.search.command) && cur.mcpServers.search.args.includes("--as") && cur.mcpServers.other.url === "https://example.com/mcp", { out: r.out, cur });
  check("from the CLI (no session) it says the browser asks once", /browser asks you to allow Search/.test(r.out), r.out);
  r = await run(["install", "cursor"]);
  check("search install cursor again changes nothing", r.code === 0 && /already has Search/.test(r.out), r.out);
  {
    // no --server, no SEARCH_SERVER, no sign-in: install finds the Search running on this SEARCH_HOME (server.json), not 52289
    const { SEARCH_SERVER: _s, ...noServer } = env;
    const out = await new Promise<string>((done) => {
      const p = spawn(process.execPath, [BIN, "install", "--json"], { env: { ...noServer, SEARCH_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
      let o = ""; p.stdout.on("data", (d) => { o += d; }); p.on("close", () => done(o));
    });
    const rows = JSON.parse(out || "[]");
    check(`search install with no --server finds the running Search on port ${PORT} and sees Search added`, rows.find((x: any) => x.id === "cursor")?.added === true, rows.map((x: any) => [x.id, x.added]));
  }
  r = await run(["install", "cursor", "--remove"]);
  check("search install cursor --remove takes it out", r.code === 0 && !("search" in JSON.parse(readFileSync(join(agentHome, ".cursor", "mcp.json"), "utf8")).mcpServers), r.out);
  r = await run(["install", "claude-code"]);
  check("search install claude-code with no Claude Code here exits 2 with a plain reason", r.code === 2 && /not on this computer/.test(r.err), r);
  r = await run(["install", "nope"]);
  check("search install with an unknown agent exits 2", r.code === 2, r);

  r = await run(["mcp-config", "--client", "claude-code"]);
  check("mcp-config claude-code (user scope)", r.code === 0 && r.out.includes(`claude mcp add --scope user --transport http search ${base}/mcp`), r.out);
  r = await run(["mcp-config", "--client", "cursor"]);
  check("mcp-config cursor", r.code === 0 && r.out.includes(`"url": "${base}/mcp"`) && /mcp\.json/.test(r.out), r.out);
  r = await run(["mcp-config", "--client", "vscode"]);
  check("mcp-config vscode", r.code === 0 && r.out.includes('"servers"') && r.out.includes("code --add-mcp"), r.out);
  r = await run(["mcp-config", "--client", "codex"]);
  check("mcp-config codex", r.code === 0 && r.out.includes(`codex mcp add search --url ${base}/mcp`) && r.out.includes("[mcp_servers.search]"));
  r = await run(["mcp-config", "--client", "claude-desktop"]);
  check("mcp-config claude-desktop uses the stdio bridge", r.code === 0 && r.out.includes('"--as"') && r.out.includes("claude-desktop") && r.out.includes("search.mjs") && !r.out.includes("mcp-remote"), r.out);

  // ---------- flags ----------
  r = await run(["login", "--help"]);
  check("search login --help prints help and does not start a sign-in", r.code === 0 && /^Usage$/m.test(r.out) && !/Opening your browser/.test(r.out + r.err), r);
  r = await run(["globex", "--server", "not a url"]);
  check("--server that is not an http address exits 2", r.code === 2 && /--server must be/.test(r.err), r);
  r = await run(["globex", "--server", "file:///etc/passwd"]);
  check("--server with another scheme exits 2", r.code === 2, r);
  r = await run(["fetch", anId, "--json", "--max-chars", "10"]);
  const f10 = JSON.parse(r.out);
  check("search fetch --max-chars cuts the text and says where to go on", r.code === 0 && f10.text.length === 10 && f10.truncated === true && f10.nextOffset === 10, f10);
  r = await run(["fetch", anId, "--json", "--offset", "10"]);
  check("search fetch --offset reads from there", r.code === 0 && JSON.parse(r.out).offset === 10 && fj.text.slice(10) === JSON.parse(r.out).text, r.out.slice(0, 200));
  r = await run(["fetch", anId, "--offset", "-3"]);
  check("search fetch --offset that is not a whole number exits 2", r.code === 2, r);
  r = await run(["emails", "from", "priya", "last", "week"]);
  check("a plain sentence prints one line saying what was understood", r.code === 0 && /^Understood: .+\. Searched as: .*from:/m.test(r.out), r.out.slice(0, 400));
  r = await run(["emails", "from", "priya", "last", "week", "--exact"]);
  check("--exact searches the words as typed (no Understood line)", r.code === 0 && !/Understood:/.test(r.out), r.out.slice(0, 300));
  r = await run(["emails", "from", "priya", "--json"]);
  const uj = JSON.parse(r.out);
  check("--json carries understood, suggestions and searchedAs", r.code === 0 && Array.isArray(uj.understood) && uj.understood.length > 0 && Array.isArray(uj.suggestions) && typeof uj.searchedAs === "string", { u: uj.understood, s: uj.suggestions });
  r = await run(["emails", "from", "priya", "--exact", "--json"]);
  check("--exact sends understand=0 (nothing understood)", r.code === 0 && JSON.parse(r.out).understood.length === 0, JSON.parse(r.out).understood);
  r = await run(["mcp-config", "--client", "nope"]);
  check("mcp-config with an unknown client exits 2", r.code === 2);

  // An access token past its time is refreshed on the fly and rotated.
  const t2 = JSON.parse(readFileSync(tokFile, "utf8"));
  writeFileSync(tokFile, JSON.stringify({ ...t2, expiresAt: new Date(Date.now() - 1000).toISOString() }), { mode: 0o600 });
  r = await run(["whoami"]);
  const t3 = JSON.parse(readFileSync(tokFile, "utf8"));
  check("an expired token is refreshed and rotated", r.code === 0 && t3.refreshToken !== t2.refreshToken && t3.accessToken !== t2.accessToken, r);

  r = await run(["logout"]);
  check("logout", r.code === 0 && /Signed out/.test(r.out));
  const dead = await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${t3.accessToken}` } });
  check("logout revoked the token on the server", dead.status === 401);
  r = await run(["globex"]);
  check("after logout a query exits 3", r.code === 3);
  r = await run(["mcp", "--server", base]);
  check("search mcp when not signed in exits 3 and says how to sign in", r.code === 3 && /pnpm run search login/.test(r.err), r);

  await server.stop();
  r = await run(["login", "--no-open"]);
  check("login with the server down exits 4", r.code === 4 && /not running/.test(r.err), r);

} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop().catch(() => {});
  rmSync(home, { recursive: true, force: true });
  rmSync(cliHome, { recursive: true, force: true });
  rmSync(agentHome, { recursive: true, force: true });
  rmSync(noOpen, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
