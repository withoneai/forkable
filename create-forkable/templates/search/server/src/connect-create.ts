import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { IDLE_CREATE, type ConnectCreateErrorCode, type ConnectCreateStatus } from "./connect-fields.js";
import { CONNECT_NAMES } from "./connect-store.js";

// "Create my Connect app" on the setup screen: runs `one --agent connect
// create --no-open` in the repo root, which reads one.connect.ts. The CLI
// prints the approval link to stderr at once and waits (up to 10 minutes) for
// the human to approve in their browser, then writes the app's ids to .env
// and prints {"outcome": ...} on stdout. The client secret and the Connect key
// never pass through here: the approval page shows them once, and the human
// pastes them on the setup screen.
//
// One run at a time. The link goes back to this computer's own setup screen
// only; it is never logged.

export const CREATE_TIMEOUT_MS = 10 * 60_000;
/** How long POST waits for the link before answering with "checking". */
const LINK_WAIT_MS = 60_000;
const WHOAMI_TIMEOUT_MS = 30_000;

/** The first executable named `one` on PATH, or null. */
export function findOneBinary(path: string = process.env.PATH ?? ""): string | null {
  const names = process.platform === "win32" ? ["one.cmd", "one.exe", "one"] : ["one"];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = join(dir, n);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** The child's environment: no Connect values, so a stale one in this process never steers the CLI to the wrong app. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const n of CONNECT_NAMES) delete env[n];
  return env;
}

function lastJson(text: string): Record<string, unknown> | null {
  const lines = text.trim().split("\n").reverse();
  for (const line of lines) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Maps a CLI error answer to a code the screen knows. */
function cliError(json: Record<string, unknown> | null, fallback: string, defaultCode: ConnectCreateErrorCode): ConnectCreateStatus["error"] {
  if (json?.code === "NODE_UPGRADE_REQUIRED") {
    return { code: "node_upgrade", message: "The One CLI needs a newer Node.js.", upgrade: typeof json.upgrade === "string" ? json.upgrade : undefined };
  }
  const msg = typeof json?.error === "string" ? json.error : fallback;
  if (/not logged in|one login|one init|api key/i.test(msg)) return { code: "not_logged_in", message: "The One CLI is not logged in. Run one login, then try again." };
  return { code: defaultCode, message: clip(msg) };
}

export interface ConnectCreatorOptions {
  root: string;
  /** Called after an approved run so the server re-reads .env. */
  onApproved: () => Promise<void>;
  log?: (line: string) => void;
  timeoutMs?: number;
  linkWaitMs?: number;
}

export class ConnectCreator {
  private status: ConnectCreateStatus = { ...IDLE_CREATE };
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private waiters: (() => void)[] = [];
  private cancelled = false;
  private timedOut = false;

  constructor(private readonly opts: ConnectCreatorOptions) {}

  get(): ConnectCreateStatus {
    return { ...this.status };
  }

  get running(): boolean {
    return this.status.phase === "checking" || this.status.phase === "waiting";
  }

  /** Starts a run (or joins the one in flight) and answers once the link is out, the run ended, or a minute passed. */
  async start(): Promise<ConnectCreateStatus> {
    if (!this.running) void this.run();
    await new Promise<void>((done) => {
      if (this.status.phase !== "checking") return done();
      const t = setTimeout(done, this.opts.linkWaitMs ?? LINK_WAIT_MS);
      this.waiters.push(() => { clearTimeout(t); done(); });
    });
    return this.get();
  }

  cancel(): ConnectCreateStatus {
    if (!this.running) return this.get();
    this.cancelled = true;
    this.kill();
    if (!this.child) this.finish({ error: { code: "cancelled", message: "Stopped. Nothing was made." } });
    return this.get();
  }

  private wake() {
    const w = this.waiters.splice(0);
    for (const f of w) f();
  }

  private finish(patch: Partial<ConnectCreateStatus>) {
    this.status = { ...this.status, phase: patch.error ? "failed" : "done", finishedAt: new Date().toISOString(), ...patch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child = null;
    this.wake();
  }

  /** Kills the run's whole process group, so nothing it started keeps the pipes open. */
  private kill() {
    const c = this.child;
    if (!c || c.exitCode !== null || c.signalCode !== null) return;
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (c.pid && process.platform !== "win32") process.kill(-c.pid, sig);
      } catch {
        /* already gone */
      }
      c.kill(sig);
    };
    signal("SIGTERM");
    // Then anything left in the group, even if the CLI itself already went.
    setTimeout(() => signal("SIGKILL"), 5000).unref();
  }

  /** On server shutdown: stop a run in flight. */
  stop(): void {
    if (this.running) this.cancel();
  }

  private async run(): Promise<void> {
    const log = this.opts.log ?? (() => {});
    this.cancelled = false;
    this.timedOut = false;
    this.status = { ...IDLE_CREATE, phase: "checking", startedAt: new Date().toISOString() };
    const bin = findOneBinary();
    if (!bin) {
      return this.finish({ error: { code: "cli_missing", message: "The One CLI is not installed. Run npm install -g @withone/cli, then one login." } });
    }

    // 1. Logged in?
    const who = await new Promise<{ code: number | null; out: string; err: string; spawnError: boolean }>((done) => {
      let out = "";
      let err = "";
      const c = spawn(bin, ["--agent", "whoami"], { cwd: this.opts.root, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
      this.child = c;
      const t = setTimeout(() => c.kill("SIGKILL"), WHOAMI_TIMEOUT_MS);
      c.stdout.on("data", (d: Buffer) => (out += d.toString()));
      c.stderr.on("data", (d: Buffer) => (err += d.toString()));
      c.on("error", () => { clearTimeout(t); done({ code: null, out, err, spawnError: true }); });
      c.on("close", (code) => { clearTimeout(t); done({ code, out, err, spawnError: false }); });
    });
    this.child = null;
    if (this.cancelled) return this.finish({ error: { code: "cancelled", message: "Stopped. Nothing was made." } });
    if (who.spawnError) return this.finish({ error: { code: "cli_missing", message: "The One CLI could not start. Run npm install -g @withone/cli, then one login." } });
    if (who.code !== 0) {
      const e = cliError(lastJson(who.out), "The One CLI is not logged in. Run one login, then try again.", "not_logged_in");
      return this.finish({ error: e });
    }

    // 2. Create or update the app; the human approves in the browser.
    const timeoutMs = this.opts.timeoutMs ?? CREATE_TIMEOUT_MS;
    let out = "";
    let err = "";
    const c = spawn(bin, ["--agent", "connect", "create", "--no-open"], { cwd: this.opts.root, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    this.child = c;
    this.status.expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    this.timer = setTimeout(() => { this.timedOut = true; this.kill(); }, timeoutMs);
    c.stdout!.on("data", (d: Buffer) => (out += d.toString()));
    c.stderr!.on("data", (d: Buffer) => {
      err += d.toString();
      if (this.status.link) return;
      const m = err.match(/in the browser:\s*(https:\/\/\S+)/);
      if (m) {
        this.status = { ...this.status, phase: "waiting", link: m[1]! };
        log("[search] connect create: waiting for approval in the browser");
        this.wake();
      }
    });
    await new Promise<void>((done) => {
      c.on("error", () => { this.finish({ error: { code: "cli_missing", message: "The One CLI could not start. Run npm install -g @withone/cli, then one login." } }); done(); });
      // A stopped run ends when the CLI exits, without waiting on pipes a straggler may hold.
      c.on("exit", () => {
        if (this.status.phase !== "checking" && this.status.phase !== "waiting") return;
        if (this.cancelled) { this.finish({ error: { code: "cancelled", message: "Stopped. Nothing was made." } }); done(); }
        else if (this.timedOut) { this.finish({ error: { code: "timeout", message: "The approval page waited 10 minutes and closed. Nothing was made. Try again when you are ready." } }); done(); }
      });
      c.on("close", async (code) => {
        if (this.status.phase === "done" || this.status.phase === "failed") return done();
        if (this.cancelled) { this.finish({ error: { code: "cancelled", message: "Stopped. Nothing was made." } }); return done(); }
        if (this.timedOut) { this.finish({ error: { code: "timeout", message: "The approval page waited 10 minutes and closed. Nothing was made. Try again when you are ready." } }); return done(); }
        const json = lastJson(out);
        const outcome = json?.outcome;
        if (code === 0 && (outcome === "created" || outcome === "updated" || outcome === "unchanged")) {
          log(`[search] connect create: ${outcome}`);
          try {
            await this.opts.onApproved();
          } catch {
            /* the screen re-reads on its next poll */
          }
          this.finish({ outcome, clientId: typeof json?.clientId === "string" ? json.clientId : null, error: null });
        } else {
          const lastErr = err.trim().split("\n").filter((l) => !/in the browser:/.test(l)).pop() ?? "";
          this.finish({ error: cliError(json, lastErr || "The One CLI stopped without an answer.", "failed") });
        }
        done();
      });
    });
  }
}
