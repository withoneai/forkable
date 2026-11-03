// scan fixtures, the GitHub call sequence and
// bodies for a first and a later export, the Vercel deployment body.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GITHUB, pathParams, VERCEL, type PublishAction } from "../src/publish/actions.js";
import { uploadSet, type UploadFile, type UploadSet } from "../src/publish/files.js";
import { exportToGitHub, type ActionRunner } from "../src/publish/github.js";
import { checkManifest, findSecrets, readEnvValues, runScan, scanFiles } from "../src/publish/scan.js";
import { checkDatabaseUrl, deploymentBody, deployToVercel, healthChecklist, plainEnv, PROJECT_SETTINGS } from "../src/publish/vercel.js";
import { createStubGrant, loadKnowledgeFixtures } from "../src/fixtures.js";
import { generateActions } from "../src/catalog/codegen.js";
import { serializeManifest } from "../src/scopes/ask.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, "..", "..", "..", "fixtures");
const TEMPLATE = resolve(here, "..", "..", "template");
const knowledge = loadKnowledgeFixtures(join(FIX, "knowledge"));
const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "builder-publish-test-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const file = (path: string, text: string, mode = "100644"): UploadFile => {
  const content = Buffer.from(text);
  return { path, mode, blob: "0".repeat(40), size: content.length, content };
};
const set = (files: UploadFile[]): UploadSet => ({ sha: "a".repeat(40), files, skipped: [], bytes: files.reduce((n, f) => n + f.size, 0) });
const codes = (fs: { code: string; level: string }[], level?: string) => fs.filter((f) => !level || f.level === level).map((f) => f.code);

/** The template's own files, as an upload set (a fresh project must scan clean). */
function templateSet(): UploadSet {
  const out: UploadFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "dist", ".vercel", ".wrangler"].includes(name)) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(file(relative(TEMPLATE, abs).replace(/^_project_dir_/, ".builder").replace(/^_gitignore$/, ".gitignore"), readFileSync(abs, "utf8")));
    }
  };
  walk(TEMPLATE);
  return set(out);
}

describe("scan: file checks", () => {
  it("a fresh template scans clean (no false positives)", () => {
    const found = scanFiles({ set: templateSet(), envValues: [] });
    expect(found.filter((f) => f.level === "block")).toEqual([]);
  });

  it("a planted sk_live_ in the client bundle blocks", () => {
    const found = scanFiles({ set: set([file("src/App.tsx", "export const x = 1;")]), envValues: [], bundle: [{ path: "dist/client/assets/index-abc.js", content: Buffer.from('var a="sk_live' + '_51HxAcmeTestKey00000000abcd";') }] });
    const s = found.find((f) => f.code === "secret");
    expect(s?.level).toBe("block");
    expect(s?.title).toContain("client bundle");
    expect(s?.title).toContain("Stripe live");
    expect(JSON.stringify(found)).not.toContain("sk_live_51Hx");
  });

  it("a .dev.vars or .env in the upload set blocks", () => {
    const found = scanFiles({ set: set([file(".dev.vars", "ONE_MODE=preview\n"), file(".env.local", "X=1\n")]), envValues: [] });
    expect(codes(found, "block").filter((c) => c === "dev_vars")).toHaveLength(2);
  });

  it("a value from the scratch BUILDER_HOME/.env anywhere blocks, by name only", () => {
    const envFile = join(root, "home.env");
    writeFileSync(envFile, "ONE_CLIENT_ID=acme-client-123\nONE_CONNECT_KEY=ck_acme_value_that_is_long\nONE_MODE=preview\n");
    const env = readEnvValues(envFile);
    expect(env.map((e) => e.name)).toEqual(["ONE_CLIENT_ID", "ONE_CONNECT_KEY"]);
    const found = scanFiles({ set: set([file("server/notes.md", "keep: ck_acme_value_that_is_long")]), envValues: env, bundle: [{ path: "dist/client/a.js", content: Buffer.from('fetch("x?c=acme-client-123")') }] });
    const hits = found.filter((f) => f.code === "env_value");
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.level === "block")).toBe(true);
    expect(hits[0]!.title).toContain("ONE_CONNECT_KEY");
    expect(JSON.stringify(found)).not.toContain("ck_acme_value_that_is_long");
  });

  it("known shapes and high-entropy assignments are found; placeholders are not", () => {
    expect(findSecrets('const t = "ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789";').length).toBe(1);
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----").length).toBe(1);
    expect(findSecrets('const apiKey = "Zx9Qe7Lm2Vb8Kp4Rt6Yw1Nc3Hs5Jd0Ga";').length).toBe(1);
    expect(findSecrets('const apiKey = "your-api-key-goes-here-123";').length).toBe(0);
    expect(findSecrets('const id = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";').length).toBe(0);
  });

  it("ONE_* in client code blocks; unauthenticated DB routes, CORS * with credentials and sql.raw warn", () => {
    const found = scanFiles({
      set: set([
        file("src/lib/config.ts", "export const id = import.meta.env.ONE_CLIENT_ID;"),
        file("server/app.ts", 'app.get("/api/notes", async (c) => c.json(await db(c).select().from(notes)));\napp.post("/api/mine", async (c) => { await requireUser(c); await db(c).insert(notes).values({}); return c.json({}); });\napp.use(cors({ origin: "*", credentials: true }));\nconst q = sql.raw(`select * from notes where t = ${term}`);'),
      ]),
      envValues: [],
    });
    expect(codes(found, "block")).toEqual(["one_env_client"]);
    expect(codes(found, "warn").sort()).toEqual(["cors", "sql_raw", "unauthed_db_route"]);
    expect(found.find((f) => f.code === "unauthed_db_route")!.title).toBe("GET /api/notes reads the app database without requireUser(c)");
  });

  it("sub-routers are checked too, and a Map.get is not a route", () => {
    const found = scanFiles({
      set: set([file("server/notes.ts", 'const cache = new Map();\ncache.get("/x");\nexport const notesRoutes = new Hono();\nnotesRoutes.get("/", async (c) => { const user = await requireUser(c); return c.json(await db(c).select().from(notes)); });\nnotesRoutes.delete("/:id", async (c) => { await db(c).delete(notes); return c.json({}); });\n')]),
      envValues: [],
    });
    expect(found.map((f) => f.title)).toEqual(["DELETE /:id writes the app database without requireUser(c)"]);
  });
});

describe("scan: manifest", () => {
  let dir: string;
  beforeAll(async () => {
    dir = join(root, "manifest-app");
    mkdirSync(join(dir, "server", "one"), { recursive: true });
    mkdirSync(join(dir, ".builder"), { recursive: true });
    writeFileSync(join(dir, "server", "one", "index.ts"), readFileSync(join(TEMPLATE, "server", "one", "index.ts")));
    const gen = await generateActions([{ actionId: GET_THREADS, platform: "gmail" }], (id) => knowledge.get(id) ?? null);
    writeFileSync(join(dir, "server", "one", "actions.gen.ts"), gen.code);
    writeFileSync(join(dir, ".builder", "actions.json"), JSON.stringify([{ actionId: GET_THREADS, platform: "gmail" }]));
    writeFileSync(
      join(dir, "server", "app.ts"),
      'import { one, requireUser } from "./one";\nimport { gmail } from "./one/actions.gen";\nexport const a = async (c: any) => { await requireUser(c); return one(c).run(gmail.listAndViewEmailThreads, { body: {} }); };\nexport const b = async (c: any) => one(c).run(gmail.listAndViewEmailThreads, { body: {} });\n',
    );
  });
  const check = () => checkManifest({ dir, knowledge: (id) => knowledge.get(id) ?? null, connDef: () => "conn_def::19QDvh", lastPublished: null });

  it("drift from the committed scopes.json blocks", () => {
    writeFileSync(join(dir, ".builder", "scopes.json"), serializeManifest({ version: 1, actions: [], unused: [] }));
    const r = check();
    expect(r.matches).toBe(false);
    expect(r.findings.find((f) => f.code === "manifest_drift")?.level).toBe("block");
  });

  it("a matching scopes.json passes, and BLD005 (run without requireUser) warns", () => {
    const first = check();
    writeFileSync(join(dir, ".builder", "scopes.json"), serializeManifest(first.manifest));
    const r = check();
    expect(r.matches).toBe(true);
    expect(codes(r.findings, "block")).toEqual([]);
    expect(codes(r.findings, "warn")).toEqual(["BLD005"]);
  });

  it("the ask widened since the last publish warns with the lines", () => {
    const r = checkManifest({ dir, knowledge: (id) => knowledge.get(id) ?? null, connDef: () => "conn_def::19QDvh", lastPublished: { version: 1, actions: [], unused: [] }, describe: () => "Gmail · get threads (read)" });
    expect(r.widened).toEqual(["Gmail · get threads (read)"]);
    expect(r.findings.find((f) => f.code === "widened")?.level).toBe("warn");
  });

  it("runScan without a build reports the checks and stays ok", async () => {
    const r = await runScan({ dir, set: set([file("server/app.ts", "x")]), subject: "t", envFile: join(root, "none.env"), knowledge: (id) => knowledge.get(id) ?? null, connDef: () => "conn_def::19QDvh", lastPublished: null, build: false });
    expect(r.ok).toBe(true);
    expect(r.checks).toMatchObject({ build: "skipped", typecheck: "skipped", secrets: 0, manifest: "matches" });
  });
});

describe("upload set", () => {
  it("reads every tracked file at a sha, modes kept, untracked and ignored files left out", async () => {
    const dir = join(root, "repo");
    mkdirSync(join(dir, "tools"), { recursive: true });
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString().trim();
    g("init", "-q", "-b", "main");
    writeFileSync(join(dir, ".gitignore"), ".dev.vars\n");
    writeFileSync(join(dir, "a.txt"), "hello\n");
    writeFileSync(join(dir, "tools", "run.sh"), "#!/bin/sh\n");
    execFileSync("chmod", ["+x", join(dir, "tools", "run.sh")]);
    writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 255]));
    g("add", "-A");
    g("commit", "-q", "-m", "one");
    const sha = g("rev-parse", "HEAD");
    writeFileSync(join(dir, ".dev.vars"), "SECRET=1\n");
    writeFileSync(join(dir, "a.txt"), "changed after the commit\n");
    const s = await uploadSet(dir, sha);
    expect(s.files.map((f) => f.path).sort()).toEqual([".gitignore", "a.txt", "logo.bin", "tools/run.sh"]);
    expect(s.files.find((f) => f.path === "a.txt")!.content.toString()).toBe("hello\n");
    expect(s.files.find((f) => f.path === "tools/run.sh")!.mode).toBe("100755");
    expect([...s.files.find((f) => f.path === "logo.bin")!.content]).toEqual([0, 1, 2, 255]);
  });
});

/** A runner over the stub grant's GitHub and Vercel, recording each call. */
function recorder(platform: "github" | "vercel") {
  const stub = createStubGrant(FIX);
  const calls: { a: PublishAction; input: Parameters<ActionRunner>[1] }[] = [];
  const run: ActionRunner = async (a, input) => {
    calls.push({ a, input: structuredClone(input) });
    const r = await stub.runAction("u", { connectionKey: `sample::${platform}::acme`, actionId: a.actionId, method: a.method, path: a.path, headers: a.headers, ...input });
    return { ok: r.ok, status: r.status, data: r.data, blockedByGrant: r.blockedByGrant };
  };
  return { stub, calls, run };
}

const FILES = [file("package.json", '{"name":"acme-tasks"}\n'), file("src/App.tsx", "export default function App() { return null; }\n"), file("tools/guard.mjs", "#!/usr/bin/env node\n", "100755"), file("public/logo.png", "\u0000PNG")];

describe("GitHub export", () => {
  it("first export: private repo, a blob per file, one tree, a root commit, refs/heads/main", async () => {
    const { calls, run } = recorder("github");
    const r = await exportToGitHub({ run, files: FILES, repo: "acme-tasks", visibility: "private", appName: "Acme tasks", slug: "acme-tasks", sha: "c1a2b3d4".padEnd(40, "0"), subjects: ["A task list for Acme Inc"], previous: null });
    expect(calls.map((c) => c.a.actionId)).toEqual([GITHUB.createRepo.actionId, ...FILES.map(() => GITHUB.createBlob.actionId), GITHUB.createTree.actionId, GITHUB.createCommit.actionId, GITHUB.createRef.actionId]);
    expect(calls[0]!.input.body).toEqual({ name: "acme-tasks", private: true, auto_init: false, description: "Acme tasks, exported from acme-tasks" });
    expect(calls[1]!.input.pathParams).toEqual({ owner: "acme-inc", repo: "acme-tasks" });
    expect(calls[1]!.input.body).toEqual({ content: Buffer.from('{"name":"acme-tasks"}\n').toString("base64"), encoding: "base64" });
    const tree = calls[FILES.length + 1]!.input.body as { tree: { path: string; mode: string; type: string }[] };
    expect(tree.tree.map((t) => [t.path, t.mode, t.type])).toEqual([["package.json", "100644", "blob"], ["src/App.tsx", "100644", "blob"], ["tools/guard.mjs", "100755", "blob"], ["public/logo.png", "100644", "blob"]]);
    const commit = calls[FILES.length + 2]!.input.body as { message: string; parents: string[] };
    expect(commit.parents).toEqual([]);
    expect(commit.message).toBe("Export from Acme tasks at c1a2b3d\n\n- A task list for Acme Inc");
    expect(calls.at(-1)!.input.body).toMatchObject({ ref: "refs/heads/main" });
    expect(r).toMatchObject({ owner: "acme-inc", repo: "acme-tasks", private: true, branch: "main", conflict: false, firstExport: true, counts: { repo: 1, blobs: 4, trees: 1, commits: 1, refs: 1 } });
  });

  it("later export: reads main, commits on top of the last export, moves main without force", async () => {
    const { calls, run } = recorder("github");
    const first = await exportToGitHub({ run, files: FILES, repo: "acme-tasks", visibility: "private", appName: "Acme", slug: "acme-tasks", sha: "a".repeat(40), subjects: [], previous: null });
    calls.length = 0;
    const second = await exportToGitHub({ run, files: FILES.slice(0, 2), repo: "acme-tasks", visibility: "private", appName: "Acme", slug: "acme-tasks", sha: "b".repeat(40), subjects: ["Second"], previous: { owner: first.owner, repo: first.repo, commitSha: first.commitSha } });
    expect(calls.map((c) => c.a.actionId)).toEqual([GITHUB.getRef.actionId, GITHUB.createBlob.actionId, GITHUB.createBlob.actionId, GITHUB.createTree.actionId, GITHUB.createCommit.actionId, GITHUB.updateRef.actionId]);
    expect(calls[0]!.input.pathParams).toEqual({ owner: "acme-inc", repo: "acme-tasks", ref: "heads/main" });
    expect((calls[4]!.input.body as { parents: string[] }).parents).toEqual([first.commitSha]);
    expect(calls[5]!.input).toMatchObject({ pathParams: { ref: "heads/main" }, body: { force: false } });
    expect(second).toMatchObject({ branch: "main", conflict: false, firstExport: false, counts: { repo: 0 } });
  });

  it("when GitHub's main moved since the last export, the commit goes to <slug>-sync", async () => {
    const { stub, calls, run } = recorder("github");
    const first = await exportToGitHub({ run, files: FILES, repo: "acme-tasks", visibility: "private", appName: "Acme", slug: "acme-tasks", sha: "a".repeat(40), subjects: [], previous: null });
    stub.sim.repos.get("acme-inc/acme-tasks")!.refs.set("refs/heads/main", "f".repeat(40));
    calls.length = 0;
    const r = await exportToGitHub({ run, files: FILES, repo: "acme-tasks", visibility: "private", appName: "Acme", slug: "acme-tasks", sha: "b".repeat(40), subjects: [], previous: { owner: first.owner, repo: first.repo, commitSha: first.commitSha } });
    expect(r).toMatchObject({ branch: "acme-tasks-sync", conflict: true });
    expect(calls.at(-1)!.input.body).toMatchObject({ ref: "refs/heads/acme-tasks-sync" });
    expect(stub.sim.repos.get("acme-inc/acme-tasks")!.refs.get("refs/heads/main")).toBe("f".repeat(40));
  });

  it("public only when asked for, and an existing name is refused, not overwritten", async () => {
    const { calls, run } = recorder("github");
    await exportToGitHub({ run, files: FILES, repo: "acme-open", visibility: "public", appName: "Acme", slug: "acme-open", sha: "a".repeat(40), subjects: [], previous: null });
    expect(calls[0]!.input.body).toMatchObject({ private: false });
    await expect(exportToGitHub({ run, files: FILES, repo: "acme-open", visibility: "private", appName: "Acme", slug: "acme-open", sha: "a".repeat(40), subjects: [], previous: null })).rejects.toThrow(/already exists/);
  });
});

describe("Vercel deploy", () => {
  it("the deployment body: every file inline as base64 (the CLI's flow runner reads {{ in text) and the project settings", () => {
    const body = deploymentBody("acme-tasks", "prj_1", FILES);
    expect(body).toMatchObject({ name: "acme-tasks", project: "prj_1", target: "production", projectSettings: { framework: "vite", buildCommand: "pnpm build:vercel", outputDirectory: "dist/client", installCommand: "pnpm install" } });
    expect(body.files.map((f) => [f.file, f.encoding])).toEqual([["package.json", "base64"], ["src/App.tsx", "base64"], ["tools/guard.mjs", "base64"], ["public/logo.png", "base64"]]);
    expect(Buffer.from(body.files[0]!.data, "base64").toString()).toBe('{"name":"acme-tasks"}\n');
    expect(body.files.some((f) => f.data.includes("{{"))).toBe(false);
  });

  it("variables the platform sets are not secrets; path params follow the action's own spelling", () => {
    const env = plainEnv({ project: "acme-tasks", clientId: "acme-client", permissionSet: "ask_1" });
    expect(env.map((e) => e.key)).toEqual(["ONE_MODE", "ONE_CLIENT_ID", "ONE_REDIRECT_URI", "ONE_PERMISSION_SET", "APP_VISITOR_ACTIONS"]);
    expect(env.find((e) => e.key === "APP_VISITOR_ACTIONS")).toMatchObject({ value: "none", type: "plain" });
    expect(plainEnv({ project: "acme-tasks", visitorActions: "conn_mod_def::a::b" }).find((e) => e.key === "APP_VISITOR_ACTIONS")!.value).toBe("conn_mod_def::a::b");
    expect(env.find((e) => e.key === "ONE_REDIRECT_URI")!.value).toBe("https://acme-tasks.vercel.app/api/one/callback");
    expect(pathParams(VERCEL.createEnv, { idOrName: "prj_1" })).toEqual({ IDORNAME: "prj_1" });
    expect(pathParams(VERCEL.getDeployment, { idOrUrl: "dpl_1" })).toEqual({ idOrUrl: "dpl_1" });
  });

  it("project, env, deployment, polls, then health into a checklist", async () => {
    const { stub, calls, run } = recorder("vercel");
    const r = await deployToVercel({ run, files: FILES, project: "acme-tasks", clientId: "acme-client", permissionSet: "ask_1", health: (u) => stub.health(u), sleep: async () => {} });
    expect(calls.map((c) => c.a.actionId)).toEqual([VERCEL.createProject.actionId, VERCEL.createEnv.actionId, VERCEL.createDeployment.actionId, VERCEL.getDeployment.actionId, VERCEL.getDeployment.actionId]);
    expect(calls[0]!.input.body).toEqual({ name: "acme-tasks", ...PROJECT_SETTINGS });
    expect(r).toMatchObject({ readyState: "READY", productionUrl: "https://acme-tasks.vercel.app", counts: { project: 1, env: 5, deployment: 1, polls: 2 } });
    const ok = Object.fromEntries(r.health.checklist.map((c) => [c.key, c.ok]));
    expect(ok).toEqual({ clientId: true, clientSecret: false, connectKey: false, redirectUri: true, permissionSet: true, db: false, databaseAuthToken: false });
  });

  it("the database token goes alone in its own call, as sensitive, and never into an error", async () => {
    const token = "eyJhbGciOiJFZERTQSJ9.acme-database-token-sample";
    const { calls, run } = recorder("vercel");
    await deployToVercel({ run, files: FILES, project: "acme-db", databaseUrl: "libsql://acme-db.example.io", databaseAuthToken: token, health: async () => ({}), sleep: async () => {} });
    const withToken = calls.filter((c) => JSON.stringify(c.input).includes(token));
    expect(withToken).toHaveLength(1);
    expect(withToken[0]!.input.body).toEqual([{ key: "DATABASE_AUTH_TOKEN", value: token, type: "sensitive", target: ["production", "preview"] }]);
    const failing: ActionRunner = async (a) => (a === VERCEL.createDeployment ? { ok: false, status: 400, data: { error: { message: `bad token ${token}` } } } : run(a, {}));
    const err = await deployToVercel({ run: failing, files: FILES, project: "acme-db2", databaseAuthToken: token, health: async () => ({}), sleep: async () => {} }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain(token);
    expect(checkDatabaseUrl("libsql://acme.example.io?authToken=abc").ok).toBe(false);
    expect(healthChecklist({ configured: { clientId: true }, db: true }).checklist.filter((c) => c.ok).map((c) => c.key)).toEqual(["clientId", "db"]);
  });

  it("the app's Environment values go in one call of their own, as sensitive, and never into an error", async () => {
    const appEnv = { WEATHER_API_KEY: "wk_acme_sample_value_1", ONE_CLIENT_SECRET: "one_secret_acme_sample_value" };
    const { calls, run } = recorder("vercel");
    const r = await deployToVercel({ run, files: FILES, project: "acme-env", appEnv, health: async () => ({}), sleep: async () => {} });
    const withApp = calls.filter((c) => JSON.stringify(c.input).includes("wk_acme_sample_value_1"));
    expect(withApp).toHaveLength(1);
    expect(withApp[0]!.input.body).toEqual(Object.entries(appEnv).map(([key, value]) => ({ key, value, type: "sensitive", target: ["production", "preview"] })));
    expect(r.envSet).toEqual(expect.arrayContaining(["WEATHER_API_KEY", "ONE_CLIENT_SECRET"]));
    const failing: ActionRunner = async (a) => (a === VERCEL.createDeployment ? { ok: false, status: 400, data: { error: { message: `rejected wk_acme_sample_value_1` } } } : run(a, {}));
    const err = await deployToVercel({ run: failing, files: FILES, project: "acme-env2", appEnv, health: async () => ({}), sleep: async () => {} }).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("wk_acme_sample_value_1");
  });
});
