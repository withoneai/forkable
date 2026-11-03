// GitHub export on the builder's grant. Git's own data API
// through the catalog: a blob per file, one tree, one commit, a ref. No
// remote is ever added to the project and no git push runs.
//
// First export: create the repo (private unless the builder chose public
// on purpose, no auto-init), blobs, tree, a root commit, refs/heads/main.
// Later exports: read main; when it is still the commit this product made
// last time, commit on top and move main (never forced). When GitHub's
// main moved (someone pushed there), the new commit goes to <slug>-sync
// instead and the result says so.

import type { GitHubPublishResult } from "../api-types.js";
import { GITHUB, pathParams, type PublishAction } from "./actions.js";
import type { UploadFile } from "./files.js";

export interface RunAnswer {
  ok: boolean;
  status: number;
  data: unknown;
  blockedByGrant?: boolean;
}

/** Runs one catalog action on the builder's grant (the service records Activity). */
export type ActionRunner = (a: PublishAction, input: { pathParams?: Record<string, string>; body?: unknown; query?: Record<string, string> }) => Promise<RunAnswer>;

export type Progress = (step: string, status: "running" | "done" | "failed" | "skipped", detail?: string | null) => void;

export interface GitHubExportInput {
  run: ActionRunner;
  progress?: Progress;
  files: UploadFile[];
  skipped?: string[];
  repo: string;
  visibility: "private" | "public";
  appName: string;
  slug: string;
  sha: string;
  /** Checkpoint subjects up to this sha, newest first (the commit body). */
  subjects: string[];
  /** The last export of this project to the same repo, if any. */
  previous: { owner: string; repo: string; commitSha: string } | null;
  concurrency?: number;
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly status?: number,
    readonly blockedByGrant = false,
  ) {
    super(message);
  }
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const validRepoName = (s: string): boolean => REPO_NAME.test(s) && !/^\.+$/.test(s) && !s.endsWith(".git");

const obj = (d: unknown): Record<string, unknown> => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function messageOf(d: unknown): string | null {
  const o = obj(d);
  const m = str(o.message) ?? str(obj(o.error).message);
  const errs = Array.isArray(o.errors) ? (o.errors as unknown[]).map((e) => str(obj(e).message) ?? str(e)).filter(Boolean) : [];
  return [m, ...errs].filter(Boolean).join(": ") || null;
}

function refused(step: string, r: RunAnswer, what: string): PublishError {
  if (r.blockedByGrant) return new PublishError(`One refused ${what}: your grant does not include it. Widen GitHub's access in your One account, then try again.`, step, r.status, true);
  return new PublishError(`GitHub answered ${r.status} to ${what}${messageOf(r.data) ? `: ${messageOf(r.data)}` : ""}.`, step, r.status);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export function commitMessage(appName: string, sha: string, subjects: string[]): string {
  const body = subjects
    .slice(0, 50)
    .map((s) => `- ${s}`)
    .join("\n");
  return `Export from ${appName} at ${sha.slice(0, 7)}${body ? `\n\n${body}` : ""}`;
}

export async function exportToGitHub(i: GitHubExportInput): Promise<GitHubPublishResult> {
  const p = i.progress ?? (() => {});
  if (!validRepoName(i.repo)) throw new PublishError("Repository names use letters, numbers, dots, dashes and underscores.", "repo");
  const counts = { repo: 0, blobs: 0, trees: 0, commits: 0, refs: 0 };
  const sameRepo = i.previous && i.previous.repo.toLowerCase() === i.repo.toLowerCase() ? i.previous : null;

  // 1. The repository.
  let owner: string;
  let repo = i.repo;
  let url: string;
  let isPrivate = i.visibility !== "public";
  if (!sameRepo) {
    p("repo", "running", `${isPrivate ? "Private" : "Public"} repository ${i.repo}`);
    const r = await i.run(GITHUB.createRepo, {
      body: { name: i.repo, private: isPrivate, auto_init: false, description: `${i.appName}, exported from ${i.slug}` },
    });
    if (!r.ok) {
      if (r.status === 422) throw new PublishError(`A repository named ${i.repo} already exists on your GitHub account, or the name is not allowed. Pick another name.`, "repo", 422);
      throw refused("repo", r, "creating the repository");
    }
    counts.repo = 1;
    const d = obj(r.data);
    owner = str(obj(d.owner).login) ?? "";
    repo = str(d.name) ?? i.repo;
    url = str(d.html_url) ?? `https://github.com/${owner}/${repo}`;
    if (typeof d.private === "boolean") isPrivate = d.private;
    if (!owner) throw new PublishError("GitHub made the repository but did not say who owns it.", "repo");
    p("repo", "done", `${owner}/${repo}`);
  } else {
    owner = sameRepo.owner;
    repo = sameRepo.repo;
    url = `https://github.com/${owner}/${repo}`;
    p("repo", "skipped", `Updating ${owner}/${repo}`);
  }
  const where = { owner, repo };

  // 2. Where main is now (later exports).
  let parent: string | null = null;
  let conflict = false;
  if (sameRepo) {
    p("ref", "running", "Reading main");
    const r = await i.run(GITHUB.getRef, { pathParams: pathParams(GITHUB.getRef, { ...where, ref: "heads/main" }) });
    if (r.ok) {
      const remote = str(obj(obj(r.data).object).sha);
      parent = remote;
      if (remote && remote !== sameRepo.commitSha) conflict = true;
    } else if (r.status !== 404 && r.status !== 409) {
      throw refused("ref", r, "reading main");
    }
    p("ref", "done", parent ? `main at ${parent.slice(0, 7)}` : "main is empty");
  }

  // 3. Blobs, one per file.
  p("blobs", "running", `0 of ${i.files.length}`);
  let done = 0;
  const shas = await pool(i.files, i.concurrency ?? 4, async (f) => {
    const r = await i.run(GITHUB.createBlob, { pathParams: pathParams(GITHUB.createBlob, where), body: { content: f.content.toString("base64"), encoding: "base64" } });
    if (!r.ok) throw refused("blobs", r, `uploading ${f.path}`);
    const sha = str(obj(r.data).sha);
    if (!sha) throw new PublishError(`GitHub stored ${f.path} but returned no sha.`, "blobs");
    counts.blobs++;
    done++;
    if (done % 10 === 0 || done === i.files.length) p("blobs", "running", `${done} of ${i.files.length}`);
    return sha;
  });
  p("blobs", "done", `${i.files.length} file${i.files.length === 1 ? "" : "s"}${i.skipped?.length ? `, ${i.skipped.length} over 10 MB left out` : ""}`);

  // 4. One tree, the whole checkpoint (files gone from it are gone from GitHub).
  p("tree", "running");
  const tree = await i.run(GITHUB.createTree, {
    pathParams: pathParams(GITHUB.createTree, where),
    body: { tree: i.files.map((f, n) => ({ path: f.path, mode: f.mode === "100755" || f.mode === "120000" ? f.mode : "100644", type: "blob", sha: shas[n] })) },
  });
  if (!tree.ok) throw refused("tree", tree, "writing the file tree");
  counts.trees = 1;
  const treeSha = str(obj(tree.data).sha);
  if (!treeSha) throw new PublishError("GitHub wrote the tree but returned no sha.", "tree");
  p("tree", "done");

  // 5. The commit.
  p("commit", "running");
  const commit = await i.run(GITHUB.createCommit, {
    pathParams: pathParams(GITHUB.createCommit, where),
    body: { message: commitMessage(i.appName, i.sha, i.subjects), tree: treeSha, parents: parent ? [parent] : [] },
  });
  if (!commit.ok) throw refused("commit", commit, "making the commit");
  counts.commits = 1;
  const commitSha = str(obj(commit.data).sha);
  if (!commitSha) throw new PublishError("GitHub made the commit but returned no sha.", "commit");
  p("commit", "done", commitSha.slice(0, 7));

  // 6. The branch.
  p("branch", "running");
  let branch = "main";
  const createRef = async (name: string) => i.run(GITHUB.createRef, { pathParams: pathParams(GITHUB.createRef, where), body: { ref: `refs/heads/${name}`, sha: commitSha } });
  const updateRef = async (name: string, force: boolean) => i.run(GITHUB.updateRef, { pathParams: pathParams(GITHUB.updateRef, { ...where, ref: `heads/${name}` }), body: { sha: commitSha, force } });
  const toSync = async () => {
    branch = `${i.slug}-sync`;
    conflict = true;
    const c = await createRef(branch);
    if (c.ok) return;
    // Our own branch from an earlier sync: move it (it is ours, so a force is fine there).
    const u = await updateRef(branch, true);
    if (!u.ok) throw refused("branch", u, `updating ${branch}`);
  };
  if (!sameRepo || !parent) {
    const r = await createRef("main");
    if (!r.ok) throw refused("branch", r, "creating main");
  } else if (conflict) {
    await toSync();
  } else {
    const r = await updateRef("main", false);
    if (!r.ok) {
      if (r.status === 422 || r.status === 409) await toSync();
      else throw refused("branch", r, "moving main");
    }
  }
  counts.refs = 1;
  p("branch", "done", conflict ? `GitHub's main changed since the last export, so this went to ${branch}` : branch);

  return { kind: "github", owner, repo, url, private: isPrivate, branch, commitSha, conflict, firstExport: !sameRepo, counts, skipped: i.skipped ?? [] };
}
