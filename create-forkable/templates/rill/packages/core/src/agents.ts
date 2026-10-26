import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentsLayer, DetectedCli } from "./contract.js";

const execFileP = promisify(execFile);

// Finds the coding agents installed on this machine (Claude Code, Codex, the
// Gemini CLI) and checks they are signed in, so the writer can run on the
// user's own subscription. Resolution copies what works for Clockwork: PATH
// first, then the well-known install dirs a Dock-launched process cannot see,
// then the user's interactive shell as a last resort. Never a
// bypass-permissions flag anywhere; the probes are tool-less one-liners.

export const CLI_BIN: Record<DetectedCli["id"], string> = { "claude-code": "claude", codex: "codex", "gemini-cli": "gemini" };

export function wellKnownBinDirs(): string[] {
  const home = os.homedir();
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, "n", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".codex", "bin"),
    ...nvmBinDirs(home),
  ];
}

function nvmBinDirs(home: string): string[] {
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  let versions: string[];
  try {
    versions = readdirSync(nvmDir).filter((v) => /^v\d+\.\d+\.\d+/.test(v)).sort(compareSemverDesc);
  } catch {
    return [];
  }
  const preferred = defaultAliasVersion(home, versions);
  const ordered = preferred ? [preferred, ...versions.filter((v) => v !== preferred)] : versions;
  return ordered.map((v) => path.join(nvmDir, v, "bin"));
}

function defaultAliasVersion(home: string, versions: string[]): string | null {
  let alias: string;
  try {
    alias = readFileSync(path.join(home, ".nvm", "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }
  const wanted = alias.replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(wanted)) return null;
  return versions.find((v) => v.slice(1) === wanted || v.slice(1).startsWith(`${wanted}.`)) ?? null;
}

function compareSemverDesc(a: string, b: string): number {
  const parse = (v: string) => v.slice(1).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a1 = 0, a2 = 0, a3 = 0] = parse(a);
  const [b1 = 0, b2 = 0, b3 = 0] = parse(b);
  return b1 - a1 || b2 - a2 || b3 - a3;
}

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const SHELL_PROBE_TIMEOUT_MS = 4_000;

function askInteractiveShell(bin: string): string | null {
  if (process.platform === "win32") return null;
  if (!/^[A-Za-z0-9._-]+$/.test(bin)) return null;
  const shell = (process.env.SHELL ?? "").trim() || "/bin/zsh";
  try {
    const res = spawnSync(shell, ["-ilc", `command -v ${bin}`], {
      encoding: "utf8",
      timeout: SHELL_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out = (res.stdout ?? "").trim().split(/\r?\n/).pop()?.trim() ?? "";
    if (res.status === 0 && path.isAbsolute(out) && isExecutableFile(out)) return out;
  } catch {
    // killed on timeout or shell missing: the arm misses
  }
  return null;
}

function discover(bin: string): string | null {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const res = spawnSync(whichCmd, [bin], { encoding: "utf8", timeout: 5_000 });
    const first = res.status === 0 ? res.stdout.split(/\r?\n/)[0]?.trim() : "";
    if (first) return first;
  } catch {
    // which missing: probe directly
  }
  if (process.platform === "win32") return null;
  for (const dir of wellKnownBinDirs()) {
    const cand = path.join(dir, bin);
    if (isExecutableFile(cand)) return cand;
  }
  return askInteractiveShell(bin);
}

const binCache = new Map<string, string>();

export function resolveBin(name: string): string | null {
  const hit = binCache.get(name);
  if (hit) return hit;
  const found = discover(name);
  if (found) binCache.set(name, found);
  return found;
}

/** `~/.local/bin/claude` style path for display. */
export function prettyPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

async function versionOf(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP(bin, ["--version"], { timeout: 10_000, maxBuffer: 1e6, cwd: os.tmpdir(), env: cleanEnv() });
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    const m = line.match(/\d+\.\d+(?:\.\d+)?/);
    return m ? m[0] : line.slice(0, 40) || null;
  } catch {
    return null;
  }
}

/** The CLIs never see our One secrets. */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^ONE_|^DATABASE_URL$|^PG/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

export async function probeSignIn(id: DetectedCli["id"], bin: string): Promise<boolean | null> {
  try {
    if (id === "claude-code") {
      await execFileP(bin, ["-p", "--model", "haiku", "--tools", "", "--output-format", "json", "Reply with the word ready"], {
        timeout: 30_000,
        maxBuffer: 4e6,
        cwd: os.tmpdir(),
        env: cleanEnv(),
      });
      return true;
    }
    if (id === "codex") {
      await execFileP(bin, ["login", "status"], { timeout: 15_000, maxBuffer: 1e6, cwd: os.tmpdir(), env: cleanEnv() });
      return true;
    }
    return null;
  } catch {
    return false;
  }
}

let detected: Promise<DetectedCli[]> | undefined;

async function detectOnce(): Promise<DetectedCli[]> {
  const ids = Object.keys(CLI_BIN) as DetectedCli["id"][];
  return Promise.all(
    ids.map(async (id) => {
      const bin = resolveBin(CLI_BIN[id]);
      if (!bin) return { id, bin: null, version: null, signedIn: null };
      const [version, signedIn] = await Promise.all([versionOf(bin), probeSignIn(id, bin)]);
      return { id, bin, version, signedIn };
    }),
  );
}

export const agents: AgentsLayer & { redetect(): Promise<DetectedCli[]> } = {
  detect() {
    detected ??= detectOnce();
    return detected;
  },
  resolveBin,
  redetect() {
    binCache.clear();
    detected = detectOnce();
    return detected;
  },
};
