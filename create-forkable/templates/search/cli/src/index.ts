// `search`, the CLI (SPEC 16.3). `start` and `demo` run in process; everything else
// talks to a running Search server's REST API with an OAuth token from `search login`.
//
// Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in, 4 server not running.

import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { login, logout, openBrowser } from "./login.js";
import { mcpConfig, MCP_CLIENTS, type McpClient } from "./mcp-config.js";
import { api, CliError, EXIT, fsProblem, home, readToken, serverUrl } from "./remote.js";
import { bridge } from "./bridge.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------- args ----------

interface Args { _: string[]; flags: Record<string, string | boolean> }
const VALUE_FLAGS = new Set(["limit", "source", "type", "server", "client", "sort", "query", "as", "offset", "max-chars", "home"]);
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) out.flags[k] = v;
      else if (VALUE_FLAGS.has(k)) out.flags[k] = argv[++i] ?? "";
      else out.flags[k] = true;
    } else if (a === "-h") out.flags.help = true;
    else out._.push(a);
  }
  return out;
}

// ---------- output ----------

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).padEnd(n);
const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};
const say = (s = "") => process.stdout.write(`${s}\n`);
const json = (v: unknown) => say(JSON.stringify(v, null, 2));

const HELP = `search, one search box for everything you connect

In a fork of Search, run these from its folder as: pnpm run search <command>

Usage
  search                         start the app on http://localhost:52289 and open it
  search start                   same
  search demo                    the keyless Acme demo, in process (no server)
  search login [--server URL]    sign in (OAuth in your browser, Sign in with One)
  search logout | whoami
  search "<query>" [--json] [--limit N] [--source gmail] [--type deal] [--exact]
                                 plain sentences are read as filters ("emails from priya last week");
                                 --exact searches the words as typed
  search ask "<question>" [--json] [--query "<narrow to>"]
  search open <itemId>
  search fetch <itemId> [--json] [--offset N] [--max-chars N]   the full text of one item
  search sources [list | sync <id> | pause <id> | resume <id>] [--json]
  search profiles [list | export <id> [file] | import <file|url> [--yes] | validate <file>]
  search install [claude-code|codex|cursor|claude-desktop] [--remove] [--server URL] [--json]
                                 add Search to a coding agent (no agent: list them)
  search mcp [--server URL] [--as <agent>]   stdio MCP bridge to the running Search
  search mcp-config [--client claude-code|codex|cursor|vscode|claude-desktop|json] [--server URL]

Queries take operators: source: type: from: to: with: after: before: on: is: lane: status: amount:
Exit codes: 0 ok, 1 error, 2 usage, 3 not signed in, 4 server not running.`;

// ---------- in-process commands ----------

async function demo(): Promise<number> {
  const { bootDatabase, detectCapability, dropSchema, ensureVectorSchema, maskDatabaseUrl, runDemo, runMigrations } = await import("@search/core");
  const home = process.env.SEARCH_HOME || resolve(homedir(), ".search");
  const schema = "search_demo";
  const quiet: string[] = [];
  let b;
  try {
    b = await bootDatabase({
      home, pgPort: Number(process.env.SEARCH_PG_PORT || 55441), databaseUrl: process.env.SEARCH_DATABASE_URL || null,
      forceKeyword: process.env.SEARCH_FORCE_KEYWORD === "1", schema, log: (l) => quiet.push(l),
    });
  } catch (e) {
    console.error(`Database: could not start (${(e as Error).message})`);
    for (const l of quiet) console.error(`  ${l}`);
    return 1;
  }
  let ok = false;
  try {
    // a fresh scratch schema every run (a crashed run may have left one)
    await dropSchema(b.db, schema);
    await runMigrations(b.db, { schema });
    const cap = await detectCapability(b.db, { embedded: b.kind === "embedded", extDir: b.kind === "embedded" ? b.extDir : null, force: process.env.SEARCH_FORCE_KEYWORD === "1" ? "keyword" : undefined });
    await ensureVectorSchema(b.db, cap);
    b = { ...b, capability: cap };
    const r = await runDemo({
      db: b.db, capability: b.capability, root: ROOT,
      database: { kind: b.kind, version: b.serverVersion, port: b.port },
      forkable: !!process.env.FORKABLE_CREATE, log: (l) => quiet.push(l),
    }, (line) => console.log(line));
    ok = r.ok;
  } catch (e) {
    console.error(`Demo failed: ${(e as Error).stack ?? e}`);
    if (b.kind === "external") console.error(`  database ${maskDatabaseUrl(b.url)}`);
  } finally {
    await dropSchema(b.db, schema).catch(() => {});
    await b.stop();
  }
  return ok ? 0 : 1;
}

/** `search` / `search start`: the server on 52289 (serving ui/dist when built), then the browser. */
async function start(): Promise<number> {
  const { startServer } = await import("@search/server");
  let started;
  try {
    started = await startServer();
  } catch (e) {
    console.error(`search: ${(e as Error).message}`);
    return 1;
  }
  const url = started.url;
  if (!process.env.CI && !process.env.SEARCH_NO_OPEN) openBrowser(url);
  console.log(`Open ${url}. Ctrl+C stops Search.`);
  await new Promise<void>((done) => {
    const stop = () => { void started!.stop().finally(done); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function validateFile(file: string): Promise<number> {
  const { parsePack, validateProfile, PackError } = await import("@search/core");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new CliError(`Could not read ${file}: ${(e as Error).message}`); }
  let profiles: unknown[];
  try {
    const looksLikePack = !!raw && typeof raw === "object" && "profiles" in (raw as object);
    profiles = looksLikePack ? parsePack(raw, file).profiles : [raw];
  } catch (e) {
    if (e instanceof PackError) { say(`${file}: invalid pack`); for (const i of e.issues) say(`  error  ${i}`); return EXIT.error; }
    throw e;
  }
  let bad = 0;
  for (const p of profiles) {
    const rep = validateProfile(p);
    const id = (p as { id?: string }).id ?? "(profile)";
    const errors = rep.issues.filter((i) => i.level === "error"), warns = rep.issues.filter((i) => i.level === "warn");
    say(`${rep.ok ? "ok   " : "FAIL "} ${id}${errors.length || warns.length ? `  ${errors.length} errors, ${warns.length} warnings` : ""}`);
    for (const i of [...errors, ...warns]) say(`  ${i.level.padEnd(5)}  ${i.check}: ${i.message}`);
    if (!rep.ok) bad++;
  }
  say(dim("Static checks only. Fixture runs are `pnpm --filter @search/core test:profiles` in the repo."));
  return bad ? EXIT.error : EXIT.ok;
}

// ---------- remote commands ----------

async function query(q: string, a: Args): Promise<number> {
  const parts = [q];
  if (typeof a.flags.source === "string") parts.push(`source:${a.flags.source}`);
  if (typeof a.flags.type === "string") parts.push(`type:${a.flags.type}`);
  const limit = Math.max(1, Math.min(200, Number(a.flags.limit ?? 20) || 20));
  const params = new URLSearchParams({ q: parts.join(" "), limit: String(limit) });
  if (typeof a.flags.sort === "string") params.set("sort", a.flags.sort);
  // A person typing reads naturally: plain phrases become filters, in this computer's time zone.
  // Bearer callers get understanding only when they ask; a person typing asks, unless --exact.
  const exact = !!(a.flags.exact || a.flags.literal);
  params.set("understand", exact ? "0" : "1");
  const tz = localZone();
  if (tz) params.set("tz", tz);
  const r = await api("GET", `/search?${params}`);
  if (a.flags.json) { json(r); return 0; }
  if (r.understood?.length) say(dim(`Understood: ${r.understood.map((u: any) => u.label).join(", ")}. Searched as: ${r.searchedAs}  (--exact to search the words as typed)`));
  for (const sg of r.suggestions ?? []) say(dim(`"${sg.phrase}" could mean ${sg.choices.map((c: any) => `${c.label} (${c.filter})`).join(" or ")}. Add the one you mean to the search.`));
  for (const e of r.parsed?.errors ?? []) say(dim(`note: ${e.message}`));
  if (!r.results.length) { say(`No results for ${parts.join(" ")}.`); return 0; }
  r.results.forEach((x: any, i: number) => {
    say(`${dim(String(i + 1).padStart(2))}  ${cut(x.sourceName, 16)} ${cut(x.kind, 8)} ${bold(cut(x.title, 56))} ${dim(when(x.occurredAt).padEnd(12))}${x.url ? dim(x.url) : ""}`);
  });
  say(dim(`${r.total} match${r.total === 1 ? "" : "es"}, ${r.mode}${r.mode === "keyword" ? " (no pgvector)" : ""}, ${r.ms} ms. Item ids: --json.`));
  if (r.embedder && !r.embedder.semantic && (r.embedder.reason === "not_in_grant" || r.embedder.reason === "error")) say(`Search by meaning is off: ${r.embedder.message ?? r.embedder.reason}. Results match your words.`);
  if (r.fallback === "or") say(dim("No item had every word, so these match any of them."));
  if (r.didYouMean) say(dim(`Did you mean ${r.didYouMean.name}?`));
  return 0;
}

async function ask(question: string, a: Args): Promise<number> {
  const r = await api("POST", "/answer", { q: typeof a.flags.query === "string" ? `${question} ${a.flags.query}` : question });
  if (a.flags.json) { json(r); return 0; }
  say(r.text);
  if (r.citations?.length) {
    say();
    for (const c of r.citations) say(`${dim(`[${c.n}]`)} ${c.title} ${dim(`${c.platform}, ${when(c.occurredAt)}${c.url ? `  ${c.url}` : ""}`)}`);
  }
  if (!r.grounded) say(dim("Not grounded in your items."));
  return 0;
}

async function sources(a: Args): Promise<number> {
  const [, sub = "list", id] = a._;
  if (sub === "list") {
    const r = await api("GET", "/sources");
    if (a.flags.json) { json(r); return 0; }
    if (!r.sources.length) { say("No sources yet. Open Search and connect a tool."); return 0; }
    for (const s of r.sources) {
      const h = s.health;
      say(`${cut(`${s.name} ${s.profile.title}`, 34)} ${cut(h.status, 13)} ${String(h.itemCount).padStart(6)} items  ${dim(`last sync ${when(h.lastSuccessAt) || "never"}  ${s.id}`)}`);
    }
    if (r.banner) say(`\n${r.banner.text}`);
    else if (r.semantic && !r.semantic.semantic && r.semantic.reason !== "sample" && r.semantic.message) say(`\nSearch by meaning is off: ${r.semantic.message}. Results match your words.`);
    return 0;
  }
  if (!id) throw new CliError(`Usage: search sources ${sub} <sourceId>`, EXIT.usage);
  if (sub === "sync") { const r = await api("POST", `/sources/${encodeURIComponent(id)}/sync`, { full: !!a.flags.full }); say(`Sync started (${r.runId}).`); return 0; }
  if (sub === "pause" || sub === "resume") { await api("PATCH", `/sources/${encodeURIComponent(id)}`, { paused: sub === "pause" }); say(sub === "pause" ? "Paused." : "Resumed."); return 0; }
  throw new CliError(`Unknown: search sources ${sub}`, EXIT.usage);
}

async function profiles(a: Args): Promise<number> {
  const [, sub = "list", arg, file] = a._;
  if (sub === "validate") {
    if (!arg) throw new CliError("Usage: search profiles validate <file>", EXIT.usage);
    return validateFile(arg);
  }
  if (sub === "list") {
    const r = await api("GET", "/profiles");
    if (a.flags.json) { json(r.map(({ json: _j, ...p }: any) => p)); return 0; }
    for (const p of r) say(`${cut(p.slug, 30)} ${cut(p.title, 30)} ${cut(p.origin, 8)} v${String(p.currentVersion).padEnd(3)} ${dim(`${p.verified}  ${p.id}`)}`);
    return 0;
  }
  if (sub === "export") {
    if (!arg) throw new CliError("Usage: search profiles export <profileId> [file]", EXIT.usage);
    const pack = await api("GET", `/profiles/${encodeURIComponent(arg)}/export`);
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    if (file) { writeFileSync(file, text); say(`Wrote ${file}.`); } else process.stdout.write(text);
    return 0;
  }
  if (sub === "import") {
    if (!arg) throw new CliError("Usage: search profiles import <file|url> [--yes]", EXIT.usage);
    const body = /^https:\/\//.test(arg) ? { url: arg } : existsSync(arg) ? { pack: JSON.parse(readFileSync(arg, "utf8")) } : null;
    if (!body) throw new CliError(`${arg} is not a file or an https URL.`, EXIT.usage);
    const prev = await api("POST", "/profiles/import", body);
    say(`${prev.pack.platform}: ${prev.diff.map((d: any) => `${d.profileId} ${d.status}${d.changedSections.length ? ` (${d.changedSections.join(", ")})` : ""}`).join("; ")}`);
    for (const i of prev.report.issues.filter((x: any) => x.level !== "ok")) say(`  ${i.level}  ${i.message}`);
    if (!prev.report.ok) { say("Not imported: fix the errors first."); return EXIT.error; }
    let yes = !!a.flags.yes;
    if (!yes && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      yes = /^y/i.test(await rl.question("Import? [y/N] "));
      rl.close();
    }
    if (!yes) { say("Not imported (pass --yes to accept)."); return 0; }
    const saved = await api("POST", `/profiles/import/${encodeURIComponent(prev.importId)}/accept`);
    say(`Imported ${saved.map((p: any) => p.slug).join(", ")}.`);
    return 0;
  }
  throw new CliError(`Unknown: search profiles ${sub}`, EXIT.usage);
}

async function whoami(a: Args): Promise<number> {
  const t = readToken();
  if (!t) throw new CliError("Not signed in. Run `pnpm run search login` in the Search folder.", EXIT.notSignedIn);
  const me = await api("GET", "/me");
  if (a.flags.json) { json({ server: t.server, scopes: t.scopes, user: me.user }); return 0; }
  say(`${me.user?.name ?? "Signed in"}${me.user?.email ? ` <${me.user.email}>` : ""}${me.user?.isSample ? " (Acme sample)" : ""}`);
  say(dim(`${t.server}  ${t.scopes.join(" ")}`));
  return 0;
}

function localZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

function nonNegative(v: string | boolean | undefined, name: string, d: number): number {
  if (v === undefined) return d;
  const n = Number(v);
  if (typeof v !== "string" || !Number.isInteger(n) || n < 0) throw new CliError(`--${name} takes a whole number, like 0 or 2000.`, EXIT.usage);
  return n;
}

async function fetchItem(id: string, a: Args): Promise<number> {
  const offset = nonNegative(a.flags.offset, "offset", 0);
  const maxChars = a.flags["max-chars"] === undefined ? null : nonNegative(a.flags["max-chars"], "max-chars", 0) || null;
  const d = await api("GET", `/items/${encodeURIComponent(id)}`);
  const full: string = d.body || (d.parts ?? []).map((p: any) => [p.author && `${p.author}${p.at ? `, ${String(p.at).slice(0, 10)}` : ""}:`, p.title, p.text].filter(Boolean).join("\n")).join("\n\n");
  const start = Math.min(offset, full.length);
  const text = maxChars ? full.slice(start, start + maxChars) : full.slice(start);
  const end = start + text.length;
  const truncated = end < full.length;
  if (a.flags.json) {
    json({ id: d.row.id, title: d.row.title, url: d.row.url, text, truncated, offset: start, totalChars: full.length, nextOffset: truncated ? end : null, metadata: { source: d.row.sourceName, kind: d.row.kind, date: d.row.occurredAt, people: (d.row.people ?? []).map((p: any) => p.name), facets: d.row.facets }, properties: d.properties ?? [] });
    return 0;
  }
  say(bold(d.row.title));
  say(dim(`${d.row.sourceName} ${d.row.kind}, ${when(d.row.occurredAt)}${d.row.url ? `  ${d.row.url}` : ""}`));
  for (const p of d.properties ?? []) say(dim(`${p.label}: ${p.value}`));
  say();
  say(text || dim("(no text)"));
  if (start > 0 || truncated) say(dim(`\n[Characters ${start} to ${end} of ${full.length}.${truncated ? ` More: --offset ${end}` : ""}]`));
  return 0;
}

async function install(a: Args): Promise<number> {
  const { AGENT_IDS, agentRows, connectAgent, disconnectAgent } = await import("@search/server/agents");
  const ctx = { searchHome: home(), base: serverUrl(typeof a.flags.server === "string" ? a.flags.server : undefined), root: ROOT, waitForLogin: true };
  const id = a._[1];
  if (!id) {
    const rows = agentRows(ctx);
    if (a.flags.json) { json(rows); return 0; }
    for (const r of rows) say(`${cut(r.name, 16)} ${cut(r.found ? "found" : "not found", 10)} ${cut(r.added ? "Search added" : "", 13)} ${dim(r.configPath)}`);
    say(dim("Add one: pnpm run search install <claude-code|codex|cursor|claude-desktop>"));
    return 0;
  }
  if (!(AGENT_IDS as string[]).includes(id)) throw new CliError(`Pick one of ${AGENT_IDS.join(", ")}.`, EXIT.usage);
  if (id === "codex" && !a.flags.remove) say(dim("Codex signs in as it adds Search. If your browser opens, allow Search there."));
  let r;
  try {
    r = a.flags.remove ? await disconnectAgent(id as never, ctx) : await connectAgent(id as never, ctx);
  } catch (e) {
    throw new CliError((e as Error).message, (e as { code?: string }).code === "not_found" ? EXIT.usage : EXIT.error);
  }
  if (a.flags.json) { json(r); return 0; }
  say(r.message);
  if (r.backup) say(dim(`Backup of the old file: ${r.backup}`));
  return 0;
}

// ---------- main ----------

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (a.flags.help || cmd === "help") { say(HELP); return 0; }
  // --server is checked up front for every command, so a typo never falls back to another server.
  if (a.flags.server !== undefined) serverUrl(typeof a.flags.server === "string" ? a.flags.server : "");
  if (a.flags.version) { say(JSON.parse(readFileSync(resolve(ROOT, "cli", "package.json"), "utf8")).version); return 0; }
  if (!cmd || cmd === "start") return start();
  if (cmd === "demo") return demo();
  if (cmd === "login") {
    const server = serverUrl(typeof a.flags.server === "string" ? a.flags.server : undefined);
    const t = await login({ server, open: !a.flags["no-open"], log: (l) => say(l) });
    const me = await api("GET", "/me");
    say(`Signed in as ${me.user?.name ?? me.user?.email ?? "you"}${me.user?.isSample ? " (Acme sample)" : ""} on ${t.server}.`);
    return 0;
  }
  if (cmd === "logout") { say(await logout()); return 0; }
  if (cmd === "whoami") return whoami(a);
  if (cmd === "mcp-config") {
    const client = (typeof a.flags.client === "string" ? a.flags.client : "claude-code") as McpClient;
    if (!MCP_CLIENTS.includes(client)) throw new CliError(`--client is one of ${MCP_CLIENTS.join(", ")}`, EXIT.usage);
    say(mcpConfig(client, serverUrl(typeof a.flags.server === "string" ? a.flags.server : undefined), { node: process.execPath, bin: resolve(ROOT, "cli", "bin", "search.mjs") }));
    return 0;
  }
  if (cmd === "mcp") {
    const as = typeof a.flags.as === "string" ? a.flags.as : null;
    const names: Record<string, string> = { "claude-code": "Search for Claude Code", cursor: "Search for Cursor", "claude-desktop": "Search for Claude Desktop", codex: "Search for Codex" };
    if (typeof a.flags.home === "string") process.env.SEARCH_HOME = a.flags.home;
    return bridge({ server: serverUrl(typeof a.flags.server === "string" ? a.flags.server : undefined), as, clientName: as ? names[as] ?? `Search for ${as}` : undefined, home: typeof a.flags.home === "string" ? a.flags.home : null });
  }
  if (cmd === "install") return install(a);
  if (cmd === "fetch") {
    const id = a._[1];
    if (!id) throw new CliError("Usage: search fetch <itemId> [--json]", EXIT.usage);
    return fetchItem(id, a);
  }
  if (cmd === "ask") {
    const q = a._.slice(1).join(" ").trim();
    if (!q) throw new CliError('Usage: search ask "<question>"', EXIT.usage);
    return ask(q, a);
  }
  if (cmd === "open") {
    const id = a._[1];
    if (!id) throw new CliError("Usage: search open <itemId>", EXIT.usage);
    const d = await api("GET", `/items/${encodeURIComponent(id)}`);
    if (!d.row.url) throw new CliError("That item has no link.");
    openBrowser(d.row.url);
    say(d.row.url);
    return 0;
  }
  if (cmd === "sources") return sources(a);
  if (cmd === "profiles") return profiles(a);
  const q = (cmd === "query" ? a._.slice(1) : a._).join(" ").trim();
  if (!q) throw new CliError('Usage: search "<query>"', EXIT.usage);
  return query(q, a);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof CliError) {
    console.error(`search: ${e.message}`);
    process.exitCode = e.exit;
  } else {
    // a file Search could not write (a read-only or someone else's folder): plain words, no stack
    const plain = fsProblem(e, (e as NodeJS.ErrnoException).path ?? home());
    console.error(`search: ${plain ? plain.message : (e as Error).stack ?? e}`);
    process.exitCode = EXIT.error;
  }
}
// Every command is finished here (start returns after Ctrl+C), so leftover handles never keep the process up.
process.exit(process.exitCode ?? 0);
