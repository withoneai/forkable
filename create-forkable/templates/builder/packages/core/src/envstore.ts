// Where environment values live (Node only). Write-only from the outside:
// `values()` is for the three readers inside the platform (the Connect
// client, a project's dev server, publish), never for a route.
//
// macOS: the login Keychain, through /usr/bin/security. The value goes in
// on stdin (`security -i`), never on a command line another process could
// read, base64 encoded so no quoting can break it. Elsewhere, or when the
// Keychain refuses: a file only the user can read (mode 0600):
// BUILDER_HOME/state/connect/<setupId>.env for a Connect app (per-project
// Connect, a project's own or a saved template), BUILDER_HOME/state/<projectId>/app.env
// for a project's app values, and BUILDER_HOME/.env for the retired
// builder-level Connect app (read once, to move it into a template). All are
// on the agents' deny list. An index (BUILDER_HOME/env-index.json, also 0600)
// keeps names, where each is stored and when it changed. No value, and no
// fragment of a secret one.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BRAND, env } from "./brand.js";
import type { EnvWhere } from "./envvars.js";
import type { Home } from "./home.js";

/** "builder" is the retired builder-level Connect app (read only to migrate it). */
export type EnvScope = "builder" | `project:${string}` | `connect:${string}`;

export interface IndexEntry {
  where: EnvWhere;
  updatedAt: string;
  /** Last four characters, for non-secret ids only. */
  hint?: string | null;
}

interface IndexFile {
  version: 1;
  scopes: Record<string, Record<string, IndexEntry>>;
}

export interface StoredStatus extends IndexEntry {
  name: string;
  /** Found in BUILDER_HOME/.env without an index entry: the builder put it there by hand. */
  manual?: boolean;
}

/** Runs /usr/bin/security; tests inject a fake. */
export type SecurityRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

export const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve({ code: 127, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: out }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Parse a .env file: NAME=value per line, quotes stripped. */
export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (v) out[m[1]!] = v;
  }
  return out;
}

function quote(v: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  return `"${v.replace(/"/g, '\\"')}"`;
}

/** Write a file only this user can read, atomically. */
function writePrivate(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/** Set or drop names in a .env file, keeping every other line as it was. */
function editEnvFile(path: string, set: Record<string, string>, drop: string[] = []): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const done = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    const n = m?.[1];
    if (n && drop.includes(n)) continue;
    if (n && n in set) {
      if (done.has(n)) continue;
      out.push(`${n}=${quote(set[n]!)}`);
      done.add(n);
      continue;
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [n, v] of Object.entries(set)) if (!done.has(n)) out.push(`${n}=${quote(v)}`);
  if (!out.length && !existsSync(path)) return;
  writePrivate(path, out.length ? `${out.join("\n")}\n` : "");
}

export interface EnvStoreOptions {
  /** "auto" (default): the Keychain on macOS, else the file. BUILDER_SECRETS=file|keychain overrides (tools only). */
  backend?: "auto" | "keychain" | "file";
  security?: SecurityRunner;
}

export class EnvStore {
  readonly preferred: EnvWhere;
  private security: SecurityRunner;
  private readonly service = `${BRAND.slug}.env`;
  private readonly homeId: string;
  private readonly indexPath: string;

  constructor(
    private home: Home,
    o: EnvStoreOptions = {},
  ) {
    const forced = process.env[env("SECRETS")];
    const backend = forced === "file" || forced === "keychain" ? forced : (o.backend ?? "auto");
    this.preferred = backend === "file" ? "file" : backend === "keychain" ? "keychain" : process.platform === "darwin" && existsSync("/usr/bin/security") ? "keychain" : "file";
    this.security = o.security ?? runSecurity;
    this.homeId = createHash("sha1").update(home.root).digest("hex").slice(0, 10);
    this.indexPath = join(home.root, "env-index.json");
  }

  /** The file a scope falls back to. */
  fileFor(scope: EnvScope): string {
    if (scope === "builder") return this.home.envFile;
    if (scope.startsWith("connect:")) return join(this.home.state, "connect", `${scope.slice("connect:".length)}.env`);
    return join(this.home.stateFor(scope.slice("project:".length)), "app.env");
  }

  /** The file path as the builder would type it (~ for the home dir). */
  displayFile(scope: EnvScope): string {
    const p = this.fileFor(scope);
    const h = process.env.HOME;
    return h && p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
  }

  private account(scope: EnvScope, name: string): string {
    return `${this.homeId}/${scope}/${name}`;
  }

  private readIndex(): IndexFile {
    try {
      const j = JSON.parse(readFileSync(this.indexPath, "utf8")) as IndexFile;
      if (j && j.version === 1 && j.scopes && typeof j.scopes === "object") return j;
    } catch {
      /* none yet */
    }
    return { version: 1, scopes: {} };
  }

  private writeIndex(i: IndexFile): void {
    writePrivate(this.indexPath, `${JSON.stringify(i, null, 2)}\n`);
  }

  /** Names stored in a scope, where, and when. Sync and cheap: the index plus the fallback file's names. */
  status(scope: EnvScope): StoredStatus[] {
    const idx = this.readIndex().scopes[scope] ?? {};
    const out: StoredStatus[] = Object.entries(idx).map(([name, e]) => ({ name, ...e }));
    const file = readEnvFile(this.fileFor(scope));
    for (const name of Object.keys(file)) {
      if (idx[name]) continue;
      out.push({ name, where: "file", updatedAt: "", hint: null, manual: true });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  has(scope: EnvScope, name: string): boolean {
    return this.status(scope).some((s) => s.name === name);
  }

  /** Every value in a scope. For the platform's own readers only. */
  async values(scope: EnvScope): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const file = readEnvFile(this.fileFor(scope));
    const idx = this.readIndex().scopes[scope] ?? {};
    for (const [name, v] of Object.entries(file)) if (!idx[name] || idx[name]!.where === "file") out[name] = v;
    for (const [name, e] of Object.entries(idx)) {
      if (e.where !== "keychain") continue;
      const v = await this.keychainGet(scope, name);
      if (v !== null) out[name] = v;
    }
    return out;
  }

  /**
   * Store values. Each goes to the Keychain when it can (and is read back to
   * be sure), else to the scope's file. A name stored before is replaced
   * wherever it was, so one place holds it.
   */
  async set(scope: EnvScope, values: Record<string, string>, hints: Record<string, string | null> = {}): Promise<Record<string, EnvWhere>> {
    const where: Record<string, EnvWhere> = {};
    const toFile: Record<string, string> = {};
    const dropFromFile: string[] = [];
    for (const [name, value] of Object.entries(values)) {
      if (!NAME.test(name)) throw new Error("Bad variable name.");
      let w: EnvWhere = "file";
      if (this.preferred === "keychain" && (await this.keychainSet(scope, name, value))) w = "keychain";
      where[name] = w;
      if (w === "file") toFile[name] = value;
      else dropFromFile.push(name);
    }
    editEnvFile(this.fileFor(scope), toFile, dropFromFile);
    const idx = this.readIndex();
    const s = (idx.scopes[scope] ??= {});
    const now = new Date().toISOString();
    for (const [name, w] of Object.entries(where)) {
      if (w === "file" && s[name]?.where === "keychain") await this.keychainRemove(scope, name);
      s[name] = { where: w, updatedAt: now, hint: hints[name] ?? null };
    }
    this.writeIndex(idx);
    return where;
  }

  /** Remove names from every place they could be. */
  async remove(scope: EnvScope, names: string[]): Promise<void> {
    const idx = this.readIndex();
    const s = idx.scopes[scope];
    for (const n of names) if (this.preferred === "keychain" || s?.[n]?.where === "keychain") await this.keychainRemove(scope, n);
    editEnvFile(this.fileFor(scope), {}, names);
    if (s) for (const n of names) delete s[n];
    if (s && !Object.keys(s).length) delete idx.scopes[scope];
    this.writeIndex(idx);
  }

  /** A project went away: its values go too. */
  async removeScope(scope: EnvScope): Promise<void> {
    const names = this.status(scope).map((s) => s.name);
    if (names.length) await this.remove(scope, names);
    if (scope !== "builder") rmSync(this.fileFor(scope), { force: true });
  }

  // ---- Keychain ------------------------------------------------------------

  private async keychainSet(scope: EnvScope, name: string, value: string): Promise<boolean> {
    const b64 = Buffer.from(value, "utf8").toString("base64");
    const label = `${BRAND.name}: ${name}`;
    const cmd = `add-generic-password -U -s "${this.service}" -a "${this.account(scope, name)}" -l "${label}" -j "Set in ${BRAND.name}. ${scope.startsWith("connect:") || scope === "builder" ? "A Connect app." : "An app's environment."}" -w "b64:${b64}"\n`;
    try {
      const r = await this.security(["-i"], cmd);
      if (r.code !== 0) return false;
      return (await this.keychainGet(scope, name)) === value;
    } catch {
      return false;
    }
  }

  private async keychainGet(scope: EnvScope, name: string): Promise<string | null> {
    try {
      const r = await this.security(["find-generic-password", "-s", this.service, "-a", this.account(scope, name), "-w"]);
      if (r.code !== 0) return null;
      const raw = r.stdout.replace(/\n$/, "");
      return raw.startsWith("b64:") ? Buffer.from(raw.slice(4), "base64").toString("utf8") : raw;
    } catch {
      return null;
    }
  }

  private async keychainRemove(scope: EnvScope, name: string): Promise<void> {
    try {
      await this.security(["delete-generic-password", "-s", this.service, "-a", this.account(scope, name)]);
    } catch {
      /* not there */
    }
  }
}
