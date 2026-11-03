// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.
//
// Commit and restore go through
// plumbing (commit-tree + update-ref) so a commit names exactly the tree a
// snapshot saw, and restore never uses reset --hard.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type GitResult = { ok: boolean; code: number | null; stdout: string; stderr: string; truncated?: boolean };

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** The tree id of an empty tree. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function runGit(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string>; input?: string; maxBytes?: number } = {},
): Promise<GitResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C", ...opts.env },
        stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ ok: false, code: null, stdout: "", stderr: String(err) });
      return;
    }
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 15_000);
    child.stdout?.on("data", (d: Buffer) => {
      if (truncated) return;
      const chunk = d.toString();
      if (stdout.length + chunk.length > maxBytes) {
        stdout += chunk.slice(0, Math.max(0, maxBytes - stdout.length));
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    child.stdin?.on("error", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: stderr || String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: truncated || code === 0, code, stdout, stderr, truncated });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

async function must(cwd: string, args: string[], opts?: Parameters<typeof runGit>[2]): Promise<string> {
  const r = await runGit(cwd, args, opts);
  if (!r.ok) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return r.stdout.trim();
}

export async function headCommit(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "--verify", "-q", "HEAD"], { timeoutMs: 5_000 });
  return r.ok ? r.stdout.trim() || null : null;
}

export async function treeOf(cwd: string, rev: string): Promise<string> {
  return must(cwd, ["rev-parse", `${rev}^{tree}`]);
}

/**
 * The whole working tree (tracked edits and untracked files, minus ignored
 * ones) as a tree id, without touching the real index, HEAD or any file.
 */
export async function snapshotTree(cwd: string): Promise<string | null> {
  const indexPath = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"], { timeoutMs: 5_000 });
  if (!indexPath.ok) return null;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "bld-git-"));
  const tmpIndex = path.join(tmpDir, "index");
  try {
    const real = indexPath.stdout.trim();
    if (real && existsSync(real)) copyFileSync(real, tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex };
    const add = await runGit(cwd, ["add", "-A", "--", "."], { env, timeoutMs: 30_000 });
    if (!add.ok) return null;
    const tree = await runGit(cwd, ["write-tree"], { env, timeoutMs: 10_000 });
    return tree.ok ? tree.stdout.trim() || null : null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export type GitFileChange = { path: string; status: "A" | "M" | "D"; additions: number; deletions: number; binary: boolean };

/** Per-file line counts between two trees (or commits). */
export async function diffFiles(cwd: string, from: string, to: string): Promise<GitFileChange[]> {
  const [num, names] = await Promise.all([
    runGit(cwd, ["diff", "--numstat", "--no-renames", "-z", from, to], { timeoutMs: 20_000 }),
    runGit(cwd, ["diff", "--name-status", "--no-renames", "-z", from, to], { timeoutMs: 20_000 }),
  ]);
  if (!num.ok) return [];
  const status = new Map<string, GitFileChange["status"]>();
  const parts = names.stdout.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const letter = parts[i];
    status.set(parts[i + 1]!, letter === "A" ? "A" : letter === "D" ? "D" : "M");
  }
  const out: GitFileChange[] = [];
  for (const rec of num.stdout.split("\0")) {
    const m = rec.match(/^(-|\d+)\t(-|\d+)\t([\s\S]+)$/);
    if (!m) continue;
    const binary = m[1] === "-";
    out.push({
      path: m[3]!,
      status: status.get(m[3]!) ?? "M",
      additions: binary ? 0 : Number(m[1]),
      deletions: binary ? 0 : Number(m[2]),
      binary,
    });
  }
  return out;
}

/** Unified diff text between two trees, capped. */
export async function diffPatch(cwd: string, from: string, to: string, file?: string, maxBytes = 600_000): Promise<string> {
  const args = ["diff", "--no-renames", "--no-color", "-U3", from, to];
  if (file) args.push("--", file);
  const r = await runGit(cwd, args, { timeoutMs: 30_000, maxBytes });
  return r.ok ? r.stdout : "";
}

export interface Identity {
  name: string;
  email: string;
}

/** The builder's own git identity when set, else the product's local one. */
export async function identity(cwd: string, fallback: Identity): Promise<Identity> {
  const [n, e] = await Promise.all([
    runGit(cwd, ["config", "user.name"], { timeoutMs: 3_000 }),
    runGit(cwd, ["config", "user.email"], { timeoutMs: 3_000 }),
  ]);
  return { name: n.stdout.trim() || fallback.name, email: e.stdout.trim() || fallback.email };
}

function identityEnv(id: Identity): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: id.name,
    GIT_AUTHOR_EMAIL: id.email,
    GIT_COMMITTER_NAME: id.name,
    GIT_COMMITTER_EMAIL: id.email,
  };
}

export async function initRepo(cwd: string): Promise<void> {
  await must(cwd, ["init", "-q", "-b", "main"]);
}

/**
 * Commit `tree` on top of HEAD (or as the root commit), move main with a
 * compare-and-swap, and resync the real index to the new HEAD. The working
 * tree is not touched.
 */
export async function commitTree(cwd: string, tree: string, message: string, who: Identity): Promise<string> {
  const parent = await headCommit(cwd);
  const args = ["commit-tree", tree];
  if (parent) args.push("-p", parent);
  const sha = await must(cwd, args, { input: message, env: identityEnv(who) });
  const ref = ["update-ref", "-m", `commit: ${message.split("\n")[0]}`, "refs/heads/main", sha];
  if (parent) ref.push(parent);
  await must(cwd, ref);
  const head = await runGit(cwd, ["symbolic-ref", "-q", "HEAD"]);
  if (head.stdout.trim() !== "refs/heads/main") await must(cwd, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await must(cwd, ["read-tree", sha]);
  return sha;
}

/** Commit whatever the working tree holds now. Null when it equals HEAD. */
export async function commitWorkingTree(cwd: string, message: string, who: Identity): Promise<{ sha: string; tree: string } | null> {
  const tree = await snapshotTree(cwd);
  if (!tree) throw new Error("Could not read the project's files for a checkpoint");
  const head = await headCommit(cwd);
  if (head && (await treeOf(cwd, head)) === tree) return null;
  const sha = await commitTree(cwd, tree, message, who);
  return { sha, tree };
}

/**
 * Restore `target` as a NEW commit: its tree goes on top of HEAD, the files
 * on disk follow (tracked files absent in `target` are removed, untracked
 * and ignored files stay). Never reset --hard, so the reflog of main only
 * ever moves forward.
 */
export async function restoreAsNewCommit(cwd: string, target: string, message: string, who: Identity): Promise<string> {
  const targetTree = await treeOf(cwd, target);
  const head = await headCommit(cwd);
  if (!head) throw new Error("Nothing to restore onto");
  const gone = await must(cwd, ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=D", head, target]);
  const sha = await commitTree(cwd, targetTree, message, who);
  for (const rel of gone.split("\0").filter(Boolean)) {
    try {
      unlinkSync(path.join(cwd, rel));
    } catch {
      /* already gone */
    }
  }
  await must(cwd, ["checkout-index", "-a", "-f"]);
  return sha;
}

export interface LogEntry {
  sha: string;
  subject: string;
  body: string;
  at: string;
  trailers: Record<string, string>;
}

/** Commits on main, newest first. */
export async function log(cwd: string, limit = 200): Promise<LogEntry[]> {
  const r = await runGit(cwd, ["log", `-${limit}`, "--format=%H%x1f%s%x1f%aI%x1f%B%x1e", "main"], { timeoutMs: 15_000 });
  if (!r.ok) return [];
  const out: LogEntry[] = [];
  for (const rec of r.stdout.split("\x1e")) {
    const [sha, subject, at, body] = rec.replace(/^\n/, "").split("\x1f");
    if (!sha || !subject) continue;
    const trailers: Record<string, string> = {};
    for (const line of (body ?? "").split("\n")) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
      if (m) trailers[m[1]!] = m[2]!.trim();
    }
    out.push({ sha: sha.trim(), subject, at, body: body ?? "", trailers });
  }
  return out;
}

/** The commit message with trailers, subject capped at 72 chars. */
export function message(subject: string, trailers: Record<string, string | null | undefined>, body?: string): string {
  const first = subject.split("\n")[0]!.trim() || "Update";
  const s = first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first;
  const t = Object.entries(trailers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `${s}\n\n${body ? `${body.trim()}\n\n` : ""}${t}\n`;
}

export async function reflog(cwd: string): Promise<string[]> {
  const r = await runGit(cwd, ["reflog", "show", "--format=%H %gs", "main"]);
  return r.ok ? r.stdout.trim().split("\n").filter(Boolean) : [];
}

export async function showFile(cwd: string, rev: string, file: string): Promise<string | null> {
  const r = await runGit(cwd, ["show", `${rev}:${file}`]);
  return r.ok ? r.stdout : null;
}
