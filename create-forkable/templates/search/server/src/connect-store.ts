import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Where the Connect app's values live in local mode. Write-only from the
// outside: `values()` is for the server's own Connect client, never a route.
//
// macOS: the login Keychain, through /usr/bin/security. The value goes in on
// stdin (`security -i`), never on a command line another process could read,
// base64 encoded so no quoting can break it. Elsewhere, or when the Keychain
// refuses: SEARCH_HOME/connect.env, mode 0600. An index (SEARCH_HOME/connect.json,
// also 0600) keeps names, where each is stored, when it changed and its last
// four characters. Never the value.

export const CONNECT_NAMES = ["ONE_CLIENT_ID", "ONE_CLIENT_SECRET", "ONE_CONNECT_KEY", "ONE_PERMISSION_SET", "ONE_REDIRECT_URI"] as const;
export type ConnectName = (typeof CONNECT_NAMES)[number];
export type StoredWhere = "keychain" | "file";

export interface StoredEntry {
  where: StoredWhere;
  updatedAt: string;
  /** Last four characters. */
  hint: string;
}

interface IndexFile {
  version: 1;
  values: Partial<Record<ConnectName, StoredEntry>>;
}

/** Runs /usr/bin/security; tests inject a fake. */
export type SecurityRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve({ code: 127, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: out }));
    child.stdin.end(stdin ?? "");
  });

export const isConnectName = (n: string): n is ConnectName => (CONNECT_NAMES as readonly string[]).includes(n);

/** Write a file only this user can read, atomically. */
function writePrivate(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m?.[2]) out[m[1]!] = Buffer.from(m[2], "base64").toString("utf8");
  }
  return out;
}

export class ConnectStore {
  readonly preferred: StoredWhere;
  private readonly service = "search.connect";
  private readonly account: (name: ConnectName) => string;
  private readonly indexPath: string;
  private readonly filePath: string;

  constructor(home: string, forced?: "keychain" | "file", private readonly security: SecurityRunner = runSecurity) {
    this.preferred = forced === "file" ? "file" : forced === "keychain" ? "keychain" : process.platform === "darwin" && existsSync("/usr/bin/security") ? "keychain" : "file";
    // Two SEARCH_HOMEs on one machine keep two Connect apps apart.
    const homeId = createHash("sha1").update(home).digest("hex").slice(0, 10);
    this.account = (name) => `${homeId}/${name}`;
    this.indexPath = join(home, "connect.json");
    this.filePath = join(home, "connect.env");
  }

  private readIndex(): IndexFile {
    try {
      const j = JSON.parse(readFileSync(this.indexPath, "utf8")) as IndexFile;
      if (j?.version === 1 && j.values) return j;
    } catch {
      /* none yet */
    }
    return { version: 1, values: {} };
  }

  /** What is stored, where and when. Sync and cheap: the index only. */
  status(): Partial<Record<ConnectName, StoredEntry>> {
    return this.readIndex().values;
  }

  /** Every stored value. For the server's own Connect client only. */
  async values(): Promise<Partial<Record<ConnectName, string>>> {
    const out: Partial<Record<ConnectName, string>> = {};
    const file = readEnvFile(this.filePath);
    for (const [name, e] of Object.entries(this.readIndex().values) as [ConnectName, StoredEntry][]) {
      const v = e.where === "keychain" ? await this.keychainGet(name) : file[name];
      if (v) out[name] = v;
    }
    return out;
  }

  /** Store values, each in the Keychain when it takes it (read back to be sure), else the 0600 file. */
  async set(values: Partial<Record<ConnectName, string>>): Promise<void> {
    const idx = this.readIndex();
    const file = readEnvFile(this.filePath);
    const now = new Date().toISOString();
    for (const [name, value] of Object.entries(values) as [ConnectName, string][]) {
      let where: StoredWhere = "file";
      if (this.preferred === "keychain" && (await this.keychainSet(name, value))) where = "keychain";
      if (where === "file") file[name] = value;
      else delete file[name];
      if (where === "file" && idx.values[name]?.where === "keychain") await this.keychainRemove(name);
      idx.values[name] = { where, updatedAt: now, hint: value.slice(-4) };
    }
    this.writeFile(file);
    writePrivate(this.indexPath, `${JSON.stringify(idx, null, 2)}\n`);
  }

  async remove(names: ConnectName[]): Promise<void> {
    const idx = this.readIndex();
    const file = readEnvFile(this.filePath);
    for (const name of names) {
      if (idx.values[name]?.where === "keychain") await this.keychainRemove(name);
      delete file[name];
      delete idx.values[name];
    }
    this.writeFile(file);
    writePrivate(this.indexPath, `${JSON.stringify(idx, null, 2)}\n`);
  }

  private writeFile(file: Record<string, string>): void {
    const lines = Object.entries(file).map(([n, v]) => `${n}=${Buffer.from(v, "utf8").toString("base64")}`);
    if (lines.length) writePrivate(this.filePath, `${lines.join("\n")}\n`);
    else rmSync(this.filePath, { force: true });
  }

  // ---- Keychain ------------------------------------------------------------

  private async keychainSet(name: ConnectName, value: string): Promise<boolean> {
    const b64 = Buffer.from(value, "utf8").toString("base64");
    const cmd = `add-generic-password -U -s "${this.service}" -a "${this.account(name)}" -l "Search: ${name}" -j "Set in Search's Connect setup." -w "b64:${b64}"\n`;
    try {
      const r = await this.security(["-i"], cmd);
      if (r.code !== 0) return false;
      return (await this.keychainGet(name)) === value;
    } catch {
      return false;
    }
  }

  private async keychainGet(name: ConnectName): Promise<string | null> {
    try {
      const r = await this.security(["find-generic-password", "-s", this.service, "-a", this.account(name), "-w"]);
      if (r.code !== 0) return null;
      const raw = r.stdout.replace(/\n$/, "");
      return raw.startsWith("b64:") ? Buffer.from(raw.slice(4), "base64").toString("utf8") : raw;
    } catch {
      return null;
    }
  }

  private async keychainRemove(name: ConnectName): Promise<void> {
    try {
      await this.security(["delete-generic-password", "-s", this.service, "-a", this.account(name)]);
    } catch {
      /* not there */
    }
  }
}
