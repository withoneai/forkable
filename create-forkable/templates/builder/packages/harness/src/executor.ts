// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

/**
 * Process control for every CLI the platform runs: harness turns, installs,
 * tsc. Each process gets its own group (detached), so a stop reaches every
 * tool shell and server it started. Two clocks: a hard ceiling and an idle
 * timer reset by any output. Cancel is SIGINT to the CLI (Claude records the
 * turn on SIGINT), SIGTERM to the group after 3 s, SIGKILL after 5 more.
 */

export interface ProcessOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Hard ceiling. 0 = none. */
  timeoutMs?: number;
  /** Kill when nothing is printed for this long. 0 or unset = off. */
  idleMs?: number;
  /** Written to stdin, then stdin is closed. Unset: stdin is /dev/null. */
  stdin?: string;
  /** Each complete stdout line, without the newline. */
  onLine?: (line: string) => void;
  /** Each stderr chunk. */
  onStderr?: (chunk: string) => void;
  /** Bytes of stdout kept in memory (default 200 KB). */
  keepBytes?: number;
  /** Bytes of stderr kept (default 5 KB). */
  stderrBytes?: number;
  /** Full stdout is streamed here when set (state/<id>/turn-<n>.log). */
  logFile?: string;
  signal?: AbortSignal;
}

export interface ProcessResult {
  argv: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout went past keepBytes (the full text is in logFile). */
  truncated: boolean;
  timedOut: boolean;
  timeoutKind?: "ceiling" | "idle";
  cancelled: boolean;
  /** spawn failed (ENOENT and friends). */
  spawnError?: string;
  durationMs: number;
}

export interface RunningProcess {
  pid: number | undefined;
  done: Promise<ProcessResult>;
  /** Escalating stop; resolves when the process has exited. */
  cancel(): Promise<void>;
}

export const DEFAULT_KEEP_BYTES = 200_000;
export const DEFAULT_STDERR_BYTES = 5_000;
export const CANCEL_TERM_AFTER_MS = 3_000;
export const CANCEL_KILL_AFTER_MS = 5_000;

const liveGroups = new Set<number>();
let exitHookArmed = false;

function trackGroup(pid: number): void {
  liveGroups.add(pid);
  if (exitHookArmed) return;
  exitHookArmed = true;
  process.once("exit", killAllGroups);
}

/** SIGTERM every live group (server shutdown). */
export function killAllGroups(): void {
  for (const pgid of liveGroups) {
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** True while any process in the group is alive. */
export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startProcess(argv: string[], opts: ProcessOpts): RunningProcess {
  const started = Date.now();
  const [cmd, ...args] = argv;
  const keep = opts.keepBytes ?? DEFAULT_KEEP_BYTES;
  const keepErr = opts.stderrBytes ?? DEFAULT_STDERR_BYTES;

  let log: WriteStream | null = null;
  if (opts.logFile) {
    try {
      mkdirSync(path.dirname(opts.logFile), { recursive: true });
      log = createWriteStream(opts.logFile, { flags: "a" });
    } catch {
      log = null;
    }
  }

  let stdout = "";
  let stderr = "";
  let truncated = false;
  let lineBuf = "";
  let timedOut = false;
  let timeoutKind: "ceiling" | "idle" | undefined;
  let cancelled = false;
  let exited = false;
  let resolveDone!: (r: ProcessResult) => void;
  const done = new Promise<ProcessResult>((r) => (resolveDone = r));

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? process.env)) if (v !== undefined) env[k] = v;

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(cmd!, args, {
      cwd: opts.cwd,
      env,
      stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (err) {
    const result: ProcessResult = {
      argv, exitCode: null, signal: null, stdout: "", stderr: "", truncated: false,
      timedOut: false, cancelled: false, spawnError: (err as Error).message, durationMs: 0,
    };
    resolveDone(result);
    return { pid: undefined, done, cancel: async () => {} };
  }
  const pid = child.pid;
  if (pid && process.platform !== "win32") trackGroup(pid);

  const signalGroup = (sig: NodeJS.Signals) => {
    if (!pid) return;
    try {
      if (process.platform !== "win32") process.kill(-pid, sig);
      else child.kill(sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // gone
      }
    }
  };
  const signalPid = (sig: NodeJS.Signals) => {
    try {
      child.kill(sig);
    } catch {
      // gone
    }
  };

  const escalations: NodeJS.Timeout[] = [];
  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = new Promise<void>((resolve) => {
      if (exited && !(pid && groupAlive(pid))) return resolve();
      signalPid("SIGINT");
      escalations.push(
        setTimeout(() => {
          signalGroup("SIGTERM");
          escalations.push(
            setTimeout(() => {
              signalGroup("SIGKILL");
            }, CANCEL_KILL_AFTER_MS),
          );
        }, CANCEL_TERM_AFTER_MS),
      );
      void done.then(() => resolve());
    });
    return stopping;
  };

  const ceiling =
    opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => {
          if (exited) return;
          timedOut = true;
          timeoutKind = "ceiling";
          void stop();
        }, opts.timeoutMs)
      : null;

  let idleTimer: NodeJS.Timeout | null = null;
  const armIdle = () => {
    if (!opts.idleMs || opts.idleMs <= 0 || exited) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (exited) return;
      timedOut = true;
      timeoutKind = "idle";
      void stop();
    }, opts.idleMs);
  };
  armIdle();

  const onAbort = () => {
    cancelled = true;
    void stop();
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  const emitLine = (line: string) => {
    if (!line || !opts.onLine) return;
    try {
      opts.onLine(line);
    } catch {
      // a callback error must not kill the run
    }
  };

  child.stdout?.on("data", (d: Buffer) => {
    armIdle();
    const chunk = d.toString();
    log?.write(chunk);
    if (stdout.length < keep) {
      const room = keep - stdout.length;
      stdout += chunk.slice(0, room);
      if (chunk.length > room) truncated = true;
    } else truncated = true;
    if (opts.onLine) {
      lineBuf += chunk;
      let idx = lineBuf.indexOf("\n");
      while (idx !== -1) {
        emitLine(lineBuf.slice(0, idx).replace(/\r$/, ""));
        lineBuf = lineBuf.slice(idx + 1);
        idx = lineBuf.indexOf("\n");
      }
    }
  });
  child.stderr?.on("data", (d: Buffer) => {
    armIdle();
    const chunk = d.toString();
    if (stderr.length < keepErr) stderr += chunk.slice(0, keepErr - stderr.length);
    try {
      opts.onStderr?.(chunk);
    } catch {
      // ignore
    }
  });

  if (opts.stdin !== undefined && child.stdin) {
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin);
  }

  let finished = false;
  const finish = (exitCode: number | null, sig: NodeJS.Signals | null, spawnError?: string) => {
    if (finished) return;
    finished = true;
    if (pid) liveGroups.delete(pid);
    if (ceiling) clearTimeout(ceiling);
    if (idleTimer) clearTimeout(idleTimer);
    for (const t of escalations) clearTimeout(t);
    opts.signal?.removeEventListener("abort", onAbort);
    emitLine(lineBuf.replace(/\r$/, ""));
    lineBuf = "";
    log?.end();
    resolveDone({
      argv,
      exitCode,
      signal: sig,
      stdout,
      stderr,
      truncated,
      timedOut,
      ...(timeoutKind ? { timeoutKind } : {}),
      cancelled,
      ...(spawnError ? { spawnError } : {}),
      durationMs: Date.now() - started,
    });
  };

  child.on("exit", (code, sig) => {
    exited = true;
    // A stop that reached only the CLI leaves its tools behind: clear the group.
    if ((cancelled || timedOut) && pid && groupAlive(pid)) {
      signalGroup("SIGTERM");
      setTimeout(() => {
        if (pid && groupAlive(pid)) signalGroup("SIGKILL");
      }, CANCEL_KILL_AFTER_MS).unref();
    }
    // A background child can hold stdout open forever (`nohup vite &`): give
    // the pipes a moment to drain, then stop waiting for them.
    const grace = setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(code, sig);
    }, 500);
    child.once("close", () => {
      clearTimeout(grace);
      finish(code, sig);
    });
  });
  child.on("error", (err) => {
    exited = true;
    finish(null, null, err.message);
  });

  return {
    pid,
    done,
    cancel: async () => {
      cancelled = true;
      await stop();
    },
  };
}

/** Run to completion. */
export function runProcess(argv: string[], opts: ProcessOpts): Promise<ProcessResult> {
  return startProcess(argv, opts).done;
}
