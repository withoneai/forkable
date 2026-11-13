// Refresh stress (SPEC 16.5): many processes share one token file while the access
// token keeps expiring. 8 `search mcp --as claude-code` bridges on the agent's file,
// plus 3 plain bridges and a `search sources` loop on the CLI's file. /token answers
// slowly (up to SEARCH_TEST_TOKEN_DELAY_MS after it rotated). Bridges are SIGKILLed at
// random, some die right after the server rotated (before the file is written), some
// lose the server's answer as if it hung, and others are paused (SIGSTOP) at random
// points and resumed later (SIGCONT): short pauses, the tester's case (paused 1 s into a
// refresh, resumed 40 s later, past the server's grace), long sleeps past the access
// token's life, and everything paused at once like a laptop lid. Every sign-in must
// survive: no call may say the sign-in ended, no token family may be revoked, and a
// call after everything settled must work. "Try again in a moment" while another
// process is paused mid-refresh is allowed and counted.
//
//   pnpm --filter @withone/search stress:refresh   (STRESS_SECONDS=90 by default)

import "@search/core/test-guard";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.SEARCH_OAUTH_ACCESS_TTL_S = "33"; // the bridge refreshes when under 30 s are left: about every 3 s
process.env.SEARCH_TEST_TOKEN_DELAY_MS = process.env.SEARCH_TEST_TOKEN_DELAY_MS ?? "3000"; // a slow /token: the answer comes 1.5 to 3 s after the rotation
const { startServer } = await import("@search/server/node");
const { issueAgentSignIn } = await import("@search/server/oauth");
const { bootstrapSample, SAMPLE_USER } = await import("@search/server/sample");
const { dbSchema } = await import("@search/core");

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/search.mjs");
const PORT = Number(process.env.SMOKE_PORT ?? 52383);
const SECONDS = Number(process.env.STRESS_SECONDS ?? 90);
const home = mkdtempSync(join(tmpdir(), "search-stress-srv-"));
const cliHome = mkdtempSync(join(tmpdir(), "search-stress-cli-"));
const noOpen = mkdtempSync(join(tmpdir(), "search-stress-noopen-"));
for (const n of ["open", "xdg-open"]) { writeFileSync(join(noOpen, n), "#!/bin/sh\nexit 0\n"); chmodSync(join(noOpen, n), 0o755); }

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55457), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: () => {} });
const { deps } = server;
deps.scheduler.kick = async () => null;
const base = `http://localhost:${PORT}`;
await bootstrapSample(deps);

const file = (clientId: string, t: { access_token: string; refresh_token: string; expires_in?: number; scope?: string }) => ({
  server: base, clientId, accessToken: t.access_token, refreshToken: t.refresh_token,
  expiresAt: new Date(Date.now() + Number(t.expires_in ?? 33) * 1000).toISOString(), scopes: String(t.scope ?? "").split(" "),
});
const agent = await issueAgentSignIn(deps, SAMPLE_USER, { agentId: "claude-code", clientName: "Search for Claude Code", resource: `${base}/mcp` });
const cli = await issueAgentSignIn(deps, SAMPLE_USER, { agentId: "stress-cli", clientName: "Stress CLI", resource: base });
mkdirSync(join(cliHome, "agents"), { recursive: true });
const agentFile = join(cliHome, "agents", "claude-code-token.json");
const cliFile = join(cliHome, "cli-token.json");
writeFileSync(agentFile, JSON.stringify(file(agent.clientId, agent.tokens)), { mode: 0o600 });
writeFileSync(cliFile, JSON.stringify(file(cli.clientId, cli.tokens)), { mode: 0o600 });

const env = {
  ...process.env, SEARCH_HOME: cliHome, SEARCH_SERVER: base, NO_COLOR: "1", SEARCH_NO_OPEN: "1",
  SEARCH_TEST_TRACE: join(cliHome, "trace.log"), SEARCH_TEST_DIE_IN_REFRESH: "0.2", SEARCH_TEST_LOSE_REFRESH: "0.12", SEARCH_REFRESH_TIMEOUT_MS: "4000",
  PATH: `${noOpen}:${dirname(process.execPath)}:/usr/bin:/bin`,
};

const stats = { ok: 0, ended: 0, otherErrors: 0, transient: 0, killed: 0, died: 0, spawned: 0, cliRuns: 0, cliFails: 0, paused: 0, midRefreshPauses: 0, longSleeps: 0, lidCloses: 0 };
const TRANSIENT = /Try again in a moment|paused in the middle/;
const errors: string[] = [];
const live = new Set<ChildProcess>();
let stopping = false;

function bridge(as: string | null): void {
  const args = [BIN, "mcp", "--server", base, ...(as ? ["--as", as] : [])];
  const p = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  stats.spawned++;
  live.add(p);
  let buf = "", id = 0, wasKilled = false;
  p.stderr.on("data", () => {});
  const send = (m: unknown) => { try { p.stdin.write(`${JSON.stringify(m)}\n`); } catch { /* gone */ } };
  const next = () => {
    if (stopping || p.exitCode !== null) return;
    send({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: "list_sources", arguments: {} } });
  };
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 0) { send({ jsonrpc: "2.0", method: "notifications/initialized" }); next(); continue; }
      if (m.id === undefined) continue;
      const text = m.result?.content?.[0]?.text ?? m.error?.message ?? "";
      if (m.result && !m.result.isError) stats.ok++;
      else if (/ended|revoked|Connect next to this app/i.test(text)) { stats.ended++; errors.push(text); }
      else if (TRANSIENT.test(text)) stats.transient++;
      else { stats.otherErrors++; errors.push(text); }
      setTimeout(next, 50 + Math.random() * 200);
    }
  });
  p.on("exit", (code, sig) => {
    live.delete(p);
    const t = stopped.get(p.pid!); if (t) { clearTimeout(t); stopped.delete(p.pid!); }
    if (sig === "SIGKILL" && !wasKilled) stats.died++;
    if (!stopping) bridge(as); // the agent starts a new one, as Claude Code would
  });
  (p as ChildProcess & { markKilled?: () => void }).markKilled = () => { wasKilled = true; };
  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stress", version: "0" } } });
}

for (let i = 0; i < 8; i++) bridge("claude-code");
for (let i = 0; i < 3; i++) bridge(null);

// the CLI on the same file as the plain bridges
async function cliLoop(): Promise<void> {
  while (!stopping) {
    const r = await new Promise<{ code: number; err: string }>((done) => {
      const p = spawn(process.execPath, [BIN, "sources"], { env, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => { err += d; });
      p.on("exit", (code, sig) => done({ code: sig === "SIGKILL" ? -9 : code ?? 1, err }));
    });
    stats.cliRuns++;
    if (r.code !== 0 && r.code !== -9) {
      if (TRANSIENT.test(r.err) && !/ended/i.test(r.err)) stats.transient++;
      else { stats.cliFails++; errors.push(`cli: ${r.err.slice(0, 200)}`); }
    }
  }
}
const cliDone = cliLoop();

// kill a random bridge every 700 ms, whatever it is doing (holding the lock, mid-request, idle)
const killer = setInterval(() => {
  const all = [...live];
  const p = all[Math.floor(Math.random() * all.length)];
  if (!p) return;
  (p as ChildProcess & { markKilled?: () => void }).markKilled?.();
  stats.killed++;
  p.kill("SIGKILL");
}, 700);

// ---- pauses (SIGSTOP / SIGCONT) ----
const stopped = new Map<number, NodeJS.Timeout>();
let pausesOver = false;
function pause(pid: number, ms: number): boolean {
  if (pausesOver || stopped.has(pid)) return false;
  try { process.kill(pid, "SIGSTOP"); } catch { return false; }
  stats.paused++;
  stopped.set(pid, setTimeout(() => { stopped.delete(pid); try { process.kill(pid, "SIGCONT"); } catch { /* killed meanwhile */ } }, ms));
  return true;
}
const bridgePids = () => [...live].map((p) => p.pid!).filter((pid) => pid && !stopped.has(pid));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
// short pauses at random points, whatever the bridge is doing
const pauser = setInterval(() => { const pid = pick(bridgePids()); if (pid) pause(pid, 300 + Math.random() * 8000); }, 900);
// the tester's case: whoever just started a refresh is paused 1 s in and resumed 40 s later
const notes = [join(cliHome, "agents", "claude-code-token.json.refreshing"), join(cliHome, "cli-token.json.refreshing")];
let lastMid = 0;
const midWatch = setInterval(() => {
  if (Date.now() - lastMid < 14_000) return;
  for (const n of notes) {
    let pid = 0;
    try { pid = Number(JSON.parse(readFileSync(n, "utf8")).pid); } catch { continue; }
    if (!pid || ![...live].some((p) => p.pid === pid)) continue;
    lastMid = Date.now();
    setTimeout(() => { if (pause(pid, 40_000)) stats.midRefreshPauses++; }, 1000);
    return;
  }
}, 50);
// a long sleep: longer than the access token's life (33 s)
const sleeper = setInterval(() => { const pid = pick(bridgePids()); if (pid && pause(pid, 45_000)) stats.longSleeps++; }, 20_000);
// the lid: every bridge paused at once for 40 s, once, a third of the way in
const lid = setTimeout(() => { stats.lidCloses++; for (const pid of bridgePids()) pause(pid, 40_000); }, SECONDS * 333);

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(killer); clearInterval(pauser); clearInterval(midWatch); clearInterval(sleeper); clearTimeout(lid);
// wake everyone and let the last pauses finish what they were doing (no pause starts after this)
pausesOver = true;
for (const [pid, t] of stopped) { clearTimeout(t); try { process.kill(pid, "SIGCONT"); } catch { /* gone */ } }
stopped.clear();
await new Promise((r) => setTimeout(r, 15_000));
stopping = true;
// never leave a process behind: wake it, ask it to stop, and make sure it did
for (const p of live) { try { p.kill("SIGCONT"); } catch { /* gone */ } p.kill("SIGTERM"); }
setTimeout(() => { for (const p of live) p.kill("SIGKILL"); }, 1000).unref();
await cliDone;
await new Promise((r) => setTimeout(r, 500));

const { oauthTokens } = dbSchema;
const rows = await deps.db.select().from(oauthTokens);
const refreshes = rows.filter((r) => r.kind === "refresh").length - 2;
const familyKilled = rows.some((r) => r.revokedAt && !r.replacedBy);
const filesThere = existsSync(agentFile) && existsSync(cliFile);
const lastAgent = filesThere ? JSON.parse(readFileSync(agentFile, "utf8")) : null;

console.log(JSON.stringify({ seconds: SECONDS, ...stats, refreshes, familyKilled, filesThere }, null, 0));
if (errors.length) console.log("first errors:", [...new Set(errors)].slice(0, 5));

// one last call on the surviving sign-in, after everything settled
const final = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${lastAgent?.accessToken}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).catch(() => null);
// a fresh bridge on the agent's file, like the agent the next morning
const finalBridge = await new Promise<boolean>((done) => {
  const p = spawn(process.execPath, [BIN, "mcp", "--server", base, "--as", "claude-code"], { env: { ...env, SEARCH_TEST_DIE_IN_REFRESH: "0", SEARCH_TEST_LOSE_REFRESH: "0" }, stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  const t = setTimeout(() => { p.kill("SIGKILL"); done(false); }, 30_000);
  p.stdout.on("data", (d) => {
    buf += d;
    for (const line of buf.split("\n")) {
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 0) { p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: {} } })}\n`); buf = ""; }
      if (m.id === 1) { clearTimeout(t); p.kill("SIGTERM"); done(!!m.result && !m.result.isError); }
    }
  });
  p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stress", version: "0" } } })}\n`);
});
// and the plain sign-in's file, through the CLI itself (it refreshes if it must)
const finalCli = await new Promise<number>((done) => { const p = spawn(process.execPath, [BIN, "sources"], { env: { ...env, SEARCH_TEST_DIE_IN_REFRESH: "0", SEARCH_TEST_LOSE_REFRESH: "0" }, stdio: "ignore" }); p.on("exit", (c) => done(c ?? 1)); });
const ok = stats.ended === 0 && stats.otherErrors === 0 && stats.cliFails === 0 && !familyKilled && filesThere && refreshes >= 10 && stats.died > 0 && stats.paused > 0 && finalCli === 0 && finalBridge && (final?.status === 200 || Date.parse(lastAgent?.expiresAt ?? "") < Date.now());
console.log(JSON.stringify({ finalMcp: final?.status ?? null, finalBridge, finalCli }));
console.log(ok ? "ok   the sign-ins survived" : "FAIL the sign-ins did not survive");
if (!ok && existsSync(join(cliHome, "trace.log"))) { const keep = `/tmp/search-stress-trace-${Date.now()}.log`; writeFileSync(keep, readFileSync(join(cliHome, "trace.log"))); console.log(`trace kept in ${keep}`); }

for (const p of live) p.kill("SIGKILL");
await server.stop().catch(() => {});
rmSync(home, { recursive: true, force: true });
rmSync(cliHome, { recursive: true, force: true });
rmSync(noOpen, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
