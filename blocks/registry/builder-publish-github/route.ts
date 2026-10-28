import { Hono } from "hono";
import type { Context } from "hono";
import { OneRefused, type OneMeta, type OneServer } from "../lib/one-server.js";
import { GITHUB, JSON_IO } from "../builder/actions.js";
import type { PublishResponse, PublishStep, SourceFile } from "../builder/types.js";

// Builder's GitHub export, first-export path (builder/packages/core/src/publish/github.ts):
// make the repository (private unless the user chose public on purpose, no
// auto-init), one blob per file, one tree, a root commit, refs/heads/main.
// Every call runs on the user's GitHub through their grant. Nothing is pushed
// with git and no token reaches the app.

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const validRepo = (s: string) => REPO_NAME.test(s) && !/^\.+$/.test(s) && !s.endsWith(".git");
type O = Record<string, unknown>;
const obj = (d: unknown): O => (d && typeof d === "object" ? (d as O) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** UTF-8 to base64 without Node's Buffer, so the route also runs on Workers. */
function base64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

class Stop extends Error {
  constructor(readonly step: PublishStep["step"], message: string) {
    super(message);
  }
}

export function builderPublishGithubRoute(one: OneServer) {
  const r = new Hono();
  r.post("/api/builder/publish/github", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { repo?: string; visibility?: "private" | "public"; confirmPublic?: boolean; files?: SourceFile[]; message?: string };
    const repo = String(b.repo ?? "").trim();
    const files = (b.files ?? []).filter((f) => f && typeof f.path === "string" && typeof f.content === "string").slice(0, 2000);
    if (!validRepo(repo)) return c.json({ error: { code: "bad_request", message: "Repository names use letters, numbers, dots, dashes and underscores." } }, 400);
    if (!files.length) return c.json({ error: { code: "bad_request", message: "Nothing to publish." } }, 400);
    // Public only when the person ticked the box, checked again here.
    const isPrivate = !(b.visibility === "public" && b.confirmPublic === true);
    const message = (b.message ?? "").trim() || `Publish ${repo}`;

    if (one.mode() === "sample") {
      const fake = (n: number) => Array.from({ length: 40 }, (_, i) => "0123456789abcdef"[(n * 7 + i * 13) % 16]).join("");
      const data: PublishResponse = {
        url: `https://github.com/acme-dev/${repo}`,
        owner: "acme-dev",
        repo,
        private: isPrivate,
        commit: fake(files.length),
        steps: [
          { step: "repo", status: "done", detail: `${isPrivate ? "Private" : "Public"} repository acme-dev/${repo}` },
          { step: "blobs", status: "done", detail: `${files.length} file${files.length === 1 ? "" : "s"}` },
          { step: "tree", status: "done", detail: "One tree" },
          { step: "commit", status: "done", detail: fake(files.length).slice(0, 7) },
          { step: "branch", status: "done", detail: "main" },
        ],
      };
      return c.json({ data, meta: { mode: "sample", platform: "github", access: "write", status: 200 } satisfies OneMeta, note: "Sample mode: nothing was created on GitHub." });
    }

    const steps: PublishStep[] = [];
    const run = async (action: (typeof GITHUB)[keyof typeof GITHUB], step: PublishStep["step"], what: string, input: { pathParams?: Record<string, string>; body?: unknown }) => {
      try {
        return (await one.call<unknown>(c, { action, headers: JSON_IO, ...input, sample: () => null })).data;
      } catch (e) {
        if (e instanceof OneRefused && e.code === "outside_grant") throw new Stop(step, `One refused ${what}: your grant does not include it. Widen GitHub's access in One, then try again.`);
        if (e instanceof OneRefused && e.code === "provider_error" && step === "repo" && e.meta.status === 422) throw new Stop(step, `A repository named ${repo} already exists on your GitHub account, or the name is not allowed. Pick another name.`);
        if (e instanceof OneRefused) throw new Stop(step, `GitHub answered ${e.meta.status} to ${what}.`);
        throw e;
      }
    };
    try {
      const made = obj(await run(GITHUB.createRepo, "repo", "creating the repository", { body: { name: repo, private: isPrivate, auto_init: false, description: message } }));
      const owner = str(obj(made.owner).login);
      const name = str(made.name) ?? repo;
      if (!owner) throw new Stop("repo", "GitHub made the repository but did not say who owns it.");
      steps.push({ step: "repo", status: "done", detail: `${made.private === false ? "Public" : "Private"} repository ${owner}/${name}` });
      const where = { owner, repo: name };

      const shas: string[] = [];
      for (let i = 0; i < files.length; i += 4) {
        const batch = await Promise.all(
          files.slice(i, i + 4).map(async (f) => {
            const sha = str(obj(await run(GITHUB.createBlob, "blobs", `uploading ${f.path}`, { pathParams: where, body: { content: base64(f.content), encoding: "base64" } })).sha);
            if (!sha) throw new Stop("blobs", `GitHub stored ${f.path} but returned no sha.`);
            return sha;
          }),
        );
        shas.push(...batch);
      }
      steps.push({ step: "blobs", status: "done", detail: `${files.length} file${files.length === 1 ? "" : "s"}` });

      const tree = str(obj(await run(GITHUB.createTree, "tree", "writing the file tree", { pathParams: where, body: { tree: files.map((f, n) => ({ path: f.path, mode: "100644", type: "blob", sha: shas[n] })) } })).sha);
      if (!tree) throw new Stop("tree", "GitHub wrote the tree but returned no sha.");
      steps.push({ step: "tree", status: "done", detail: "One tree" });

      const commit = str(obj(await run(GITHUB.createCommit, "commit", "making the commit", { pathParams: where, body: { message, tree, parents: [] } })).sha);
      if (!commit) throw new Stop("commit", "GitHub made the commit but returned no sha.");
      steps.push({ step: "commit", status: "done", detail: commit.slice(0, 7) });

      await run(GITHUB.createRef, "branch", "creating main", { pathParams: where, body: { ref: "refs/heads/main", sha: commit } });
      steps.push({ step: "branch", status: "done", detail: "main" });
      const data: PublishResponse = { url: str(made.html_url) ?? `https://github.com/${owner}/${name}`, owner, repo: name, private: made.private !== false, commit, steps };
      return c.json({ data, meta: { mode: "grant", platform: "github", access: "write", status: 200 } satisfies OneMeta });
    } catch (e) {
      if (e instanceof Stop) {
        steps.push({ step: e.step, status: "failed", detail: e.message });
        return c.json({ data: { url: null, owner: null, repo, private: isPrivate, commit: null, steps } satisfies PublishResponse, meta: { mode: "grant", platform: "github", access: "write", status: 502 } satisfies OneMeta });
      }
      return one.error(c as Context, e);
    }
  });
  return r;
}
