// Where each coding agent keeps its MCP config, and safe edits to those files.
//
// Every path here comes from one place, agentPaths(), so a test points all of them
// at a temp folder with SEARCH_AGENT_HOME. Under it, CLAUDE_CONFIG_DIR and
// CODEX_HOME are honored only when they sit inside that folder (a shell that sets
// them to the real ones cannot leak through), and binaries are looked up on PATH
// only. Under SEARCH_SMOKE=1 every read and write must sit inside
// SEARCH_AGENT_HOME, or it throws.
//
// JSON edits keep everything else in the file, write to a temp file and rename it
// (atomic), copy the old file to SEARCH_HOME/backups/agents first, and do nothing
// when the file already says what we want (idempotent).

import { accessSync, chmodSync, closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentPaths {
  /** The home every agent path hangs off: SEARCH_AGENT_HOME, else the real home. */
  home: string;
  overridden: boolean;
  /** CLAUDE_CONFIG_DIR to pass to `claude`, or null to leave it unset. */
  claudeConfigDir: string | null;
  /** Claude Code's user-scope config (its mcpServers live at the top level). */
  claudeJson: string;
  claudeSkills: string;
  /** CODEX_HOME to pass to `codex`, or null to leave it unset. */
  codexHome: string | null;
  codexConfig: string;
  cursorDir: string;
  cursorConfig: string;
  desktopDir: string;
  desktopConfig: string;
  cursorApps: string[];
  desktopApps: string[];
}

/** A path with every existing part resolved (macOS: /var is /private/var), so links compare fairly. */
function realish(p: string): string {
  const abs = path.resolve(p);
  try { return realpathSync(abs); } catch { /* not there yet */ }
  const parent = path.dirname(abs);
  return parent === abs ? abs : path.join(realish(parent), path.basename(abs));
}

const inside = (p: string, dir: string) => {
  const check = (a: string, b: string) => { const rel = path.relative(b, a); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
  return check(path.resolve(p), path.resolve(dir)) || check(realish(p), realish(dir));
};

export function agentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
  const override = env.SEARCH_AGENT_HOME?.trim();
  if (env.SEARCH_SMOKE === "1" && !override) throw new Error("A test reached the agent config code without SEARCH_AGENT_HOME. Set it to a temp folder.");
  const home = path.resolve(override || os.homedir());
  const overridden = !!override;
  const keep = (v: string | undefined) => {
    const t = v?.trim();
    if (!t) return null;
    if (overridden && !inside(t, home)) return null;
    return path.resolve(t);
  };
  const claudeConfigDir = keep(env.CLAUDE_CONFIG_DIR) ?? (overridden ? path.join(home, ".claude") : null);
  const codexHome = keep(env.CODEX_HOME) ?? (overridden ? path.join(home, ".codex") : null);
  const desktopDir = process.platform === "darwin" ? path.join(home, "Library", "Application Support", "Claude")
    : process.platform === "win32" ? path.join(overridden ? path.join(home, "AppData", "Roaming") : (env.APPDATA ?? path.join(home, "AppData", "Roaming")), "Claude")
    : path.join(home, ".config", "Claude");
  // Where an app is installed is only ever READ, so a temp agent home (SEARCH_AGENT_HOME)
  // still sees the real apps; only a test run (SEARCH_SMOKE) stays inside its temp home.
  const hermetic = overridden && env.SEARCH_SMOKE === "1";
  const realHome = os.homedir();
  const apps = (name: string) => {
    if (process.platform === "win32") {
      const local = hermetic ? path.join(home, "AppData", "Local") : env.LOCALAPPDATA ?? path.join(realHome, "AppData", "Local");
      return name === "Claude" ? [path.join(local, "AnthropicClaude"), path.join(local, "Programs", "Claude")] : [path.join(local, "Programs", "cursor")];
    }
    if (process.platform !== "darwin") return [];
    const list = [path.join(home, "Applications", `${name}.app`)];
    if (!hermetic) list.push(`/Applications/${name}.app`, path.join(realHome, "Applications", `${name}.app`));
    return [...new Set(list)];
  };
  return {
    home, overridden, claudeConfigDir,
    claudeJson: claudeConfigDir ? path.join(claudeConfigDir, ".claude.json") : path.join(home, ".claude.json"),
    claudeSkills: claudeConfigDir ? path.join(claudeConfigDir, "skills") : path.join(home, ".claude", "skills"),
    codexHome,
    codexConfig: path.join(codexHome ?? path.join(home, ".codex"), "config.toml"),
    cursorDir: path.join(home, ".cursor"),
    cursorConfig: path.join(home, ".cursor", "mcp.json"),
    desktopDir,
    desktopConfig: path.join(desktopDir, "claude_desktop_config.json"),
    cursorApps: apps("Cursor"),
    desktopApps: apps("Claude"),
  };
}

/** Throws when a test is about to touch a file outside its temp agent home. */
export function assertSafe(p: AgentPaths, file: string): void {
  if (process.env.SEARCH_SMOKE !== "1") return;
  if (!p.overridden || !inside(file, p.home)) throw new Error(`A test tried to touch ${file}, outside SEARCH_AGENT_HOME.`);
}

/** The environment a spawned agent CLI gets: its config dir pinned, and HOME too under an override. */
export function childEnv(p: AgentPaths): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^ONE_|^SEARCH_|^DATABASE_URL$|^PG|^CLAUDE_CONFIG_DIR$|^CODEX_HOME$/.test(k)) continue;
    env[k] = v;
  }
  if (p.claudeConfigDir) env.CLAUDE_CONFIG_DIR = p.claudeConfigDir;
  if (p.codexHome) env.CODEX_HOME = p.codexHome;
  if (p.overridden) { env.HOME = p.home; env.USERPROFILE = p.home; }
  return env;
}

// ---------- JSON files ----------

export type ConfigErrorCode = "invalid_config" | "not_found" | "read_only" | "name_taken" | "failed";
export class ConfigError extends Error {
  constructor(message: string, public readonly code: ConfigErrorCode = "failed") { super(message); }
}

export interface JsonFile {
  exists: boolean; data: Record<string, unknown>; mode: number | null;
  /** The file started with a byte-order mark; writes keep it. */
  bom: boolean;
  /** The file was there but empty (or only whitespace). */
  empty: boolean;
}

export function readJsonFile(p: AgentPaths, file: string): JsonFile {
  assertSafe(p, file);
  if (!existsSync(file)) return { exists: false, data: {}, mode: null, bom: false, empty: false };
  let raw = readFileSync(file, "utf8");
  const bom = raw.charCodeAt(0) === 0xfeff;
  if (bom) raw = raw.slice(1);
  const mode = statSync(file).mode & 0o777;
  if (!raw.trim()) return { exists: true, data: {}, mode, bom, empty: true };
  let data: unknown;
  try { data = JSON.parse(raw); } catch {
    throw new ConfigError(`${file} is not valid JSON, so Search left it alone. Fix it or move it aside, then try again.`, "invalid_config");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ConfigError(`${file} does not hold a JSON object, so Search left it alone.`, "invalid_config");
  return { exists: true, data: data as Record<string, unknown>, mode, bom, empty: false };
}

/** Refuses a config the person made read-only: Search never forces a write. */
export function assertWritable(p: AgentPaths, file: string): void {
  assertSafe(p, file);
  if (!existsSync(file)) return;
  const target = realTarget(file);
  let ok = true;
  try { accessSync(target, constants.W_OK); } catch { ok = false; }
  if (process.platform !== "win32" && (statSync(target).mode & 0o200) === 0) ok = false;
  if (!ok) throw new ConfigError(`${file} is read-only, so Search left it alone. Make it writable, or add Search by hand.`, "read_only");
}

/** The file a path really names: a symlink's final target (written through, never replaced). */
export function realTarget(file: string): string {
  try {
    if (lstatSync(file).isSymbolicLink()) return realpathSync(file);
  } catch { /* missing: the path itself */ }
  return file;
}

/** Copies a file into SEARCH_HOME/backups/agents (newest 10 per label kept). Returns the copy's path. */
export function backupFile(p: AgentPaths, file: string, searchHome: string, label: string): string | null {
  assertSafe(p, file);
  if (!existsSync(file)) return null;
  const dir = path.join(searchHome, "backups", "agents");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(file) || ".bak";
  const to = path.join(dir, `${label}-${stamp}${ext}`);
  copyFileSync(file, to);
  chmodSync(to, 0o600);
  const mine = readdirSync(dir).filter((f) => f.startsWith(`${label}-`)).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - 10))) rmSync(path.join(dir, old), { force: true });
  return to;
}

/**
 * Writes text to a temp file beside the real file, fsyncs it, then renames it
 * over it. A symlinked config is written through to its target, so the link stays.
 */
export function writeAtomic(p: AgentPaths, file: string, text: string, mode: number): void {
  assertSafe(p, file);
  assertWritable(p, file);
  const target = realTarget(file);
  assertSafe(p, target);
  file = target;
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.search-${process.pid}-${Date.now()}.tmp`;
  const fd = openSync(tmp, "w", mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

export function removeFile(p: AgentPaths, file: string): void {
  assertSafe(p, file);
  rmSync(file, { force: true });
}

/** Removes a folder only when it is empty. */
export function removeEmptyDir(p: AgentPaths, dir: string): boolean {
  assertSafe(p, dir);
  try {
    if (readdirSync(dir).length) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

// ---------- Codex's config.toml (read only; `codex mcp` writes it) ----------

export interface McpEntry { url?: string; type?: string; command?: string; args?: string[] }

/** Every [mcp_servers.<name>] table in a Codex config.toml, with its url, command and args. */
export function codexServers(p: AgentPaths): Record<string, McpEntry> {
  assertSafe(p, p.codexConfig);
  if (!existsSync(p.codexConfig)) return {};
  const out: Record<string, McpEntry> = {};
  let cur: McpEntry | null = null;
  for (const line of readFileSync(p.codexConfig, "utf8").split(/\r?\n/)) {
    const head = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line);
    if (head) {
      const m = /^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))$/.exec(head[1]!.trim());
      cur = m ? (out[m[1] ?? m[2] ?? m[3]!] = {}) : null;
      continue;
    }
    if (!cur) continue;
    const kv = /^\s*(url|command|args)\s*=\s*(.+?)\s*(#.*)?$/.exec(line);
    if (!kv) continue;
    const val = kv[2]!;
    if (kv[1] === "args") {
      try { cur.args = JSON.parse(val.replace(/'([^']*)'/g, (_m, x: string) => JSON.stringify(x))) as string[]; } catch { cur.args = []; }
    } else {
      const sv = /^"((?:[^"\\]|\\.)*)"$/.exec(val) ?? /^'([^']*)'$/.exec(val);
      if (sv) (cur as Record<string, string>)[kv[1]!] = sv[1]!;
    }
  }
  return out;
}
