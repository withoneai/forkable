// Preview this version.
//
// A checkpoint is exported with `git archive` into the project's state dir
// (state/<projectId>/versions/<sha12>/, never inside the project's tracked
// files), gets an APFS clone of the project's node_modules so Vite starts
// warm, a fresh local D1 migrated to that version's schema, and its own
// .dev.vars with a local check address and dev token of its own. It runs as one more dev
// server under its own key and is served by the proxy at
// http://<slug>--v-<shortsha>.localhost:<proxy>/.
//
// Never touched: the project's HEAD, index, working tree and its .wrangler
// (the live app's data). `git archive` only reads objects. The local check refuses
// every non-read call from a version (source local, code version_preview).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND, env, PORTS, SERVER_ORIGIN } from "./brand.js";
import type { Bus } from "./bus.js";
import type { Checkpoints } from "./checkpoints.js";
import type { DevServers } from "./devserver.js";
import { devVarsText } from "./devvars.js";
import type { Home } from "./home.js";
import { newToken } from "./ids.js";
import type { PreviewState, VersionPreview } from "./types.js";

/** `<slug>--v-<shortsha>`: a slug never holds "--" (slugFrom collapses dashes), so this cannot clash with a project. */
export const VERSION_HOST_MARK = "--v-";

export function versionLabel(slug: string, sha: string): string {
  return `${slug}${VERSION_HOST_MARK}${sha.slice(0, 7)}`;
}

/** "acme-tasks--v-1a2b3c4" -> { slug: "acme-tasks", short: "1a2b3c4" }; null for a plain project label. */
export function parseVersionLabel(label: string): { slug: string; short: string } | null {
  const m = label.match(/^([a-z0-9-]+?)--v-([0-9a-f]{7,40})$/);
  return m ? { slug: m[1]!, short: m[2]! } : null;
}

export const versionUrl = (slug: string, sha: string, path = "/"): string =>
  `http://${versionLabel(slug, sha)}.localhost:${PORTS.proxy}${path.startsWith("/") ? path : `/${path}`}`;

/** The dev server key for a version (DevServers is keyed by this instead of the project id). */
export const versionKey = (projectId: string, sha: string): string => `${projectId}@${sha.slice(0, 12)}`;

/** A version preview's own local check: its manifest, reads only. */
export const versionDevUrl = (projectId: string, sha: string): string => `${SERVER_ORIGIN}/api/dev/${projectId}/v/${sha.slice(0, 7)}`;

/** Where a version's tree lives: the project's state dir, outside the repo. */
export const versionsDir = (home: Home, projectId: string): string => join(home.stateFor(projectId), "versions");

function pipeRun(cwd: string, a: [string, string[]], b: [string, string[]], timeoutMs = 60_000): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    const left = spawn(a[0], a[1], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
    const right = spawn(b[0], b[1], { cwd, stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    left.stderr.on("data", (d: Buffer) => (err += d.toString()));
    right.stderr.on("data", (d: Buffer) => (err += d.toString()));
    left.stdout.pipe(right.stdin);
    right.stdin.on("error", () => {});
    let leftCode: number | null = null;
    const t = setTimeout(() => {
      left.kill("SIGTERM");
      right.kill("SIGTERM");
    }, timeoutMs);
    left.on("error", (e) => (err += String(e)));
    right.on("error", (e) => (err += String(e)));
    left.on("close", (code) => (leftCode = code));
    right.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0 && leftCode === 0, err: err.trim().slice(0, 400) });
    });
  });
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const t = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => (err += String(e)));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, err: err.trim().slice(0, 400) });
    });
  });
}

/**
 * Write commit `sha`'s tree into `dest` (created, must not exist) without
 * touching the repo's HEAD, index or working tree: `git archive | tar -x`.
 */
export async function exportTree(repo: string, sha: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true });
  const r = await pipeRun(repo, ["git", ["archive", "--format=tar", sha]], ["tar", ["-x", "-C", dest]]);
  if (!r.ok) throw new Error(`Could not export that version: ${r.err || "git archive failed"}`);
}

/**
 * The project's installed packages for the version: an APFS clone (`cp -cR`,
 * copy on write, about as fast as the template clone) so the version's Vite
 * cache and anything it writes stay its own. A symlink would share
 * node_modules/.vite with the live dev server. Falls back to a plain copy.
 */
export async function clonePackages(projectPath: string, dest: string): Promise<boolean> {
  const src = join(projectPath, "node_modules");
  if (!existsSync(src)) return false;
  const to = join(dest, "node_modules");
  const args = process.platform === "darwin" ? ["-cR", src, to] : ["-a", "--reflink=auto", src, to];
  let r = await run("cp", args, dest);
  if (!r.ok) {
    rmSync(to, { recursive: true, force: true });
    r = await run("cp", ["-R", src, to], dest, 5 * 60_000);
  }
  return r.ok;
}

/** The version's own .dev.vars: its own local check address and dev token. Never the project's token. */
export function versionDevVars(projectId: string, sha: string, token: string): string {
  return devVarsText(projectId, token, versionDevUrl(projectId, sha)).replace(`# Written by ${BRAND.name}.`, `# Written by ${BRAND.name} for a version preview of ${sha.slice(0, 7)}.`);
}

interface Entry {
  projectId: string;
  slug: string;
  projectPath: string;
  sha: string;
  subject: string;
  dir: string;
  token: string;
  openedAt: Date;
  /** Set while the export and clone run (before the dev server exists). */
  step: string | null;
  failed: string | null;
  ready: Promise<void>;
}

export interface VersionTarget {
  id: string;
  slug: string;
  path: string;
}

export class VersionPreviews {
  /** One version preview per project at a time. */
  private open = new Map<string, Entry>();

  constructor(
    private o: { home: Home; devservers: DevServers; checkpoints: Checkpoints; bus: Bus; log?: (line: string) => void },
  ) {}

  /** Remove version trees a previous process left behind (run at boot, before any start). */
  sweep(): number {
    let n = 0;
    if (!existsSync(this.o.home.state)) return 0;
    for (const id of readdirSync(this.o.home.state)) {
      const dir = join(this.o.home.state, id, "versions");
      if (!existsSync(dir)) continue;
      rmSync(dir, { recursive: true, force: true });
      n++;
    }
    return n;
  }

  get(projectId: string): VersionPreview | null {
    const e = this.open.get(projectId);
    return e ? this.view(e) : null;
  }

  /** The open version of a project whose short sha matches a host label or relay path. */
  match(projectId: string, short: string): (Entry & { key: string }) | null {
    const e = this.open.get(projectId);
    if (!e || !e.sha.startsWith(short) || short.length < 7) return null;
    return { ...e, key: versionKey(e.projectId, e.sha) };
  }

  /** Dev token check for a version (constant shape: the token is random per open). */
  devOk(projectId: string, short: string, token: string | undefined): (Entry & { key: string }) | null {
    const e = this.match(projectId, short);
    return e && token && token === e.token ? e : null;
  }

  readyPort(projectId: string, short: string): number | null {
    const e = this.match(projectId, short);
    return e ? this.o.devservers.readyPort(e.key) : null;
  }

  viewed(projectId: string): void {
    const e = this.open.get(projectId);
    if (e) this.o.devservers.viewed(versionKey(e.projectId, e.sha));
  }

  private view(e: Entry): VersionPreview {
    const ds = this.o.devservers.state(versionKey(e.projectId, e.sha));
    const state: PreviewState = e.failed ? "error" : ds.state !== "stopped" ? ds.state : e.step ? "starting" : "stopped";
    return {
      projectId: e.projectId,
      sha: e.sha,
      shortSha: e.sha.slice(0, 7),
      subject: e.subject,
      url: versionUrl(e.slug, e.sha),
      state,
      step: e.failed || state === "ready" ? null : ds.step ?? e.step,
      message: e.failed ?? ds.message,
      openedAt: e.openedAt.toISOString(),
    };
  }

  private emit(e: Entry, state: PreviewState, step: string | null, message: string | null = null): void {
    this.o.bus.emit(e.projectId, { type: "version.status", sha: e.sha, state, step, message });
  }

  /**
   * Open `sha` of a project: export, clone packages, start its dev server.
   * Resolves once the export is under way (the dev server start is
   * reported with `version.status`). Opening another version stops the
   * first one.
   */
  async start(p: VersionTarget, sha: string): Promise<VersionPreview> {
    const cp = await this.o.checkpoints.get(p.id, sha);
    if (!cp) throw new Error("That version is not in this project's history");
    const cur = this.open.get(p.id);
    if (cur && cur.sha === cp.sha && !cur.failed) {
      this.o.devservers.viewed(versionKey(p.id, cp.sha));
      this.ensure(p.id);
      return this.view(cur);
    }
    if (cur) await this.stop(p.id);
    const dir = join(versionsDir(this.o.home, p.id), cp.sha.slice(0, 12));
    rmSync(dir, { recursive: true, force: true });
    const e: Entry = {
      projectId: p.id,
      slug: p.slug,
      projectPath: p.path,
      sha: cp.sha,
      subject: cp.subject,
      dir,
      token: newToken(),
      openedAt: new Date(),
      step: "Copying this version",
      failed: null,
      ready: Promise.resolve(),
    };
    this.open.set(p.id, e);
    this.emit(e, "starting", e.step);
    const prep = this.prepare(e);
    e.ready = prep.then(() => {}, () => {});
    prep.then(
      () => this.boot(e),
      (err: Error) => {
        if (this.open.get(p.id) !== e) return;
        e.failed = err.message;
        e.step = null;
        this.emit(e, "error", null, e.failed);
      },
    );
    return this.view(e);
  }

  /** Start the open version's dev server again when it stopped (it crashed, or the proxy asks after a restart). */
  ensure(projectId: string): void {
    const e = this.open.get(projectId);
    if (!e || e.step || e.failed) return;
    if (this.o.devservers.state(versionKey(projectId, e.sha)).state === "stopped") this.boot(e);
  }

  private async prepare(e: Entry): Promise<void> {
    const t0 = Date.now();
    await exportTree(e.projectPath, e.sha, e.dir);
    if (this.open.get(e.projectId) !== e) return;
    e.step = "Linking packages";
    this.emit(e, "starting", e.step);
    if (!(await clonePackages(e.projectPath, e.dir))) throw new Error("The project's packages are missing, so this version cannot start. Restart the live preview first.");
    if (this.open.get(e.projectId) !== e) return;
    writeFileSync(join(e.dir, ".dev.vars"), versionDevVars(e.projectId, e.sha, e.token));
    this.o.log?.(`version ${e.projectId} ${e.sha.slice(0, 7)} exported in ${Date.now() - t0} ms`);
  }

  private boot(e: Entry): void {
    if (this.open.get(e.projectId) !== e) return;
    // Until the dev server answers (or gives up), the entry says it is starting.
    e.step = "Starting this version";
    void this.o.devservers.ensure({
      id: versionKey(e.projectId, e.sha),
      path: e.dir,
      devUrl: versionDevUrl(e.projectId, e.sha),
      devToken: e.token,
      version: { projectId: e.projectId, sha: e.sha, onStop: () => this.forget(e.projectId, e) },
    }).finally(() => {
      if (this.open.get(e.projectId) === e) e.step = null;
    });
  }

  /** The dev server went away on its own terms (idle, or room for another): drop the tree. */
  private forget(projectId: string, e: Entry): void {
    if (this.open.get(projectId) !== e) return;
    this.open.delete(projectId);
    rmSync(e.dir, { recursive: true, force: true });
  }

  /** Back to current: stop the version's dev server and remove its tree. */
  async stop(projectId: string): Promise<boolean> {
    const e = this.open.get(projectId);
    if (!e) return false;
    this.open.delete(projectId);
    await e.ready.catch(() => {});
    await this.o.devservers.stop(versionKey(projectId, e.sha));
    rmSync(e.dir, { recursive: true, force: true });
    this.emit(e, "stopped", null);
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((id) => this.stop(id)));
  }
}
