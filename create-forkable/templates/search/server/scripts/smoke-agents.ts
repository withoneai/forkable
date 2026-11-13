// Agents smoke (SPEC 16.5, CONTRACT 18): the Agents routes against fake `claude`
// and `codex` binaries and a temp agent home, so no real agent config is ever read
// or written, and a no-op `open` first on PATH so nothing opens a browser.
// Checks detection, the same-origin and session guards, connect (each agent's own
// command or a JSON merge), the one-click sign-in (bound to /mcp only), a second
// connect changing nothing, backups, only ever touching Search's own entries and
// skill (a `search` that is someone else's is left alone and Search uses
// `search-local`), symlinks, read-only files, byte-order marks, empty files,
// disconnect putting files and folders back, and the public agent files.
//
//   pnpm --filter @search/server smoke:agents
//   SMOKE_REAL_AGENTS=1 ...   also runs the real claude and codex (if installed)
//                             against the same temp folder and reads their own
//                             `mcp get` / `mcp list` (Codex on an address with no
//                             OAuth, so it never opens a browser)
//
// Must stay the first import: fails the run if it touches the repo's Connect ask or .env.
import "@search/core/test-guard";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { findBinary } from "@search/core/local-agent";
import { dbSchema } from "@search/core";

const free = (port: number) => new Promise<boolean>((done) => { const s = net.createServer(); s.once("error", () => done(false)); s.listen(port, "127.0.0.1", () => s.close(() => done(true))); });
async function pickPort(): Promise<number> {
  if (process.env.SMOKE_PORT) {
    const p = Number(process.env.SMOKE_PORT);
    if (!(await free(p))) { console.error(`SMOKE_PORT ${p} is in use${process.env.SEARCH_PORT === String(p) ? " (it is also SEARCH_PORT: a Search is running there)" : ""}. Pick a free one.`); process.exit(2); }
    return p;
  }
  for (let p = 52381; p < 52481; p++) if (String(p) !== process.env.SEARCH_PORT && (await free(p))) return p;
  throw new Error("no free port");
}
const PORT = await pickPort();
const root = mkdtempSync(join(tmpdir(), "search-smoke-agents-"));
const H = join(root, "agent-home");
const BIN = join(root, "bin");
const LOG = join(root, "calls.log");
const elsewhere = join(root, "not-the-agent-home");
for (const d of [H, BIN, elsewhere]) mkdirSync(d, { recursive: true });
writeFileSync(join(BIN, "open"), "#!/bin/sh\nexit 0\n"); chmodSync(join(BIN, "open"), 0o755);
writeFileSync(join(BIN, "xdg-open"), "#!/bin/sh\nexit 0\n"); chmodSync(join(BIN, "xdg-open"), 0o755);

// async on purpose: `claude mcp get` health-checks this same process's server
const sh = async (bin: string, args: string[], env: NodeJS.ProcessEnv) => (await promisify(execFile)(bin, args, { env, encoding: "utf8", timeout: 90_000 })).stdout;
const realClaude = findBinary("claude");
const realCodex = findBinary("codex");

process.env.SEARCH_AGENT_HOME = H;
// A shell that points these somewhere else must not leak through the override.
process.env.CLAUDE_CONFIG_DIR = join(elsewhere, "claude");
process.env.CODEX_HOME = join(elsewhere, "codex");
process.env.FAKE_LOG = LOG;
process.env.SEARCH_NO_OPEN = "1";
process.env.PATH = `${BIN}:/usr/bin:/bin`;

const { agentPaths } = await import("../src/agent-config.js");
const { startServer } = await import("../src/node.js");
const agents = await import("../src/agents.js");

let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 500)})` : ""}`);
};

const fakeClaude = `#!${process.execPath}
const fs = require("fs"), path = require("path");
const dir = process.env.CLAUDE_CONFIG_DIR; const file = path.join(dir, ".claude.json");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: "claude", argv: process.argv.slice(2), dir, home: process.env.HOME }) + "\\n");
const a = process.argv.slice(2);
const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
const write = (d) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2)); };
if (a[0] === "mcp" && a[1] === "add") {
  const dash = a.indexOf("--"); const head = dash >= 0 ? a.slice(2, dash) : a.slice(2); const tail = dash >= 0 ? a.slice(dash + 1) : [];
  const pos = head.filter((x, i, all) => !x.startsWith("-") && !["--scope", "-s", "--transport", "-t"].includes(all[i - 1]));
  const name = pos[0]; const d = read(); d.mcpServers ??= {};
  if (d.mcpServers[name]) { console.error("MCP server " + name + " already exists in user config"); process.exit(1); }
  d.mcpServers[name] = dash >= 0 ? { type: "stdio", command: tail[0], args: tail.slice(1), env: {} } : { type: "http", url: pos[1] };
  write(d); console.log("Added MCP server " + name); process.exit(0);
}
if (a[0] === "mcp" && a[1] === "remove") {
  const d = read(); if (!d.mcpServers || !d.mcpServers[a[2]]) { console.error("No MCP server named " + a[2]); process.exit(1); }
  delete d.mcpServers[a[2]]; write(d); process.exit(0);
}
process.exit(2);
`;
const fakeCodex = `#!${process.execPath}
const fs = require("fs"), path = require("path");
const dir = process.env.CODEX_HOME; const file = path.join(dir, "config.toml");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: "codex", argv: process.argv.slice(2), dir, home: process.env.HOME }) + "\\n");
const a = process.argv.slice(2);
const read = () => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
if (a[0] === "mcp" && a[1] === "add") {
  const name = a[2], url = a[a.indexOf("--url") + 1];
  fs.mkdirSync(dir, { recursive: true });
  const t = read(); fs.writeFileSync(file, (t && !t.endsWith("\\n") ? t + "\\n" : t) + "\\n[mcp_servers." + name + "]\\nurl = \\"" + url + "\\"\\n");
  process.exit(0);
}
if (a[0] === "mcp" && a[1] === "remove") {
  const lines = read().split("\\n"); const out = []; let skip = false;
  for (const l of lines) { if (/^\\[/.test(l)) skip = l.trim() === "[mcp_servers." + a[2] + "]"; if (!skip) out.push(l); }
  fs.writeFileSync(file, out.join("\\n").replace(/\\n{3,}/g, "\\n\\n")); process.exit(0);
}
process.exit(2);
`;

const calls = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { bin: string; argv: string[]; dir: string; home: string }) : []);
const searchHome = join(root, "search-home");
const backups = (label: string) => { const d = join(searchHome, "backups", "agents"); return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith(`${label}-`)) : []; };
const jsonOf = (f: string) => JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, ""));

// ---------- the paths, before any server ----------
const P = agentPaths();
check("paths: every agent path sits inside SEARCH_AGENT_HOME", [P.claudeJson, P.claudeSkills, P.codexConfig, P.cursorConfig, P.desktopConfig].every((p) => p.startsWith(H)), P);
check("paths: a CLAUDE_CONFIG_DIR outside the override is ignored", P.claudeConfigDir === join(H, ".claude"), P.claudeConfigDir);
check("paths: a CODEX_HOME outside the override is ignored", P.codexHome === join(H, ".codex"), P.codexHome);
{
  let threw = false;
  try { agentPaths({ ...process.env, SEARCH_AGENT_HOME: "" }); } catch { threw = true; }
  check("paths: under a test, no SEARCH_AGENT_HOME throws instead of using the real home", threw);
}

const server = await startServer({ env: { HOME: searchHome, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55456), SECRETS: "file", ENV_DIR: searchHome, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: process.env.SMOKE_LOG ? (l) => console.log(`  [server] ${l}`) : () => {} });
const base = `http://localhost:${PORT}`;
const MCP = `${base}/mcp`;
const ROOT = server.env.ROOT;
const LAUNCHER = join(ROOT, "cli", "bin", "search-mcp");
let cookie = "";
/** Same-origin by default, like the Agents page; pass origin: "" to leave it out. */
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { origin: base } : {}), ...headers };
  if (h.origin === "") delete h.origin;
  const res = await fetch(`${base}${path.startsWith("/api") ? path : `/api/v1${path}`}`, { method, redirect: "manual", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("search_sid="));
  if (set) cookie = set.split(";")[0]!;
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}
const row = (r: { json: any }, id: string) => (r.json?.agents ?? []).find((a: any) => a.id === id);
async function mcpInit(token: string) {
  return fetch(MCP, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) });
}

try {
  let r = await call("GET", "/agents");
  check("GET /agents with no session is 401", r.status === 401, r.status);
  r = await call("POST", "/sources/sample");
  check("sample sign-in", r.status === 200, r.status);
  const me = (await call("GET", "/me")).json;

  // ---------- detection ----------
  r = await call("GET", "/agents");
  check("GET /agents: four agents, the MCP address and the sentence", r.status === 200 && r.json.agents.length === 4 && r.json.mcpUrl === MCP && r.json.setupSentence === `Set up Search for me with ${base}/start.md`, r.json);
  check("nothing installed: every agent is not found", r.json.agents.every((a: any) => a.state === "not_found" && !a.found), r.json.agents.map((a: any) => a.state));

  writeFileSync(join(BIN, "claude"), fakeClaude); chmodSync(join(BIN, "claude"), 0o755);
  writeFileSync(join(BIN, "codex"), fakeCodex); chmodSync(join(BIN, "codex"), 0o755);
  mkdirSync(P.cursorDir, { recursive: true });
  const cursorOriginal = { mcpServers: { other: { url: "https://example.com/mcp" } }, theme: "dark" };
  writeFileSync(P.cursorConfig, `${JSON.stringify(cursorOriginal, null, 2)}\n`, { mode: 0o640 });
  chmodSync(P.cursorConfig, 0o640);
  mkdirSync(join(H, "Applications", "Claude.app"), { recursive: true }); // found by its app; its config folder is not there yet
  mkdirSync(P.codexHome!, { recursive: true });
  const codexOriginal = `model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n`;
  writeFileSync(P.codexConfig, codexOriginal);

  r = await call("GET", "/agents");
  check("fakes on PATH, apps and config folders: all four found, none connected", r.json.agents.every((a: any) => a.found && a.state === "not_connected"), r.json.agents.map((a: any) => [a.id, a.state, a.foundWhere]));

  // ---------- the guards ----------
  {
    const { request } = await import("node:http");
    const got = await new Promise<{ status: number; body: string }>((done, fail) => {
      const req = request({ host: "127.0.0.1", port: PORT, path: "/api/v1/agents", headers: { host: `evil.example:${PORT}`, cookie } }, (res) => {
        let body = ""; res.on("data", (d) => { body += d; }); res.on("end", () => done({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", fail); req.end();
    });
    check("another Host is refused (local_only)", got.status === 403 && /local_only/.test(got.body), got);
    check("with the Agents screen's own words, not the Connect setup's", /Apps can be connected only from Search on this computer/.test(got.body) && !/Connect setup/.test(got.body), got.body);
  }
  r = await call("POST", "/agents/cursor/connect", undefined, { origin: "https://evil.example" });
  check("a write from another site is refused", r.status === 403 && /local_only|forbidden_origin/.test(r.json?.error?.code ?? ""), r.json);
  r = await call("POST", "/agents/cursor/connect", undefined, { origin: "http://localhost:5999" });
  check("a write from another localhost port is refused", r.status === 403 && r.json?.error?.code === "forbidden_origin", r.json);
  r = await call("POST", "/agents/cursor/connect", undefined, { origin: "" });
  check("a write with no Origin is refused", r.status === 403 && r.json?.error?.code === "forbidden_origin", r.json);
  r = await call("DELETE", "/agents/cursor", undefined, { "sec-fetch-site": "same-site" });
  check("a write the browser marks same-site (not same-origin) is refused", r.status === 403, r.json);
  check("none of those touched the cursor config", JSON.stringify(jsonOf(P.cursorConfig)) === JSON.stringify(cursorOriginal));
  r = await call("POST", "/agents/nope/connect");
  check("an unknown agent is 404", r.status === 404, r.json);

  // ---------- Claude Code: one click, signed in ----------
  r = await call("POST", "/agents/claude-code/connect");
  const add = calls().filter((c) => c.bin === "claude" && c.argv[1] === "add");
  const wantArgs = ["--server", base, "--as", "claude-code", "--home", searchHome];
  check("connect claude-code: 200 and Connected at once (signed in by the click)", r.status === 200 && r.json.changed === true && r.json.agent.state === "connected" && /Open a new Claude Code session/.test(r.json.agent.nextStep ?? ""), r.json);
  check("it ran `claude mcp add --scope user search -- <launcher> --server ... --as claude-code --home ...`", add.length === 1 && add[0]!.argv.join(" ") === ["mcp", "add", "--scope", "user", "search", "--", LAUNCHER, ...wantArgs].join(" "), add);
  check("with CLAUDE_CONFIG_DIR and HOME inside the temp home", add[0]?.dir === join(H, ".claude") && add[0]?.home === H, add[0]);
  const tokFile = join(searchHome, "agents", "claude-code-token.json");
  const tok = existsSync(tokFile) ? JSON.parse(readFileSync(tokFile, "utf8")) : null;
  check("its sign-in is in SEARCH_HOME/agents (0600), never in the agent's config", !!tok && (statSync(tokFile).mode & 0o777) === 0o600 && tok.server === base && !readFileSync(P.claudeJson, "utf8").includes(tok.accessToken), tok && Object.keys(tok));
  check("that sign-in works on /mcp", (await mcpInit(tok.accessToken)).status === 200);
  check("and not on the REST API (bound to /mcp)", (await fetch(`${base}/api/v1/sources`, { headers: { authorization: `Bearer ${tok.accessToken}` } })).status === 401);
  const skill = join(P.claudeSkills, "search", "SKILL.md");
  check("the usage skill is in Claude Code's skills folder", existsSync(skill) && /^---\nname: search\n/.test(readFileSync(skill, "utf8")) && r.json.agent.skillInstalled === true);
  r = await call("POST", "/agents/claude-code/connect");
  const tok2 = JSON.parse(readFileSync(tokFile, "utf8"));
  check("connect again: nothing changes, claude is not run again, the sign-in is kept", r.status === 200 && r.json.changed === false && calls().filter((c) => c.bin === "claude").length === 1 && tok2.refreshToken === tok.refreshToken, { changed: r.json.changed });
  r = await call("GET", "/agents");
  check("Signed-in apps lists Search for Claude Code", (await call("GET", "/oauth-clients")).json.some((c: any) => c.name === "Search for Claude Code" && c.activeTokens === 1));

  // ---------- Codex (HTTP, its own sign-in) ----------
  r = await call("POST", "/agents/codex/connect");
  const cadd = calls().filter((c) => c.bin === "codex" && c.argv[1] === "add");
  check("connect codex: `codex mcp add search --url <mcp>` with CODEX_HOME in the temp home", r.status === 200 && cadd.length === 1 && cadd[0]!.argv.join(" ") === `mcp add search --url ${MCP}` && cadd[0]!.dir === join(H, ".codex"), { status: r.status, cadd, json: r.json });
  check("codex config keeps its other settings", readFileSync(P.codexConfig, "utf8").startsWith(codexOriginal.trimEnd()), readFileSync(P.codexConfig, "utf8"));
  check("codex: added, one step left (codex mcp login search)", r.json.agent.state === "added" && /codex mcp login search/.test(r.json.agent.nextStep), r.json.agent);
  check("a backup of the codex config was kept", backups("codex").length === 1, backups("codex"));
  r = await call("POST", "/agents/codex/connect");
  check("codex again: unchanged, not run again", r.json.changed === false && calls().filter((c) => c.bin === "codex").length === 1);

  // ---------- Cursor: one click, signed in ----------
  r = await call("POST", "/agents/cursor/connect");
  const cursorNow = jsonOf(P.cursorConfig);
  check("connect cursor: the bridge entry merged, the rest of the file kept", r.status === 200 && r.json.changed && cursorNow.theme === "dark" && cursorNow.mcpServers.other.url === "https://example.com/mcp" && cursorNow.mcpServers.search.command === LAUNCHER && cursorNow.mcpServers.search.args.join(" ") === ["--server", base, "--as", "cursor", "--home", searchHome].join(" "), cursorNow);
  check("cursor: Connected at once with how to start", r.json.agent.state === "connected" && /Cursor picks it up/.test(r.json.agent.nextStep ?? "") && /in Cursor open Settings, then MCP/.test(r.json.agent.nextStep ?? ""), r.json.agent);
  check("cursor: file mode kept (0640)", (statSync(P.cursorConfig).mode & 0o777) === 0o640, (statSync(P.cursorConfig).mode & 0o777).toString(8));
  check("cursor: a backup holds the original", backups("cursor").length === 1 && JSON.parse(readFileSync(join(searchHome, "backups", "agents", backups("cursor")[0]!), "utf8")).theme === "dark", backups("cursor"));
  check("cursor: no temp file left beside it", readdirSync(P.cursorDir).every((f) => !f.includes(".search-")), readdirSync(P.cursorDir));
  r = await call("POST", "/agents/cursor/connect");
  check("cursor again: unchanged, no second backup", r.json.changed === false && backups("cursor").length === 1, { changed: r.json.changed, b: backups("cursor") });

  // ---------- Claude Desktop: the launcher, a folder Search makes ----------
  r = await call("POST", "/agents/claude-desktop/connect");
  const desk = jsonOf(P.desktopConfig);
  const entry = desk.mcpServers?.search;
  check("connect claude-desktop: creates the config with the launcher (no node path)", r.status === 200 && entry?.command === LAUNCHER && !JSON.stringify(entry).includes(process.execPath) && existsSync(LAUNCHER), entry);
  check("claude-desktop: no token in the config", !JSON.stringify(desk).match(/sat_|srt_|Bearer|token/i), desk);
  check("claude-desktop: Connected, ready after a restart", r.json.agent.state === "connected" && /Quit Claude and open it again/.test(r.json.agent.nextStep), r.json.agent);

  // ---------- an agent's sign-in belongs to the account that pressed Connect ----------
  {
    const deskTok = () => JSON.parse(readFileSync(join(searchHome, "agents", "claude-desktop-token.json"), "utf8"));
    const before = deskTok();
    check("claude-desktop's sign-in works before sign-out", (await mcpInit(before.accessToken)).status === 200);
    await call("POST", "/signout");
    check("sign-out ends the agent sign-ins of that account", (await mcpInit(before.accessToken)).status === 401);
    await call("POST", "/sources/sample");
    // ---- the Acme sample never ends the real account's agent sign-ins ----
    {
      const { issueAgentSignIn } = await import("../src/oauth.js");
      const { bindSid } = await import("../src/session.js");
      const { endAgentSignInsOf } = await import("../src/agent-signins.js");
      const { OWN_ACCOUNT_NOTE } = await import("../src/routes/agents.js");
      await server.deps.db.insert(dbSchema.users).values({ id: "usr_smoke_real", name: "Real" }).onConflictDoNothing();
      const realTok = await issueAgentSignIn(server.deps, "usr_smoke_real", { agentId: "claude-desktop", clientName: "Search for Claude Desktop", resource: MCP });
      check("a real account's agent sign-in works", (await mcpInit(realTok.tokens.access_token)).status === 200);
      // another browser opens the sample, and so does an agent's consent page
      await bindSid(server.deps.db, "sid_smoke_sample_elsewhere", "usr_sample");
      const again2 = await call("POST", "/sources/sample");
      check("opening the Acme sample (app or consent page) leaves the real account's agent signed in", again2.status === 200 && (await mcpInit(realTok.tokens.access_token)).status === 200);
      r = await call("GET", "/agents");
      check("while the browser shows the sample, the card says the app still searches your own account", row(r, "claude-desktop").state === "connected" && row(r, "claude-desktop").note === OWN_ACCOUNT_NOTE && typeof r.json.sampleNote === "string" && /Acme sample/.test(r.json.sampleNote), { row: row(r, "claude-desktop"), note: r.json.sampleNote });
      await endAgentSignInsOf(server.deps.db, "usr_smoke_real");
      r = await call("GET", "/agents");
      check("with no real sign-in left, no sample note", !r.json.sampleNote, r.json.sampleNote);
    }
    r = await call("GET", "/agents");
    check("after sign-out the card asks for Connect again", row(r, "claude-desktop").added && row(r, "claude-desktop").needsConnect === true && row(r, "claude-desktop").state === "added" && /Press Connect/.test(row(r, "claude-desktop").nextStep ?? ""), row(r, "claude-desktop"));
    r = await call("POST", "/agents/claude-desktop/connect");
    const again = deskTok();
    check("Connect again signs it in anew", r.json.agent.state === "connected" && !r.json.agent.needsConnect && again.accessToken !== before.accessToken && (await mcpInit(again.accessToken)).status === 200, r.json.agent);
    // a different real account finishes Sign in with One on this Search (connect.ts calls this then)
    const { endOtherAccountsAgentSignIns } = await import("../src/agent-signins.js");
    await server.deps.db.insert(dbSchema.users).values({ id: "usr_smoke_other", name: "Other" }).onConflictDoNothing();
    await endOtherAccountsAgentSignIns(server.deps.db, "usr_smoke_other");
    check("another real account signing in ends the old account's agent sign-ins", (await mcpInit(again.accessToken)).status === 401);
    r = await call("GET", "/agents");
    check("and the old account's card asks for Connect again", row(r, "claude-desktop").needsConnect === true, row(r, "claude-desktop"));
    r = await call("POST", "/agents/claude-desktop/connect");
    check("Connect once more works", r.json.agent.state === "connected", r.json.agent);
    await call("POST", "/agents/cursor/connect");
  }

  // ---------- disconnect puts things back ----------
  r = await call("DELETE", "/agents/cursor");
  check("remove cursor: the file is back to the original", r.status === 200 && r.json.changed && JSON.stringify(jsonOf(P.cursorConfig)) === JSON.stringify(cursorOriginal) && r.json.agent.state === "not_connected", readFileSync(P.cursorConfig, "utf8"));
  r = await call("DELETE", "/agents/claude-desktop");
  check("remove claude-desktop: the file and the folder Search made are gone again", r.status === 200 && !existsSync(P.desktopConfig) && !existsSync(P.desktopDir), { file: existsSync(P.desktopConfig), dir: existsSync(P.desktopDir) });
  check("remove claude-desktop: its sign-in file is gone", !existsSync(join(searchHome, "agents", "claude-desktop-token.json")));
  r = await call("DELETE", "/agents/codex");
  check("remove codex: `codex mcp remove search`, the other server kept", calls().some((c) => c.bin === "codex" && c.argv.join(" ") === "mcp remove search") && !/mcp_servers\.search/.test(readFileSync(P.codexConfig, "utf8")) && /mcp_servers\.other/.test(readFileSync(P.codexConfig, "utf8")), readFileSync(P.codexConfig, "utf8"));
  r = await call("DELETE", "/agents/claude-code");
  check("remove claude-code: `claude mcp remove search --scope user`, the skill and its folder are gone", calls().some((c) => c.bin === "claude" && c.argv.join(" ") === "mcp remove search --scope user") && !existsSync(skill) && !existsSync(dirname(skill)) && r.json.agent.state === "not_connected", r.json.agent);
  check("remove claude-code also signs it out (the token stops working)", (await mcpInit(tok.accessToken)).status === 401);
  const appsAfter = (await call("GET", "/oauth-clients")).json as { name: string }[];
  check("after Remove, the removed agents are gone from Signed-in apps (not listed as signed out)", !appsAfter.some((c) => /^Search for (Claude Code|Cursor|Claude Desktop)$/.test(c.name)), appsAfter.map((c) => c.name));
  r = await call("DELETE", "/agents/cursor");
  check("remove again: nothing to do", r.status === 200 && r.json.changed === false, r.json);

  // ---------- a "search" that is someone else's ----------
  const theirs = { command: "npx", args: ["some-web-search-mcp"] };
  writeFileSync(P.cursorConfig, `${JSON.stringify({ mcpServers: { search: theirs } }, null, 2)}\n`);
  r = await call("GET", "/agents");
  check("a foreign `search` in Cursor is not counted as Search, and the card says so", row(r, "cursor").state === "not_connected" && /different server called search/.test(row(r, "cursor").note ?? ""), row(r, "cursor"));
  r = await call("POST", "/agents/cursor/connect");
  let cur = jsonOf(P.cursorConfig);
  check("connect: theirs untouched, Search added as search-local", r.status === 200 && JSON.stringify(cur.mcpServers.search) === JSON.stringify(theirs) && cur.mcpServers["search-local"]?.command === LAUNCHER && r.json.agent.entryName === "search-local" && /search-local/.test(r.json.message), { cur, msg: r.json.message });
  r = await call("DELETE", "/agents/cursor");
  cur = jsonOf(P.cursorConfig);
  check("remove: only search-local goes, theirs stays", JSON.stringify(cur.mcpServers) === JSON.stringify({ search: theirs }), cur);
  writeFileSync(P.cursorConfig, `${JSON.stringify({ mcpServers: { search: { command: "my-own-search-tool" }, "search-local": { url: "https://other.example/mcp" } } }, null, 2)}\n`);
  const both = readFileSync(P.cursorConfig, "utf8");
  r = await call("POST", "/agents/cursor/connect");
  check("both names taken by others: 409 name_taken, file untouched", r.status === 409 && r.json.error.code === "name_taken" && readFileSync(P.cursorConfig, "utf8") === both, r.json);
  // Claude Code's own `search`
  const cj = jsonOf(P.claudeJson);
  cj.mcpServers = { ...(cj.mcpServers ?? {}), search: { type: "stdio", command: "my-own-search-tool", args: [] } };
  writeFileSync(P.claudeJson, JSON.stringify(cj, null, 2));
  r = await call("POST", "/agents/claude-code/connect");
  const cj2 = jsonOf(P.claudeJson);
  check("claude-code with a foreign `search`: added as search-local, theirs untouched", r.status === 200 && cj2.mcpServers.search.command === "my-own-search-tool" && cj2.mcpServers["search-local"]?.command === LAUNCHER, cj2.mcpServers);
  r = await call("DELETE", "/agents/claude-code");
  check("remove: `claude mcp remove search-local` only; theirs stays", calls().some((c) => c.bin === "claude" && c.argv.join(" ") === "mcp remove search-local --scope user") && !calls().some((c) => c.bin === "claude" && c.argv.join(" ") === "mcp remove search --scope user" && false) && jsonOf(P.claudeJson).mcpServers.search?.command === "my-own-search-tool", jsonOf(P.claudeJson).mcpServers);
  delete cj2.mcpServers.search; delete cj2.mcpServers["search-local"];
  writeFileSync(P.claudeJson, JSON.stringify(cj2, null, 2));

  // ---------- a skill called search that someone else wrote ----------
  mkdirSync(join(P.claudeSkills, "search"), { recursive: true });
  writeFileSync(join(P.claudeSkills, "search", "SKILL.md"), "---\nname: search\ndescription: my own web search\n---\nMine.\n");
  r = await call("POST", "/agents/claude-code/connect");
  check("their search skill is kept; Search's guide goes to search-local", readFileSync(join(P.claudeSkills, "search", "SKILL.md"), "utf8").includes("Mine.") && existsSync(join(P.claudeSkills, "search-local", "SKILL.md")) && /name: search-local/.test(readFileSync(join(P.claudeSkills, "search-local", "SKILL.md"), "utf8")) && /skill called search/.test(r.json.message), r.json.message);
  r = await call("DELETE", "/agents/claude-code");
  check("remove keeps their skill and drops only Search's", readFileSync(join(P.claudeSkills, "search", "SKILL.md"), "utf8").includes("Mine.") && !existsSync(join(P.claudeSkills, "search-local")));
  rmSync(join(P.claudeSkills, "search"), { recursive: true });

  // ---------- files: broken, read-only, symlinked, BOM, empty ----------
  writeFileSync(P.cursorConfig, "{ not json");
  r = await call("POST", "/agents/cursor/connect");
  check("a broken cursor config: 409 invalid_config and the file untouched", r.status === 409 && r.json.error.code === "invalid_config" && readFileSync(P.cursorConfig, "utf8") === "{ not json", r.json);
  writeFileSync(P.cursorConfig, "{}\n"); chmodSync(P.cursorConfig, 0o444);
  r = await call("POST", "/agents/cursor/connect");
  check("a read-only cursor config: 409 read_only and the file untouched", r.status === 409 && r.json.error.code === "read_only" && readFileSync(P.cursorConfig, "utf8") === "{}\n" && /read-only/.test(r.json.error.message), r.json);
  chmodSync(P.cursorConfig, 0o644); rmSync(P.cursorConfig);
  // (inside the agent home: under a test, a link pointing out of it is refused too)
  const real = join(H, "dotfiles", "cursor-mcp.json");
  mkdirSync(dirname(real), { recursive: true });
  writeFileSync(real, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  symlinkSync(real, P.cursorConfig);
  r = await call("POST", "/agents/cursor/connect");
  check("a symlinked config: written through to its target, the link kept", r.status === 200 && lstatSync(P.cursorConfig).isSymbolicLink() && readlinkSync(P.cursorConfig) === real && jsonOf(real).mcpServers.search?.command === LAUNCHER, { status: r.status, link: lstatSync(P.cursorConfig).isSymbolicLink() });
  await call("DELETE", "/agents/cursor");
  check("remove through the symlink too", lstatSync(P.cursorConfig).isSymbolicLink() && !jsonOf(real).mcpServers.search);
  rmSync(P.cursorConfig);
  mkdirSync(P.desktopDir, { recursive: true });
  writeFileSync(P.desktopConfig, `﻿${JSON.stringify({ globalShortcut: "Alt+Space" })}`);
  r = await call("POST", "/agents/claude-desktop/connect");
  const withBom = readFileSync(P.desktopConfig, "utf8");
  check("a config with a byte-order mark: read, merged, the mark kept", r.status === 200 && withBom.charCodeAt(0) === 0xfeff && jsonOf(P.desktopConfig).globalShortcut === "Alt+Space" && !!jsonOf(P.desktopConfig).mcpServers.search, r.json);
  await call("DELETE", "/agents/claude-desktop");
  check("remove: the BOM file back to its own keys", readFileSync(P.desktopConfig, "utf8").charCodeAt(0) === 0xfeff && JSON.stringify(jsonOf(P.desktopConfig)) === JSON.stringify({ globalShortcut: "Alt+Space" }));
  writeFileSync(P.cursorConfig, "");
  r = await call("POST", "/agents/cursor/connect");
  check("an empty cursor config: Search added", r.status === 200 && !!jsonOf(P.cursorConfig).mcpServers.search, r.json);
  await call("DELETE", "/agents/cursor");
  check("remove: the empty file is empty again", readFileSync(P.cursorConfig, "utf8") === "", readFileSync(P.cursorConfig, "utf8"));

  // ---------- signed in, but not in the agent's settings ----------
  rmSync(join(H, "Applications", "Claude.app"), { recursive: true }); rmSync(P.desktopConfig);
  const { issueAgentSignIn } = await import("../src/oauth.js");
  await issueAgentSignIn(server.deps, me.user.id, { agentId: "claude-desktop", clientName: "Search for Claude Desktop", resource: MCP });
  r = await call("GET", "/agents");
  check("Claude Desktop signed in but missing: not 'not on this computer', with a note", row(r, "claude-desktop").state === "not_connected" && row(r, "claude-desktop").found && /Signed in earlier/.test(row(r, "claude-desktop").note ?? ""), row(r, "claude-desktop"));

  // ---------- the agent files ----------
  const startRes = await fetch(`${base}/start.md`);
  const start = await startRes.text();
  check("GET /start.md: the steps, Connect first, list_sources", /# Set up Search/.test(start) && start.includes(`${base}/settings/agents`) && /list_sources/.test(start) && /pnpm run search install/.test(start), start.slice(0, 200));
  const me2 = userInfo().username;
  check("start.md: the install command names this server's real address", start.includes(`pnpm run search install <claude-code | codex | cursor | claude-desktop> --server ${base}`) && start.includes(`pnpm run search install --server ${base}\``), start.slice(start.indexOf("## 2"), start.indexOf("## 4")));
  check("the server says where it runs in SEARCH_HOME/server.json", JSON.parse(readFileSync(join(searchHome, "server.json"), "utf8")).url === base);
  check("GET /start.md names no folder, program path or person", !start.includes(ROOT) && !start.includes(process.execPath) && !start.includes(searchHome) && !new RegExp(`/(Users|home)/${me2}\\b`).test(start));
  check("start.md does not promise Connected for any other agent", !/now shows\s+you as Connected/.test(start) && /Claude Code, Codex, Cursor and\s+Claude Desktop also show as Connected/.test(start));
  const sk = await fetch(`${base}/skill.md`);
  const skText = await sk.text();
  check("GET /skill.md: markdown with frontmatter, understand explained", sk.status === 200 && /markdown/.test(sk.headers.get("content-type") ?? "") && /^---\nname: search\ndescription: /.test(skText) && /understand: true/.test(skText));
  const wk = await (await fetch(`${base}/.well-known/agent-skills/search/SKILL.md`)).text();
  check("GET /.well-known/agent-skills/search/SKILL.md is the same skill", wk === skText);
  const idx = await (await fetch(`${base}/.well-known/agent-skills/index.json`)).json() as any;
  check("skills index lists search with a digest", idx.skills?.[0]?.name === "search" && /^sha256:/.test(idx.skills[0].digest), idx);
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  check("GET /llms.txt links start.md and skill.md", llms.includes(`${base}/start.md`) && llms.includes(`${base}/skill.md`));
  const copy = [start, skText, llms].join("\n");
  check("agent files: no dashes, exclamation marks or banned words", !/[–—]|!\s|seamless|frictionless|cutting-edge|revolutionary|AI-powered|leverage/i.test(copy.replace(/<!--[^]*?-->/g, "")), copy.match(/[–—]|!\s|seamless|frictionless|cutting-edge|revolutionary|AI-powered|leverage/i)?.[0]);

  // ---------- the real CLIs, on the same temp folder ----------
  if (process.env.SMOKE_REAL_AGENTS === "1") {
    rmSync(join(BIN, "claude")); rmSync(join(BIN, "codex"));
    process.env.PATH = `${BIN}:${[realClaude, realCodex].filter(Boolean).map((b) => dirname(b!)).join(":")}:/usr/bin:/bin`;
    // the bridge Claude Code health-checks needs a node: the launcher takes SEARCH_NODE
    const env = { ...process.env, HOME: H, CLAUDE_CONFIG_DIR: join(H, ".claude"), CODEX_HOME: join(H, ".codex"), SEARCH_NODE: process.execPath, SEARCH_NO_OPEN: "1" };
    if (realClaude) {
      r = await call("POST", "/agents/claude-code/connect");
      check("real claude: connect works and is signed in", r.status === 200 && r.json.agent.state === "connected", r.json);
      const got = await sh(realClaude, ["mcp", "get", "search"], env);
      check("real claude: its own `mcp get search` shows user scope, the launcher, and Connected", /User config/.test(got) && got.includes(LAUNCHER) && /Connected|✔|✓/.test(got), got);
      r = await call("POST", "/agents/claude-code/connect");
      check("real claude: connect again is a no-op", r.json.changed === false, r.json);
      r = await call("DELETE", "/agents/claude-code");
      const after = await sh(realClaude, ["mcp", "list"], env);
      check("real claude: after remove, `mcp list` has no search", r.status === 200 && !/^search:/m.test(after), after);
    } else console.log("skip real claude: not installed");
    if (realCodex) {
      // An address with nothing behind it: Codex adds the entry and has no OAuth to start, so no browser.
      const dead = `http://localhost:${PORT + 1}`;
      const ctx = { searchHome, base: dead, root: ROOT, waitForLogin: true };
      const c1 = await agents.connectAgent("codex", ctx);
      const list = JSON.parse(await sh(realCodex, ["mcp", "list", "--json"], env)) as { name: string; transport: { url?: string } }[];
      check("real codex: `codex mcp add` worked; its own `mcp list --json` has search at the address", c1.agent.added && list.some((s) => s.name === "search" && s.transport.url === `${dead}/mcp`), list);
      await agents.disconnectAgent("codex", ctx);
      const after = JSON.parse(await sh(realCodex, ["mcp", "list", "--json"], env)) as { name: string }[];
      check("real codex: after remove, no search", !after.some((s) => s.name === "search"), after);
    } else console.log("skip real codex: not installed");
  }
} catch (e) {
  failures++;
  console.log(`FAIL crashed: ${(e as Error).stack}`);
} finally {
  await server.stop();
  if (!process.env.SMOKE_KEEP) rmSync(root, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
