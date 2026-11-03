// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { spawnSync } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * CLI binary resolution: the one place `claude`, `codex` and `openclaw` get
 * located, so the binary Settings reports is the binary every spawn uses.
 *
 * The failure this exists for: a CLI installed through an interactive-shell
 * PATH edit (.zshrc), then the server launched from somewhere with launchd's
 * minimal PATH. `which` misses and a working CLI reads as missing. So when
 * PATH misses we probe the well-known install dirs, then ask the user's
 * interactive shell. Hits are cached for the process; misses are re-probed so
 * "install, then retry" works without a restart.
 */

/** Well-known install dirs, in probe order. */
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

/**
 * Every ~/.nvm/versions/node/<v>/bin, the default alias first (npm globals
 * live per Node version, and the user's active one is the default alias, not
 * the newest), then the rest numerically descending.
 */
export function nvmBinDirs(home: string): string[] {
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  let versions: string[];
  try {
    versions = readdirSync(nvmDir)
      .filter((v) => /^v\d+\.\d+\.\d+/.test(v))
      .sort((a, b) => compareSemverDesc(a, b));
  } catch {
    return [];
  }
  const preferred = defaultAliasVersion(home, versions);
  const ordered = preferred ? [preferred, ...versions.filter((v) => v !== preferred)] : versions;
  return ordered.map((v) => path.join(nvmDir, v, "bin"));
}

/** ~/.nvm/alias/default ("v24.14.0", "24", "24.14") against the installed dirs; lts/* and garbage give null. */
function defaultAliasVersion(home: string, versions: string[]): string | null {
  let alias: string;
  try {
    alias = readFileSync(path.join(home, ".nvm", "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }
  if (!alias) return null;
  const wanted = alias.replace(/^v/, "");
  if (!/^\d+(\.\d+)*$/.test(wanted)) return null;
  return (
    versions.find((v) => {
      const bare = v.replace(/^v/, "");
      return bare === wanted || bare.startsWith(`${wanted}.`);
    }) ?? null
  );
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

function discover(bin: string): string | null {
  // 1. The process PATH.
  try {
    const res = spawnSync("which", [bin], { encoding: "utf8", timeout: 5_000 });
    const first = res.status === 0 ? res.stdout.split(/\r?\n/)[0]?.trim() : "";
    if (first && isExecutableFile(first)) return first;
  } catch {
    // `which` missing: fall through.
  }
  // 2. Well-known install dirs.
  for (const dir of wellKnownBinDirs()) {
    const cand = path.join(dir, bin);
    if (isExecutableFile(cand)) return cand;
  }
  // 3. The user's interactive shell.
  return askInteractiveShell(bin);
}

const SHELL_PROBE_TIMEOUT_MS = 4_000;

/**
 * Last resort: `$SHELL -ilc 'command -v <bin>'`, killed after 4 s (rc files
 * can hang). Only an absolute path to an executable file is accepted.
 */
function askInteractiveShell(bin: string): string | null {
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
    // killed on timeout, shell missing
  }
  return null;
}

/** Every place resolveBinPath looks, for the "No coding agent found" Details. */
export function searchedDirs(): string[] {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const shell = (process.env.SHELL ?? "").trim() || "/bin/zsh";
  return [...new Set([...pathDirs, ...wellKnownBinDirs()]), `${shell} -ilc command -v`];
}

const cache = new Map<string, string>();

/** Absolute path of `bin`, or null. Positive results cache for the process lifetime. */
export function resolveBinPath(bin: string): string | null {
  const hit = cache.get(bin);
  if (hit && isExecutableFile(hit)) return hit;
  const found = discover(bin);
  if (found) cache.set(bin, found);
  else cache.delete(bin);
  return found;
}

/** Async form for callers on the request path. */
export async function resolveBin(bin: string): Promise<string | null> {
  return resolveBinPath(bin);
}

/** Forget cached hits (`GET /api/harnesses?force=1`). */
export function clearBinCache(): void {
  cache.clear();
}

/** The first x.y.z in a `--version` output. */
export function versionOf(text: string): string | null {
  return /\d+\.\d+\.\d+/.exec(text)?.[0] ?? null;
}
