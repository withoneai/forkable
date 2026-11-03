// The upload set: every file git tracks at the checkpoint
// being published, read straight from the object store, so a dirty working
// tree or an ignored file never ships. Also writes that tree to a scratch
// directory for the scan's build and typecheck.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as git from "../git.js";

export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface UploadFile {
  path: string;
  /** 100644, 100755 or 120000 (a symlink's target is its content). */
  mode: string;
  /** Git's blob sha. */
  blob: string;
  size: number;
  content: Buffer;
}

export interface UploadSet {
  sha: string;
  files: UploadFile[];
  /** Over 10 MB, left out of the upload. */
  skipped: { path: string; size: number }[];
  bytes: number;
}

/** True for content that is not plain UTF-8 text (sent base64). */
export function isBinary(b: Buffer): boolean {
  if (b.includes(0)) return true;
  return b.toString("utf8").includes("�") && !b.includes(Buffer.from("�"));
}

/** `git cat-file --batch` over many blobs in one process. */
function readBlobs(cwd: string, shas: string[]): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`git cat-file failed: ${err.trim()}`));
      const all = Buffer.concat(chunks);
      const out = new Map<string, Buffer>();
      let i = 0;
      while (i < all.length) {
        const nl = all.indexOf(0x0a, i);
        if (nl < 0) break;
        const header = all.subarray(i, nl).toString();
        const [sha, type, sizeText] = header.split(" ");
        if (type === "missing" || !sizeText) {
          i = nl + 1;
          continue;
        }
        const size = Number(sizeText);
        out.set(sha!, all.subarray(nl + 1, nl + 1 + size));
        i = nl + 1 + size + 1;
      }
      resolve(out);
    });
    child.stdin.end(shas.map((s) => `${s}\n`).join(""));
  });
}

export async function uploadSet(cwd: string, sha: string): Promise<UploadSet> {
  const ls = await git.runGit(cwd, ["ls-tree", "-r", "-z", "--long", sha], { maxBytes: 64 * 1024 * 1024 });
  if (!ls.ok) throw new Error(`Could not list the files at ${sha.slice(0, 7)}: ${ls.stderr.trim()}`);
  const entries = ls.stdout
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, blob, size] = line.slice(0, tab).trim().split(/\s+/);
      return { mode: mode!, type: type!, blob: blob!, size: Number(size) || 0, path: line.slice(tab + 1) };
    })
    .filter((e) => e.type === "blob");
  const skipped = entries.filter((e) => e.size > MAX_FILE_BYTES).map((e) => ({ path: e.path, size: e.size }));
  const keep = entries.filter((e) => e.size <= MAX_FILE_BYTES);
  const blobs = await readBlobs(cwd, [...new Set(keep.map((e) => e.blob))]);
  const files = keep.map((e) => ({ path: e.path, mode: e.mode, blob: e.blob, size: e.size, content: blobs.get(e.blob) ?? Buffer.alloc(0) }));
  return { sha, files, skipped, bytes: files.reduce((n, f) => n + f.size, 0) };
}

/**
 * Write the upload set to `dir` (a clean tree of the checkpoint) with the
 * project's node_modules linked in, so build and typecheck run on exactly
 * what would ship. Returns a cleanup function.
 */
export function materialize(set: UploadSet, dir: string, projectDir: string): () => void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of set.files) {
    const abs = join(dir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    if (f.mode === "120000") continue; // symlinks are not needed to build
    writeFileSync(abs, f.content, { mode: f.mode === "100755" ? 0o755 : 0o644 });
  }
  const nm = join(projectDir, "node_modules");
  if (existsSync(nm)) symlinkSync(nm, join(dir, "node_modules"));
  return () => rmSync(dir, { recursive: true, force: true });
}
