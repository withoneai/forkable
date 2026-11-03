// The platform owns every dev server. One per project,
// ports from 52000 to 52999, at most 3 running, the least recently viewed
// stopped after 15 idle minutes. A version preview (Preview this version) is
// one more entry here under its own key, so it counts toward the 3 and is
// swept at boot like any other; it stops after 5 idle minutes.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { env, PORTS } from "./brand.js";
import type { Bus } from "./bus.js";
import type { Db } from "./db/client.js";
import { projects } from "./db/schema.js";
import type { ErrorStore } from "./errors.js";
import { findBin } from "./bins.js";
import { applyMigrations } from "./d1.js";
import { devVarsText } from "./devvars.js";
import type { PreviewState } from "./types.js";

export interface DevTarget {
  id: string;
  path: string;
  /** The local check's address and this project's dev token (CONTRACT 12). */
  devUrl: string;
  devToken: string;
  /**
   * A version preview: `id` is its own key (versionKey), status goes out as
   * `version.status` on the project's channel, and its errors are not the
   * project's (no error rows, no auto-fix).
   */
  version?: { projectId: string; sha: string; onStop?: () => void };
}

interface Running {
  projectId: string;
  version: DevTarget["version"] | null;
  idleMs: number;
  port: number;
  child: ChildProcess;
  state: PreviewState;
  step: string | null;
  message: string | null;
  lastViewed: number;
  startedAt: number;
  readyAt: number | null;
  ready: Promise<boolean>;
  log: string[];
}

const MAX_RUNNING = 3;
const IDLE_MS = 15 * 60_000;
const VERSION_IDLE_MS = 5 * 60_000;
const READY_TIMEOUT_MS = 90_000;

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

async function httpUp(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    await r.arrayBuffer().catch(() => {});
    return r.status > 0;
  } catch {
    return false;
  }
}

const VITE_ERR = /\[vite\]|error|Error:|✘|\[plugin:/;

export class DevServers {
  private running = new Map<string, Running>();
  private idleTimer: NodeJS.Timeout;
  /** The project's Environment values for its dev server (set by the platform). */
  envFor: ((projectId: string) => Promise<Record<string, string>>) | null = null;
  /** Scrubs those values out of the dev server's output. */
  redact: (projectId: string, text: string) => string = (_id, t) => t;

  constructor(
    private db: Db,
    private bus: Bus,
    private errors: ErrorStore,
    private log: (line: string) => void = () => {},
    /** The home that owns these previews; tagged on each so the boot sweep stays in its own home. */
    private homeRoot: string | null = null,
  ) {
    this.idleTimer = setInterval(() => void this.reapIdle(), 60_000);
    this.idleTimer.unref();
  }

  state(projectId: string): { state: PreviewState; step: string | null; port: number | null; message: string | null } {
    const r = this.running.get(projectId);
    if (!r) return { state: "stopped", step: null, port: null, message: null };
    return { state: r.state, step: r.step, port: r.port, message: r.message };
  }

  /** The dev port to proxy to when the server is ready, else null. */
  readyPort(projectId: string): number | null {
    const r = this.running.get(projectId);
    return r && r.state === "ready" ? r.port : null;
  }

  viewed(projectId: string): void {
    const r = this.running.get(projectId);
    if (r) r.lastViewed = Date.now();
  }

  private setState(r: Running, state: PreviewState, step: string | null, message: string | null = null): void {
    r.state = state;
    r.step = step;
    r.message = message;
    this.emitStatus(r, state, step, message);
  }

  private emitStatus(r: Pick<Running, "projectId" | "version">, state: PreviewState, step: string | null, message: string | null): void {
    if (r.version) this.bus.emit(r.version.projectId, { type: "version.status", sha: r.version.sha, state, step, message });
    else this.bus.emit(r.projectId, { type: "preview.status", state, step, message });
  }

  /** Allocate (or reuse) the project's dev port: bind test, recorded in the DB. */
  async allocatePort(projectId: string): Promise<number> {
    const [row] = await this.db.select({ devPort: projects.devPort }).from(projects).where(eq(projects.id, projectId));
    const taken = new Set([...this.running.values()].map((r) => r.port));
    if (row?.devPort && !taken.has(row.devPort) && (await portFree(row.devPort))) return row.devPort;
    const used = new Set((await this.db.select({ p: projects.devPort }).from(projects)).map((r) => r.p).filter(Boolean) as number[]);
    for (let p = PORTS.devMin; p <= PORTS.devMax; p++) {
      if (taken.has(p) || used.has(p)) continue;
      if (await portFree(p)) {
        await this.db.update(projects).set({ devPort: p }).where(eq(projects.id, projectId));
        return p;
      }
    }
    for (let p = PORTS.devMin; p <= PORTS.devMax; p++) {
      if (!taken.has(p) && (await portFree(p))) {
        await this.db.update(projects).set({ devPort: p }).where(eq(projects.id, projectId));
        return p;
      }
    }
    throw new Error("No free port between 52000 and 52999 for the preview");
  }

  /** Start the dev server when it is not running; resolves when it answers HTTP (true) or fails (false). */
  private starting = new Map<string, Promise<boolean>>();

  async ensure(target: DevTarget): Promise<boolean> {
    // Several callers (proxy, verifier, viewed) can ask at once: one start per project.
    const inflight = this.starting.get(target.id);
    if (inflight) return inflight;
    const p = this.start(target);
    this.starting.set(target.id, p);
    try {
      return await p;
    } finally {
      this.starting.delete(target.id);
    }
  }

  private async start(target: DevTarget): Promise<boolean> {
    const existing = this.running.get(target.id);
    if (existing && existing.state !== "error" && existing.state !== "stopped") {
      existing.lastViewed = Date.now();
      return existing.ready;
    }
    await this.makeRoom(target.id);
    const port = await this.allocatePort(target.id);
    const vite = join(target.path, "node_modules", "vite", "bin", "vite.js");
    if (!existsSync(vite)) {
      this.emitStatus({ projectId: target.id, version: target.version ?? null }, "error", null, "The project's packages are missing. Reinstall them from Settings or restart the preview.");
      return false;
    }
    // The app database: apply migrations before the Worker starts (skipped when unchanged).
    const mig = await applyMigrations(target.path);
    if (!mig.ok && !target.version) void this.errors.record(target.id, target.path, { source: "server", message: `Applying the database migration failed:\n${mig.output}` });
    // The dev token and the local check's address, rewritten every start (an older project's relay lines go away).
    if (target.devToken) writeFileSync(join(target.path, ".dev.vars"), devVarsText(target.id.split("@")[0]!, target.devToken, target.devUrl));
    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      [env("PROJECT_ID")]: target.id,
      [env("DEV_PORT")]: String(port),
      [env("HMR_PORT")]: String(PORTS.proxy),
      [env("DEV_URL")]: target.devUrl,
      // For the template's dev tagger (build errors to the dev check). The dev server's own env, never a harness's.
      [env("DEV_TOKEN")]: target.devToken,
      ...(this.homeRoot ? { [env("PREVIEW_HOME")]: this.homeRoot } : {}),
      BROWSER: "none",
      FORCE_COLOR: "0",
    };
    // NODE_ENV=production in the builder's shell turns Fast Refresh off (every edit a full reload).
    delete childEnv.NODE_ENV;
    delete childEnv[env("AGENT")];
    delete childEnv[env("TURN_ID")];
    for (const k of Object.keys(childEnv)) if (k.startsWith("ONE_") || k === "DATABASE_URL" || k === env("APP_ENV")) delete childEnv[k];
    // The project's own values (its Environment), for vite.config.ts to hand
    // the Worker as vars. One JSON variable, in this process's env only: never
    // a file in the project, never a harness env.
    const appEnv = (await this.envFor?.(target.id).catch(() => ({}))) ?? {};
    if (Object.keys(appEnv).length) childEnv[env("APP_ENV")] = JSON.stringify(appEnv);
    const child = spawn(process.execPath, [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
      cwd: target.path,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let resolveReady!: (ok: boolean) => void;
    const r: Running = {
      projectId: target.id,
      version: target.version ?? null,
      idleMs: target.version ? VERSION_IDLE_MS : IDLE_MS,
      port,
      child,
      state: "starting",
      step: "Starting preview",
      message: null,
      lastViewed: Date.now(),
      startedAt: Date.now(),
      readyAt: null,
      ready: new Promise<boolean>((res) => (resolveReady = res)),
      log: [],
    };
    this.running.set(target.id, r);
    this.setState(r, "starting", "Starting preview");
    // stderr lines arrive in bursts (a message, then its stack): group a burst into one error.
    let burst: string[] = [];
    let burstTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      burstTimer = null;
      const lines = burst;
      burst = [];
      if (r.version) return;
      if (!lines.some((l) => VITE_ERR.test(l))) return;
      if (lines.every((l) => /ExperimentalWarning|DeprecationWarning|Local Explorer/.test(l))) return;
      const head = lines.find((l) => /Error|error|✘|\[plugin:/.test(l) && !/^\s+at /.test(l)) ?? lines[0]!;
      void this.errors.record(target.id, target.path, {
        source: "server",
        message: head.trim().slice(0, 2000),
        stack: lines.filter((l) => l !== head).join("\n").slice(0, 4000) || null,
        severity: "error",
      });
    };
    const onLine = (line: string, stream: "out" | "err") => {
      const clean = this.redact(target.id, line.replace(/\u001b\[[0-9;]*m/g, ""));
      if (!clean.trim()) return;
      r.log.push(clean);
      if (r.log.length > 400) r.log.splice(0, r.log.length - 400);
      if (stream !== "err") return;
      burst.push(clean);
      if (burstTimer) clearTimeout(burstTimer);
      burstTimer = setTimeout(flush, 150);
    };
    const split = (stream: "out" | "err") => {
      let buf = "";
      return (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) onLine(l, stream);
      };
    };
    child.stdout?.on("data", split("out"));
    child.stderr?.on("data", split("err"));
    child.on("exit", (code, signal) => {
      const current = this.running.get(target.id);
      if (current !== r) return;
      this.running.delete(target.id);
      const tail = r.log.slice(-8).join("\n");
      if (r.state !== "stopped") {
        this.emitStatus(r, signal ? "stopped" : "error", null, signal ? null : `The preview stopped (exit ${code}). ${tail ? `Last lines:\n${tail}` : ""}`.trim());
      }
      resolveReady(false);
    });
    // Ready when HTTP answers.
    void (async () => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline && this.running.get(target.id) === r) {
        if (await httpUp(port)) {
          r.readyAt = Date.now();
          this.setState(r, "ready", null);
          this.log(`preview ${target.id} ready on ${port} in ${r.readyAt - r.startedAt} ms`);
          resolveReady(true);
          return;
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      if (this.running.get(target.id) === r) {
        this.setState(r, "error", null, "The preview did not start in 90 seconds.");
        resolveReady(false);
      }
    })();
    return r.ready;
  }

  logTail(projectId: string, n = 40): string[] {
    return this.running.get(projectId)?.log.slice(-n) ?? [];
  }

  async stop(projectId: string): Promise<void> {
    const r = this.running.get(projectId);
    if (!r) return;
    r.state = "stopped";
    this.running.delete(projectId);
    const pid = r.child.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* gone */
      }
      const exited = await new Promise<boolean>((res) => {
        if (r.child.exitCode !== null || r.child.signalCode !== null) return res(true);
        const t = setTimeout(() => res(false), 4000);
        r.child.once("exit", () => {
          clearTimeout(t);
          res(true);
        });
      });
      if (!exited) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
    }
    this.emitStatus(r, "stopped", null, null);
    r.version?.onStop?.();
  }

  async restart(target: DevTarget): Promise<boolean> {
    await this.stop(target.id);
    return this.ensure(target);
  }

  private async makeRoom(keep: string): Promise<void> {
    const others = [...this.running.values()].filter((r) => r.projectId !== keep);
    if (others.length < MAX_RUNNING) return;
    others.sort((a, b) => a.lastViewed - b.lastViewed);
    await this.stop(others[0]!.projectId);
  }

  private async reapIdle(): Promise<void> {
    const now = Date.now();
    for (const r of [...this.running.values()]) if (now - r.lastViewed > r.idleMs) await this.stop(r.projectId);
  }

  pids(): number[] {
    return [...this.running.values()].map((r) => r.child.pid!).filter(Boolean);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.idleTimer);
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}

/** Install the project's packages from the shared store (offline first). */
export async function installPackages(cwd: string, onLine?: (line: string) => void): Promise<{ ok: boolean; tail: string }> {
  const pnpm = (await findBin("pnpm")) ?? "pnpm";
  const attempt = (args: string[]) =>
    new Promise<{ ok: boolean; out: string }>((resolve) => {
      const child = spawn(pnpm, args, {
        cwd,
        env: { ...process.env, CI: "1", npm_config_yes: "true" } as Record<string, string>,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const take = (d: Buffer) => {
        const s = d.toString();
        out += s;
        if (out.length > 200_000) out = out.slice(-100_000);
        for (const l of s.split("\n")) if (l.trim()) onLine?.(l);
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      const t = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
      child.on("close", (code) => {
        clearTimeout(t);
        resolve({ ok: code === 0, out });
      });
      child.on("error", (e) => {
        clearTimeout(t);
        resolve({ ok: false, out: String(e) });
      });
    });
  let r = await attempt(["install", "--offline", "--ignore-workspace", "--reporter=append-only"]);
  if (!r.ok) r = await attempt(["install", "--prefer-offline", "--ignore-workspace", "--reporter=append-only"]);
  return { ok: r.ok, tail: r.out.split("\n").filter(Boolean).slice(-15).join("\n") };
}
