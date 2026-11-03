// Preview this version (an older checkpoint on its own dev server
// and host) and images staged on Home before a project exists.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adoptStaged, isAttachmentName, saveAttachment, stagedDir, stagedExisting, sweepStaged } from "../src/attachments.js";
import { createBus } from "../src/bus.js";
import type { DevTarget } from "../src/devserver.js";
import * as git from "../src/git.js";
import { resolveHome } from "../src/home.js";
import { receiptLine } from "../src/receipts.js";
import { DevGate } from "../src/devgate.js";
import type { ActivityInput } from "../src/activity.js";
import type { Manifest } from "../src/types.js";
import { slugFrom } from "../src/workspace.js";
import { exportTree, parseVersionLabel, versionDevVars, versionKey, versionDevUrl, versionLabel, VersionPreviews, versionUrl } from "../src/versions.js";

const who = { name: "Test", email: "test@localhost" };
const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A project repo with two versions, the live app's data in .wrangler and a manual edit in the working tree. */
async function repo() {
  const d = tmp("bld-ver-repo-");
  await git.initRepo(d);
  writeFileSync(join(d, ".gitignore"), "node_modules\n.wrangler\n.dev.vars\n");
  writeFileSync(join(d, "App.tsx"), "export const title = 'one';\n");
  const v1 = (await git.commitWorkingTree(d, git.message("First", {}), who))!.sha;
  writeFileSync(join(d, "App.tsx"), "export const title = 'two';\n");
  writeFileSync(join(d, "Inbox.tsx"), "export const inbox = true;\n");
  const v2 = (await git.commitWorkingTree(d, git.message("Second", {}), who))!.sha;
  mkdirSync(join(d, "node_modules", "vite"), { recursive: true });
  writeFileSync(join(d, "node_modules", "vite", "package.json"), "{}");
  mkdirSync(join(d, ".wrangler", "state"), { recursive: true });
  writeFileSync(join(d, ".wrangler", "state", "db.sqlite"), "live data");
  writeFileSync(join(d, ".dev.vars"), "BUILDER_RELAY_TOKEN=project-token\n");
  writeFileSync(join(d, "App.tsx"), "export const title = 'manual';\n");
  return { d, v1, v2 };
}

const status = async (d: string) => (await git.runGit(d, ["status", "--porcelain"])).stdout;
const indexTree = async (d: string) => (await git.runGit(d, ["write-tree"])).stdout.trim();

describe("version hosts", () => {
  it("names a version <slug>--v-<shortsha> and reads it back", () => {
    const sha = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
    expect(versionLabel("acme-tasks", sha)).toBe("acme-tasks--v-1a2b3c4");
    expect(parseVersionLabel("acme-tasks--v-1a2b3c4")).toEqual({ slug: "acme-tasks", short: "1a2b3c4" });
    expect(parseVersionLabel("acme-tasks")).toBeNull();
    expect(parseVersionLabel("acme-tasks-2")).toBeNull();
    expect(versionUrl("acme-tasks", sha)).toMatch(/^http:\/\/acme-tasks--v-1a2b3c4\.localhost:\d+\/$/);
    expect(versionDevUrl("p_1", sha)).toMatch(/\/api\/dev\/p_1\/v\/1a2b3c4$/);
    expect(versionKey("p_1", sha)).toBe("p_1@1a2b3c4d5e6f");
  });

  it("never collides with a project slug (slugs have no double dash)", () => {
    for (const t of ["A -- v - list", "task--list", "  --v-abc1234  ", "Acme -- Inc"]) expect(slugFrom(t)).not.toContain("--");
  });
});

describe("exporting a version", () => {
  it("writes the commit's tree elsewhere and leaves HEAD, the index and the working tree alone", async () => {
    const { d, v1, v2 } = await repo();
    const before = { head: await git.headCommit(d), status: await status(d), index: await indexTree(d) };
    const out = join(tmp("bld-ver-out-"), "v");
    await exportTree(d, v1, out);
    expect(readFileSync(join(out, "App.tsx"), "utf8")).toContain("'one'");
    expect(existsSync(join(out, "Inbox.tsx"))).toBe(false);
    expect(existsSync(join(out, ".wrangler"))).toBe(false);
    expect(existsSync(join(out, ".git"))).toBe(false);
    expect(await git.headCommit(d)).toBe(v2);
    expect(await git.headCommit(d)).toBe(before.head);
    expect(await status(d)).toBe(before.status);
    expect(await indexTree(d)).toBe(before.index);
    expect(readFileSync(join(d, "App.tsx"), "utf8")).toContain("'manual'");
  });

  it("gives the version its own local check address and dev token, never the project's", () => {
    const vars = versionDevVars("p_1", "1a2b3c4d5e6f", "tok-version");
    expect(vars).toContain("BUILDER_DEV_URL=http://127.0.0.1:");
    expect(vars).toContain("/api/dev/p_1/v/1a2b3c4");
    expect(vars).toContain("BUILDER_DEV_TOKEN=tok-version");
    expect(vars).toContain("for a version preview of 1a2b3c4");
    // Not a One credential, and no retired relay lines.
    expect(vars).not.toMatch(/RELAY|ONE_CLIENT|ONE_CONNECT_KEY|ONE_SECRET/);
  });
});

describe("VersionPreviews", () => {
  const setup = async () => {
    const { d, v1, v2 } = await repo();
    const home = resolveHome(tmp("bld-ver-home-"));
    const started: DevTarget[] = [];
    const stopped: string[] = [];
    const states = new Map<string, "starting" | "ready" | "stopped">();
    const devservers = {
      ensure: async (t: DevTarget) => { started.push(t); states.set(t.id, "ready"); return true; },
      stop: async (id: string) => { stopped.push(id); const t = started.find((s) => s.id === id); states.delete(id); t?.version?.onStop?.(); },
      state: (id: string) => ({ state: states.get(id) ?? "stopped", step: null, port: states.has(id) ? 52042 : null, message: null }),
      readyPort: (id: string) => (states.get(id) === "ready" ? 52042 : null),
      viewed: () => {},
    };
    const subjects: Record<string, string> = { [v1]: "First", [v2]: "Second" };
    const checkpoints = { get: async (_p: string, sha: string) => { const full = [v1, v2].find((s) => s.startsWith(sha)); return full ? { sha: full, subject: subjects[full] } : null; } };
    const bus = createBus();
    const events: string[] = [];
    bus.on((_p, e) => { if (e.type === "version.status") events.push(e.state); });
    const versions = new VersionPreviews({ home, devservers: devservers as never, checkpoints: checkpoints as never, bus });
    const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 20)); };
    return { d, v1, v2, home, versions, started, stopped, events, until, target: { id: "p_1", slug: "acme-tasks", path: d } };
  };

  it("exports into the project's state dir, clones packages and starts its own dev server", async () => {
    const s = await setup();
    const head = await git.headCommit(s.d);
    const st = await status(s.d);
    const v = await s.versions.start(s.target, s.v1.slice(0, 7));
    expect(v).toMatchObject({ sha: s.v1, shortSha: s.v1.slice(0, 7), subject: "First", state: "starting" });
    expect(v.url).toContain(`acme-tasks--v-${s.v1.slice(0, 7)}.localhost`);
    await s.until(() => s.started.length > 0);
    const t = s.started[0]!;
    expect(t.id).toBe(versionKey("p_1", s.v1));
    expect(t.path.startsWith(join(s.home.state, "p_1", "versions"))).toBe(true);
    expect(t.path.startsWith(s.d)).toBe(false);
    expect(t.version).toMatchObject({ projectId: "p_1", sha: s.v1 });
    expect(readFileSync(join(t.path, "App.tsx"), "utf8")).toContain("'one'");
    expect(existsSync(join(t.path, "node_modules", "vite", "package.json"))).toBe(true);
    // A fresh database: the live app's .wrangler data is not there.
    expect(existsSync(join(t.path, ".wrangler"))).toBe(false);
    const vars = readFileSync(join(t.path, ".dev.vars"), "utf8");
    expect(vars).toContain(`BUILDER_DEV_TOKEN=${t.devToken}`);
    expect(vars).not.toContain("project-token");
    expect(s.versions.devOk("p_1", s.v1.slice(0, 7), t.devToken)).not.toBeNull();
    expect(s.versions.devOk("p_1", s.v1.slice(0, 7), "project-token")).toBeNull();
    expect(s.versions.devOk("p_1", s.v1.slice(0, 7), undefined)).toBeNull();
    expect(s.versions.devOk("p_1", s.v2.slice(0, 7), t.devToken)).toBeNull();
    expect(s.versions.readyPort("p_1", s.v1.slice(0, 7))).toBe(52042);
    expect(s.versions.get("p_1")?.state).toBe("ready");
    expect(await git.headCommit(s.d)).toBe(head);
    expect(await status(s.d)).toBe(st);
  });

  it("stops the version and removes its tree; another version replaces the first", async () => {
    const s = await setup();
    await s.versions.start(s.target, s.v1);
    await s.until(() => s.started.length === 1);
    const first = s.started[0]!.path;
    await s.versions.start(s.target, s.v2);
    await s.until(() => s.started.length === 2);
    expect(s.stopped).toEqual([versionKey("p_1", s.v1)]);
    expect(existsSync(first)).toBe(false);
    expect(s.versions.get("p_1")?.sha).toBe(s.v2);
    expect(await s.versions.stop("p_1")).toBe(true);
    expect(existsSync(s.started[1]!.path)).toBe(false);
    expect(s.versions.get("p_1")).toBeNull();
    expect(s.events.at(-1)).toBe("stopped");
  });

  it("forgets the version when its dev server is stopped for idle or room, and the boot sweep clears leftovers", async () => {
    const s = await setup();
    await s.versions.start(s.target, s.v1);
    await s.until(() => s.started.length === 1);
    const dir = s.started[0]!.path;
    s.started[0]!.version!.onStop!();
    expect(s.versions.get("p_1")).toBeNull();
    expect(existsSync(dir)).toBe(false);
    mkdirSync(join(s.home.state, "p_9", "versions", "abc"), { recursive: true });
    expect(s.versions.sweep()).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(s.home.state, "p_9", "versions"))).toBe(false);
  });

  it("refuses a version that is not in the project's history", async () => {
    const s = await setup();
    await expect(s.versions.start(s.target, "deadbeef")).rejects.toThrow(/not in this project's history/);
  });
});

describe("the dev gate for a version preview", () => {
  const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
  const READ = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
  const manifest: Manifest = {
    version: 1,
    actions: [
      { platform: "gmail", connDefId: "c", actionId: READ, title: "List threads", method: "POST", level: "read" },
      { platform: "gmail", connDefId: "c", actionId: SEND, title: "Send Email", method: "POST", level: "write" },
    ],
    unused: [],
  };
  const rows: ActivityInput[] = [];
  const derived: string[] = [];
  const gate = new DevGate({
    catalog: { cached: () => null, platformName: async () => "Gmail" } as never,
    scopes: { derive: async (p: { path: string }) => (derived.push(p.path), { manifest, callSites: [], issues: [] }) } as never,
    activity: { record: async (_p: string, r: ActivityInput) => (rows.push(r), { id: rows.length, ...r }) } as never,
    activeTurn: async () => null,
    kind: () => "one",
  });
  const p = { id: "p_1", name: "Acme", path: "/projects/acme" };
  const version = { id: "p_1@abc", path: "/state/p_1/versions/abc" };

  it("holds a write locally with its own line, never One's, so the app never calls One", async () => {
    const r = await gate.check(p, { platform: "gmail", actionId: SEND, method: "POST", path: "/send" }, { version });
    expect(r.allow).toBe(false);
    if (r.allow) return;
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, source: "local", blockedByGrant: false, refusal: { source: "local", code: "version_preview" } });
    expect(r.receipt).toMatchObject({ badge: "Local", line: "Gmail · send   held locally, previewing an older version" });
    expect(r.receipt.line).not.toContain("declined, 403");
    expect(derived.at(-1)).toBe(version.path);
    expect(rows.at(-1)).toMatchObject({ source: "local", status: 403, refusal: { code: "version_preview" } });
  });

  it("lets reads go to One, and the live app's writes are untouched", async () => {
    const r = await gate.check(p, { platform: "gmail", actionId: READ, method: "POST", path: "/threads" }, { version });
    expect(r).toMatchObject({ allow: true, level: "read", source: "one" });
    const live = await gate.check(p, { platform: "gmail", actionId: SEND, method: "POST", path: "/send" });
    expect(live).toMatchObject({ allow: true, level: "write" });
    expect(derived.at(-1)).toBe(p.path);
  });

  it("formats the receipt line for the terminal and the ledger", () => {
    expect(receiptLine({ platformName: "Slack", verb: "post", source: "local", code: "version_preview" })).toBe("Slack · post   held locally, previewing an older version");
  });
});

describe("images staged on Home", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");

  it("takes the composer's types and limit", () => {
    const home = resolveHome(tmp("bld-att-home-"));
    expect(saveAttachment(stagedDir(home), "image/svg+xml", png)).toMatchObject({ ok: false, status: 415 });
    expect(saveAttachment(stagedDir(home), "image/png", Buffer.alloc(8 * 1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413 });
    const ok = saveAttachment(stagedDir(home), "image/jpeg; charset=binary", png);
    expect(ok.ok && ok.file.endsWith(".jpg")).toBe(true);
  });

  it("moves staged images into the new project for its first turn, and ignores names that are not staged", () => {
    const home = resolveHome(tmp("bld-att-home-"));
    const project = tmp("bld-att-proj-");
    const a = saveAttachment(stagedDir(home), "image/png", png);
    const b = saveAttachment(stagedDir(home), "image/webp", png);
    if (!a.ok || !b.ok) throw new Error("save failed");
    expect(isAttachmentName("../config.json")).toBe(false);
    expect(stagedExisting(home, [a.file, "../x.png", "nope.png", a.file, 3])).toEqual([a.file]);
    const paths = adoptStaged(home, project, [a.file, b.file, "../../etc/passwd", "missing.png"]);
    expect(paths).toEqual([join(project, ".builder", "attachments", a.file), join(project, ".builder", "attachments", b.file)]);
    expect(paths.every((f) => existsSync(f))).toBe(true);
    expect(existsSync(join(stagedDir(home), a.file))).toBe(false);
    expect(adoptStaged(home, project, undefined)).toEqual([]);
  });

  it("sweeps staged images after a day, except the ones a pending prompt holds", () => {
    const home = resolveHome(tmp("bld-att-home-"));
    const a = saveAttachment(stagedDir(home), "image/png", png);
    const b = saveAttachment(stagedDir(home), "image/png", png);
    if (!a.ok || !b.ok) throw new Error("save failed");
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    for (const f of [a.file, b.file]) utimesSync(join(stagedDir(home), f), old, old);
    expect(sweepStaged(home, [b.file])).toBe(1);
    expect(stagedExisting(home, [a.file, b.file])).toEqual([b.file]);
  });
});
