// The Agents screen's engine (SPEC 16.5, CONTRACT 18): find the coding agents on
// this computer, add Search to each one's own config, take it out again, and say
// how far each one got. The Connect button and `search install` both run this file.
//
// - Claude Code, Cursor and Claude Desktop run `search mcp`, the stdio bridge,
//   through the launcher `cli/bin/search-mcp` (it finds a Node 22+ when the agent
//   starts it, so the entry never depends on the node this server runs on). Claude
//   Code is added with its own `claude mcp add --scope user`; Cursor and Claude
//   Desktop get one entry merged into their JSON config. When Connect is clicked in
//   the person's signed-in session, Search issues that agent's own sign-in right
//   then (oauth.ts issueAgentSignIn) and keeps it in SEARCH_HOME/agents, so there is
//   nothing left to type. From `search install` the bridge signs in through the
//   browser on its first start instead.
// - Codex talks to /mcp over HTTP: `codex mcp add --url` starts Codex's own OAuth
//   sign-in at once, which opens the browser.
//
// Search only ever touches what is its own: an entry is Search's when it points at
// this server (its /mcp address, or the bridge with `--server <this server>`), a
// skill is Search's when it carries SKILL_MARKER. When the name `search` is taken by
// something else, Search uses `search-local`, and says so on the card; when both
// are taken, it stops and says why. No token is ever written into an agent config.

import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findBinary } from "@search/core/local-agent";
import type { AgentActionResult, AgentId, AgentRow, OAuthClientRow } from "@search/core";
import {
  agentPaths, assertSafe, assertWritable, backupFile, childEnv, codexServers, ConfigError, readJsonFile, removeEmptyDir, removeFile, sameJson, writeAtomic,
  type AgentPaths, type McpEntry,
} from "./agent-config.js";
import { skillMd, SKILL_MARKER } from "./agent-docs.js";

export const AGENT_IDS: AgentId[] = ["claude-code", "codex", "cursor", "claude-desktop"];
/** The names Search may use, in order: the plain one, then one specific to this app. */
export const ENTRY_NAMES = ["search", "search-local"] as const;
export const SERVER_NAME = ENTRY_NAMES[0];
const BRIDGED: AgentId[] = ["claude-code", "cursor", "claude-desktop"];

const NAMES: Record<AgentId, string> = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", "claude-desktop": "Claude Desktop" };
/** The OAuth client name of each agent's own sign-in through the bridge. */
export const bridgeClientName = (id: AgentId) => `Search for ${NAMES[id]}`;
export const DESKTOP_CLIENT_NAME = bridgeClientName("claude-desktop");

export interface IssuedSignIn { clientId: string; accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] }

export interface AgentContext {
  /** SEARCH_HOME: backups, the state file and the agents' sign-ins live here. */
  searchHome: string;
  /** The server's origin, e.g. http://localhost:52289. */
  base: string;
  /** The repo root (where cli/bin/search-mcp lives). */
  root: string;
  paths?: AgentPaths;
  /** Codex signs in during `mcp add`: wait for the browser (the CLI) or let it finish in the background (the server). */
  waitForLogin?: boolean;
  /** This person's OAuth clients (status, and whether a bridge sign-in is still live). */
  clients?: OAuthClientRow[];
  /** The Connect button: issue the agent's sign-in now (the CLI has no session, so it leaves this out). */
  issueSignIn?: (id: AgentId) => Promise<IssuedSignIn>;
  /** Reads `clients` again after a sign-in was issued. */
  loadClients?: () => Promise<OAuthClientRow[]>;
}

/**
 * Which OAuth clients belong to which agent, by client name: the bridge's own
 * ("Search for Claude Code"), Claude Code's HTTP sign-in "Claude Code (<server>)"
 * (read from its code), Codex's (seen on a real run), Cursor's (unverified).
 */
export function clientBelongsTo(id: AgentId, clientName: string): boolean {
  const n = clientName.trim();
  if (/^Search CLI\b/.test(n)) return false;
  if (/^Search for /.test(n)) return n === bridgeClientName(id);
  switch (id) {
    case "claude-code": return /^Claude Code\b/i.test(n);
    case "codex": return /\bcodex\b/i.test(n);
    case "cursor": return /\bcursor\b/i.test(n);
    case "claude-desktop": return false;
  }
}

/** `codex mcp add` signs in right away; the login keeps running here until the browser answers. */
const pendingLogins = new Map<AgentId, ChildProcess>();
const LOGIN_WAIT_MS = 5 * 60_000;

/** What the person still does when Search is in the agent's config but not signed in. */
export function nextStepFor(id: AgentId): string {
  if (pendingLogins.has(id)) return "Allow Search in the browser tab that just opened. If none opened, run: codex mcp login search.";
  switch (id) {
    case "claude-code": return "Open a new Claude Code session. The first time, your browser asks you to allow Search.";
    case "codex": return "In a terminal, run: codex mcp login search. Your browser asks you to allow it.";
    case "cursor": return "Open Cursor. The first time, your browser asks you to allow Search.";
    case "claude-desktop": return "Quit Claude and open it again. The first time, your browser asks you to allow Search.";
  }
}

/** Shown on a connected card that has not been used yet. */
export function readyHintFor(id: AgentId): string {
  switch (id) {
    case "claude-code": return "Ready. Open a new Claude Code session to use it.";
    case "codex": return "Ready. Open a new Codex session to use it.";
    case "cursor": return "Ready. Cursor picks it up on its own. To see it, in Cursor open Settings, then MCP.";
    case "claude-desktop": return "Ready. Quit Claude and open it again, then ask it about your mail, meetings or deals.";
  }
}

// ---------- state (what Search created, so Remove can put things back) ----------

interface AgentState { createdFile?: boolean; createdServers?: boolean; createdDir?: string; wasEmpty?: boolean; connectedAt?: string }
type StateFile = Partial<Record<AgentId, AgentState>>;
const statePath = (ctx: AgentContext) => path.join(ctx.searchHome, "agents.json");
function readState(ctx: AgentContext): StateFile {
  try { return JSON.parse(readFileSync(statePath(ctx), "utf8")) as StateFile; } catch { return {}; }
}
function writeState(ctx: AgentContext, s: StateFile): void {
  mkdirSync(ctx.searchHome, { recursive: true });
  writeFileSync(statePath(ctx), `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
}

export const tokenFileOf = (ctx: AgentContext, id: AgentId) => path.join(ctx.searchHome, "agents", `${id}-token.json`);

// ---------- what is Search's ----------

const pathsOf = (ctx: AgentContext) => ctx.paths ?? agentPaths();
const baseOf = (ctx: AgentContext) => ctx.base.replace(/\/+$/, "");
const mcpUrlOf = (ctx: AgentContext) => `${baseOf(ctx)}/mcp`;
const findCli = (p: AgentPaths, bin: string) => findBinary(bin, { pathOnly: p.overridden });

/** This server's origins: localhost and 127.0.0.1 on its port are the same server. */
function ourOrigins(ctx: AgentContext): string[] {
  const u = new URL(baseOf(ctx));
  return [`${u.protocol}//localhost:${u.port}`, `${u.protocol}//127.0.0.1:${u.port}`, u.origin];
}

/** An MCP entry is Search's when it points at this server, by address or by the bridge's --server. */
export function isOurs(entry: unknown, ctx: AgentContext): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as McpEntry;
  const origins = ourOrigins(ctx);
  if (typeof e.url === "string") return origins.some((o) => e.url!.replace(/\/+$/, "") === `${o}/mcp`);
  const args = Array.isArray(e.args) ? e.args.map(String) : [];
  const i = args.indexOf("--server");
  const server = i >= 0 ? args[i + 1]?.replace(/\/+$/, "") : undefined;
  const bridge = /search-mcp(\.cmd)?$/.test(String(e.command ?? "")) || (args.some((a) => /search\.mjs$/.test(a)) && args.includes("mcp"));
  return bridge && !!server && origins.includes(server);
}

export function configPathOf(id: AgentId, p: AgentPaths): string {
  return id === "claude-code" ? p.claudeJson : id === "codex" ? p.codexConfig : id === "cursor" ? p.cursorConfig : p.desktopConfig;
}

/** Every MCP entry in the agent's config (user scope for Claude Code). Never throws on a broken file. */
function entriesOf(id: AgentId, p: AgentPaths): Record<string, unknown> {
  try {
    if (id === "codex") return codexServers(p);
    const servers = readJsonFile(p, configPathOf(id, p)).data.mcpServers;
    return servers && typeof servers === "object" && !Array.isArray(servers) ? servers as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Search's own entry in this agent, if any. */
function ourEntry(id: AgentId, ctx: AgentContext, p: AgentPaths): { name: string; entry: unknown } | null {
  const all = entriesOf(id, p);
  for (const name of [...ENTRY_NAMES, ...Object.keys(all)]) if (name in all && isOurs(all[name], ctx)) return { name, entry: all[name] };
  return null;
}

/** The name to add Search under: its own existing one, else the first free one. */
function pickName(id: AgentId, ctx: AgentContext, p: AgentPaths): { name: string; note: string | null } {
  const mine = ourEntry(id, ctx, p);
  if (mine) return { name: mine.name, note: null };
  const all = entriesOf(id, p);
  const free = ENTRY_NAMES.find((n) => !(n in all));
  if (!free) throw new ConfigError(`${NAMES[id]} already has servers called ${ENTRY_NAMES.join(" and ")} that are not this Search, so Search did not change them. Rename one of them in ${NAMES[id]}'s settings, then click Connect again.`, "name_taken");
  return { name: free, note: free === SERVER_NAME ? null : nameNote(id, free) };
}

const nameNote = (id: AgentId, name: string) => `${NAMES[id]} already has a different server called search, so Search is added as ${name}. Yours is left as it was.`;

/**
 * Claude's desktop app installed somewhere other than an Applications folder: ask
 * Spotlight by its bundle id (macOS, read only, cached a minute). Never in a test.
 */
let spotlight: { at: number; hit: string | null } | null = null;
function spotlightApp(_p: AgentPaths): string | null {
  if (process.platform !== "darwin" || process.env.SEARCH_SMOKE === "1") return null;
  if (spotlight && Date.now() - spotlight.at < 60_000) return spotlight.hit;
  let hit: string | null = null;
  try {
    const out = execFileSync("/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == 'com.anthropic.claudefordesktop'"], { timeout: 1500, encoding: "utf8" });
    hit = out.split("\n").map((l) => l.trim()).find((l) => l.endsWith(".app")) ?? null;
  } catch { hit = null; }
  spotlight = { at: Date.now(), hit };
  return hit;
}

function detect(id: AgentId, p: AgentPaths): { found: boolean; where: string | null } {
  if (id === "claude-code" || id === "codex") {
    const bin = findCli(p, id === "claude-code" ? "claude" : "codex");
    return { found: !!bin, where: bin };
  }
  const apps = id === "cursor" ? p.cursorApps : p.desktopApps;
  const app = apps.find((a) => existsSync(a)) ?? (id === "claude-desktop" ? spotlightApp(p) : null);
  if (app) return { found: true, where: app };
  if (id === "cursor") {
    const bin = findCli(p, "cursor");
    if (bin) return { found: true, where: bin };
  }
  const dir = id === "cursor" ? p.cursorDir : p.desktopDir;
  return existsSync(dir) ? { found: true, where: dir } : { found: false, where: null };
}

// ---------- the skill (Claude Code) ----------

function skillFile(p: AgentPaths, name: string): string {
  return path.join(p.claudeSkills, name, "SKILL.md");
}
function skillIsOurs(p: AgentPaths, name: string): boolean {
  const f = skillFile(p, name);
  assertSafe(p, f);
  try { return readFileSync(f, "utf8").includes(SKILL_MARKER); } catch { return false; }
}
/** Where Search's skill is, or would go: never a folder holding someone else's skill. */
function skillSlot(p: AgentPaths): string | null {
  const ours = ENTRY_NAMES.find((n) => skillIsOurs(p, n));
  if (ours) return ours;
  return ENTRY_NAMES.find((n) => !existsSync(path.join(p.claudeSkills, n))) ?? null;
}

function writeSkill(ctx: AgentContext, p: AgentPaths, serverName: string): { changed: boolean; note: string | null } {
  const slot = skillSlot(p);
  if (!slot) return { changed: false, note: `Claude Code already has skills called ${ENTRY_NAMES.join(" and ")}, so Search did not add its guide. Search works without it.` };
  const file = skillFile(p, slot);
  const text = skillMd(ctx.base, { skillName: slot, serverName });
  try { if (readFileSync(file, "utf8") === text) return { changed: false, note: null }; } catch { /* not there yet */ }
  writeAtomic(p, file, text, 0o644);
  return { changed: true, note: slot === SERVER_NAME ? null : `Claude Code already has a skill called search, so Search's guide is ${slot}.` };
}

function dropSkills(p: AgentPaths): boolean {
  let changed = false;
  for (const n of ENTRY_NAMES) {
    if (!skillIsOurs(p, n)) continue; // never remove a skill someone else wrote
    removeFile(p, skillFile(p, n));
    removeEmptyDir(p, path.dirname(skillFile(p, n)));
    changed = true;
  }
  return changed;
}

// ---------- status ----------

/** Every agent's row. `clients` are this person's OAuth clients (GET /oauth-clients); none on the CLI. */
export function agentRows(ctx: AgentContext, clients: OAuthClientRow[] = ctx.clients ?? []): AgentRow[] {
  const p = pathsOf(ctx);
  return AGENT_IDS.map((id) => {
    const d = detect(id, p);
    const mine = ourEntry(id, ctx, p);
    const all = entriesOf(id, p);
    const added = !!mine;
    const owned = clients.filter((c) => clientBelongsTo(id, c.name));
    const live = owned.filter((c) => c.activeTokens > 0);
    const lastUsedAt = live.map((c) => c.lastUsedAt).filter((x): x is string => !!x).sort().pop() ?? null;
    const found = d.found || added || live.length > 0;
    const state: AgentRow["state"] = added && live.length ? "connected" : added ? "added" : found ? "not_connected" : "not_found";
    const note = mine && mine.name !== SERVER_NAME ? nameNote(id, mine.name)
      : !mine && SERVER_NAME in all ? `${NAMES[id]} has a different server called search. Connect leaves it alone and adds Search as ${ENTRY_NAMES[1]}.`
      : !added && live.length ? `Signed in earlier, but Search is not in ${NAMES[id]}'s settings now.`
      : null;
    // a bridged agent signs in only through Connect, so with no live sign-in it needs Connect again
    const needsConnect = added && !live.length && BRIDGED.includes(id);
    const row: AgentRow = {
      id, name: NAMES[id], found, foundWhere: d.where, added, state, lastUsedAt, needsConnect,
      nextStep: needsConnect ? `Press Connect to sign ${NAMES[id]} in to Search again.` : state === "added" ? nextStepFor(id) : state === "connected" && !lastUsedAt ? readyHintFor(id) : null,
      configPath: configPathOf(id, p), clientIds: owned.map((c) => c.clientId), entryName: mine?.name ?? null, note,
    };
    if (id === "claude-code") row.skillInstalled = ENTRY_NAMES.some((n) => skillIsOurs(p, n));
    return row;
  });
}

// ---------- running an agent's own CLI ----------

/** Windows (unverified): an npm .cmd shim only runs through the shell. */
const needsShell = (bin: string) => process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);

function run(bin: string, args: string[], p: AgentPaths): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 60_000, env: childEnv(p), cwd: os.tmpdir(), maxBuffer: 4e6, killSignal: "SIGKILL", shell: needsShell(bin) }, (err, stdout, stderr) => {
      const out = `${String(stdout ?? "")}\n${String(stderr ?? "")}`.trim();
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, out });
    }).stdin?.end();
  });
}

function lastLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
}

async function must(bin: string, args: string[], p: AgentPaths, what: string): Promise<void> {
  const r = await run(bin, args, p);
  if (r.code !== 0) throw new ConfigError(`${what} did not work: ${lastLine(r.out) || `exit ${r.code}`}`);
}

/**
 * `codex mcp add --url` writes the entry, then starts Codex's own OAuth sign-in
 * against Search at once (it opens the browser and waits for the answer). Return
 * as soon as the entry is in config.toml; the login finishes in the background,
 * or after `wait`, and is stopped after five minutes.
 */
function codexAdd(bin: string, name: string, url: string, p: AgentPaths, wait: boolean): Promise<void> {
  pendingLogins.get("codex")?.kill("SIGKILL");
  pendingLogins.delete("codex");
  const written = () => codexServers(p)[name]?.url === url;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["mcp", "add", name, "--url", url], { env: childEnv(p), cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"], shell: needsShell(bin) });
    let out = "";
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    let settled = false;
    const done = (e?: Error) => { if (settled) return; settled = true; clearInterval(poll); e ? reject(e) : resolve(); };
    const kill = setTimeout(() => child.kill("SIGKILL"), LOGIN_WAIT_MS);
    kill.unref();
    child.on("error", (e) => done(new ConfigError(`Codex mcp add did not start: ${e.message}`)));
    child.on("exit", (code) => {
      clearTimeout(kill);
      if (pendingLogins.get("codex") === child) pendingLogins.delete("codex");
      if (code === 0 || written()) done();
      else done(new ConfigError(`Codex mcp add did not work: ${lastLine(out) || `exit ${code}`}`));
    });
    const started = Date.now();
    const poll = setInterval(() => {
      if (wait || settled) return;
      if (written()) { pendingLogins.set("codex", child); done(); }
      else if (Date.now() - started > 30_000) { child.kill("SIGKILL"); done(new ConfigError(`Codex mcp add did not write ${p.codexConfig} in time.`)); }
    }, 150);
  });
}

/** Stops a Codex sign-in still waiting for the browser (Remove, or the server stopping). */
export function stopPendingLogins(): void {
  for (const c of pendingLogins.values()) c.kill("SIGKILL");
  pendingLogins.clear();
}

// ---------- the bridge ----------

/**
 * How an agent starts the bridge. On macOS and Linux, `cli/bin/search-mcp`, a
 * small sh launcher in this repo that looks for a Node 22+ each time it starts
 * (SEARCH_NODE, PATH, Homebrew, /usr/local, Volta, fnm, nvm), so a Node upgrade or
 * whichever node this server happens to run on never breaks the entry. On Windows
 * (unverified), `node` from PATH with the absolute script.
 */
export function bridgeEntry(id: AgentId, ctx: AgentContext): { command: string; args: string[] } {
  const args = ["--server", baseOf(ctx), "--as", id, "--home", ctx.searchHome];
  if (process.platform === "win32") return { command: "node", args: [path.join(ctx.root, "cli", "bin", "search.mjs"), "mcp", ...args] };
  return { command: path.join(ctx.root, "cli", "bin", "search-mcp"), args };
}

function wantedEntry(id: AgentId, ctx: AgentContext): Record<string, unknown> {
  if (id === "codex") return { url: mcpUrlOf(ctx) };
  const b = bridgeEntry(id, ctx);
  return id === "claude-code" ? { type: "stdio", command: b.command, args: b.args } : { command: b.command, args: b.args };
}

function sameEntry(id: AgentId, have: unknown, want: Record<string, unknown>): boolean {
  if (!have || typeof have !== "object") return false;
  const h = have as McpEntry;
  if (id === "codex") return h.url === want.url;
  return h.command === want.command && sameJson(h.args ?? [], want.args);
}

/** Writes the sign-in the bridge reads (same shape as the CLI's token file). */
function writeSignIn(ctx: AgentContext, id: AgentId, s: IssuedSignIn): void {
  const file = tokenFileOf(ctx, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ server: baseOf(ctx), ...s }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function hasLiveSignIn(ctx: AgentContext, id: AgentId): boolean {
  if (!existsSync(tokenFileOf(ctx, id))) return false;
  try {
    const t = JSON.parse(readFileSync(tokenFileOf(ctx, id), "utf8")) as { clientId?: string; server?: string };
    return t.server === baseOf(ctx) && (ctx.clients ?? []).some((c) => c.clientId === t.clientId && c.activeTokens > 0);
  } catch { return false; }
}

// ---------- JSON configs (Cursor, Claude Desktop) ----------

function mergeJson(id: AgentId, ctx: AgentContext, p: AgentPaths, name: string): { changed: boolean; backup: string | null } {
  const file = configPathOf(id, p);
  const f = readJsonFile(p, file);
  const servers = f.data.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) {
    throw new ConfigError(`mcpServers in ${file} is not an object, so Search left the file alone.`, "invalid_config");
  }
  const want = wantedEntry(id, ctx);
  const have = (servers as Record<string, unknown> | undefined)?.[name];
  if (have !== undefined && !isOurs(have, ctx)) throw new ConfigError(`${name} in ${file} is not this Search, so Search left it alone.`, "name_taken");
  if (sameEntry(id, have, want)) return { changed: false, backup: null };
  assertWritable(p, file);
  const backup = backupFile(p, file, ctx.searchHome, id);
  const state = readState(ctx);
  const prev = state[id] ?? {};
  const dir = path.dirname(file);
  const createdDir = prev.createdDir ?? (existsSync(dir) ? undefined : dir);
  state[id] = { createdFile: prev.createdFile ?? !f.exists, createdServers: prev.createdServers ?? servers === undefined, wasEmpty: prev.wasEmpty ?? f.empty, createdDir, connectedAt: new Date().toISOString() };
  const next = { ...f.data, mcpServers: { ...((servers as Record<string, unknown> | undefined) ?? {}), [name]: want } };
  writeAtomic(p, file, `${f.bom ? "﻿" : ""}${JSON.stringify(next, null, 2)}\n`, f.mode ?? 0o600);
  writeState(ctx, state);
  return { changed: true, backup };
}

function unmergeJson(id: AgentId, ctx: AgentContext, p: AgentPaths): { changed: boolean; backup: string | null } {
  const file = configPathOf(id, p);
  const f = readJsonFile(p, file);
  const servers = f.data.mcpServers as Record<string, unknown> | undefined;
  const state = readState(ctx);
  const mine = state[id] ?? {};
  const names = servers && typeof servers === "object" ? Object.keys(servers).filter((n) => isOurs(servers[n], ctx)) : [];
  if (!names.length) {
    if (state[id]) { delete state[id]; writeState(ctx, state); }
    return { changed: false, backup: null };
  }
  assertWritable(p, file);
  const backup = backupFile(p, file, ctx.searchHome, id);
  const rest = { ...servers };
  for (const n of names) delete rest[n];
  const next: Record<string, unknown> = { ...f.data, mcpServers: rest };
  if (!Object.keys(rest).length && mine.createdServers) delete next.mcpServers;
  if (!Object.keys(next).length && mine.createdFile) {
    removeFile(p, file);
    if (mine.createdDir) removeEmptyDir(p, mine.createdDir);
  } else if (!Object.keys(next).length && mine.wasEmpty) writeAtomic(p, file, f.bom ? "﻿" : "", f.mode ?? 0o600);
  else writeAtomic(p, file, `${f.bom ? "﻿" : ""}${JSON.stringify(next, null, 2)}\n`, f.mode ?? 0o600);
  delete state[id];
  writeState(ctx, state);
  return { changed: true, backup };
}

// ---------- connect and remove ----------

function agentRow(id: AgentId, ctx: AgentContext): AgentRow {
  return agentRows(ctx).find((r) => r.id === id)!;
}

/** Adds Search to one agent. Idempotent: a second run changes nothing. */
export async function connectAgent(id: AgentId, ctx: AgentContext): Promise<AgentActionResult> {
  const p = pathsOf(ctx);
  if (!AGENT_IDS.includes(id)) throw new ConfigError(`No agent called ${id}.`, "not_found");
  const want = wantedEntry(id, ctx);
  const file = configPathOf(id, p);
  let changed = false, backup: string | null = null;
  const notes: string[] = [];

  if (id === "claude-code" || id === "codex") {
    const bin = findCli(p, id === "claude-code" ? "claude" : "codex");
    if (!bin) throw new ConfigError(`${NAMES[id]} is not on this computer. Install it first, then try again.`, "not_found");
    const { name, note } = pickName(id, ctx, p);
    if (note) notes.push(note);
    const have = ourEntry(id, ctx, p);
    if (!have || !sameEntry(id, have.entry, want)) {
      assertWritable(p, file);
      backup = backupFile(p, file, ctx.searchHome, id);
      if (have) await must(bin, id === "claude-code" ? ["mcp", "remove", have.name, "--scope", "user"] : ["mcp", "remove", have.name], p, `${NAMES[id]} mcp remove`);
      if (id === "claude-code") {
        const b = bridgeEntry(id, ctx);
        await must(bin, ["mcp", "add", "--scope", "user", name, "--", b.command, ...b.args], p, "Claude Code mcp add");
      } else await codexAdd(bin, name, String(want.url), p, ctx.waitForLogin ?? false);
      if (!ourEntry(id, ctx, p)) throw new ConfigError(`${NAMES[id]} said it added ${name}, but ${file} does not list it.`);
      changed = true;
      const state = readState(ctx);
      state[id] = { connectedAt: new Date().toISOString() };
      writeState(ctx, state);
    }
    if (id === "claude-code") {
      const s = writeSkill(ctx, p, name);
      if (s.changed) changed = true;
      if (s.note) notes.push(s.note);
    }
  } else {
    if (!detect(id, p).found) throw new ConfigError(`${NAMES[id]} is not on this computer. Install it first, then try again.`, "not_found");
    const { name, note } = pickName(id, ctx, p);
    if (note) notes.push(note);
    ({ changed, backup } = mergeJson(id, ctx, p, name));
  }

  // One click: the bridge's sign-in is issued now, from the person's own session.
  if (BRIDGED.includes(id) && ctx.issueSignIn && !hasLiveSignIn(ctx, id)) {
    writeSignIn(ctx, id, await ctx.issueSignIn(id));
    if (ctx.loadClients) ctx.clients = await ctx.loadClients();
    changed = true;
  }

  const agent = agentRow(id, ctx);
  const what = agent.state === "connected" ? readyHintFor(id) : nextStepFor(id);
  const lead = changed ? `Added Search to ${NAMES[id]}.` : `${NAMES[id]} already has Search.`;
  return { agent, changed, backup, message: [lead, ...notes, what].join(" ") };
}

/** Takes Search out of one agent: only its own entries and its own skill. */
export async function disconnectAgent(id: AgentId, ctx: AgentContext): Promise<AgentActionResult> {
  const p = pathsOf(ctx);
  if (!AGENT_IDS.includes(id)) throw new ConfigError(`No agent called ${id}.`, "not_found");
  let changed = false, backup: string | null = null;
  if (id === "codex") { pendingLogins.get("codex")?.kill("SIGKILL"); pendingLogins.delete("codex"); }
  if (id === "claude-code" || id === "codex") {
    const all = entriesOf(id, p);
    const mine = Object.keys(all).filter((n) => isOurs(all[n], ctx));
    if (mine.length) {
      const bin = findCli(p, id === "claude-code" ? "claude" : "codex");
      if (!bin) throw new ConfigError(`${NAMES[id]} is not on this computer, so Search cannot run its remove command.`, "not_found");
      assertWritable(p, configPathOf(id, p));
      backup = backupFile(p, configPathOf(id, p), ctx.searchHome, id);
      for (const n of mine) await must(bin, id === "claude-code" ? ["mcp", "remove", n, "--scope", "user"] : ["mcp", "remove", n], p, `${NAMES[id]} mcp remove`);
      changed = true;
    }
    if (id === "claude-code" && dropSkills(p)) changed = true;
    const state = readState(ctx);
    if (state[id]) { delete state[id]; writeState(ctx, state); }
  } else {
    ({ changed, backup } = unmergeJson(id, ctx, p));
  }
  rmSync(tokenFileOf(ctx, id), { force: true });
  return { agent: agentRow(id, ctx), changed, backup, message: changed ? `Removed Search from ${NAMES[id]}.` : `${NAMES[id]} did not have Search.` };
}
