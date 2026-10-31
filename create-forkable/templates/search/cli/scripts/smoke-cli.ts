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
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "@search/server/node";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/search.mjs");
const PORT = Number(process.env.SMOKE_PORT ?? 52381);
const home = mkdtempSync(join(tmpdir(), "search-smoke-cli-"));
const cliHome = mkdtempSync(join(tmpdir(), "search-smoke-cli-home-"));
let failures = 0, passed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail.slice(0, 600) : JSON.stringify(detail)?.slice(0, 400)})` : ""}`);
};

const server = await startServer({ env: { HOME: home, PORT, PG_PORT: Number(process.env.SMOKE_PG_PORT ?? 55455), SECRETS: "file", ENV_DIR: home, UI_URL: undefined, ONE_CLIENT_ID: undefined, PUBLIC_URL: `http://localhost:${PORT}` }, serveUi: false, startScheduler: false, log: () => {} });
const base = `http://localhost:${PORT}`;
const env = { ...process.env, SEARCH_HOME: cliHome, SEARCH_SERVER: base, NO_COLOR: "1" };

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

  r = await run(["mcp-config", "--client", "claude-code"]);
  check("mcp-config claude-code", r.code === 0 && r.out.includes(`claude mcp add --transport http search ${base}/mcp`) && r.out.includes('"type": "http"'), r.out);
  r = await run(["mcp-config", "--client", "codex"]);
  check("mcp-config codex", r.code === 0 && r.out.includes(`codex mcp add search --url ${base}/mcp`) && r.out.includes("[mcp_servers.search]"));
  r = await run(["mcp-config", "--client", "claude-desktop"]);
  check("mcp-config claude-desktop", r.code === 0 && r.out.includes("mcp-remote"));
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
}
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nall ${passed} passed`);
process.exit(failures ? 1 : 0);
