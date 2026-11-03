import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupAlive, runProcess, startProcess } from "../src/executor.js";

describe("executor", () => {
  it("cancel kills the whole process group within 8 s", async () => {
    const proc = startProcess(["sh", "-c", "sleep 60 & sleep 60"], { cwd: os.tmpdir(), timeoutMs: 60_000 });
    const pgid = proc.pid!;
    await new Promise((r) => setTimeout(r, 300));
    expect(groupAlive(pgid)).toBe(true);
    const t0 = Date.now();
    await proc.cancel();
    const r = await proc.done;
    // Escalation may still be reaping the background sleep; poll briefly.
    while (groupAlive(pgid) && Date.now() - t0 < 8_000) await new Promise((res) => setTimeout(res, 100));
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(() => process.kill(-pgid, 0)).toThrow();
    expect(r.cancelled).toBe(true);
  }, 15_000);

  it("splits stdout into lines, feeds stdin, keeps a capped copy and logs everything", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "harness-exec-"));
    const log = path.join(dir, "turn-1.log");
    const got: string[] = [];
    const r = await runProcess(["sh", "-c", "cat; printf 'a\\nb\\r\\nc'"], {
      cwd: dir,
      stdin: "x\n",
      keepBytes: 4,
      logFile: log,
      onLine: (l) => got.push(l),
      timeoutMs: 10_000,
    });
    expect(got).toEqual(["x", "a", "b", "c"]);
    expect(r.stdout).toBe("x\na\n");
    expect(r.truncated).toBe(true);
    expect(r.exitCode).toBe(0);
    await new Promise((res) => setTimeout(res, 50));
    expect(readFileSync(log, "utf8")).toBe("x\na\nb\r\nc");
  });

  it("caps stderr at 5 KB", async () => {
    const r = await runProcess(["sh", "-c", "head -c 9000 /dev/zero | tr '\\0' e 1>&2"], { cwd: os.tmpdir(), timeoutMs: 10_000 });
    expect(r.stderr.length).toBe(5_000);
  });

  it("the idle clock stops a silent process", async () => {
    const r = await runProcess(["sh", "-c", "sleep 30"], { cwd: os.tmpdir(), timeoutMs: 20_000, idleMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.timeoutKind).toBe("idle");
  }, 15_000);

  it("a missing binary resolves with spawnError instead of throwing", async () => {
    const r = await runProcess(["/nonexistent/bin/xyz"], { cwd: os.tmpdir() });
    expect(r.spawnError).toBeTruthy();
  });

  it("does not hang when a background child keeps stdout open", async () => {
    const t0 = Date.now();
    const r = await runProcess(["sh", "-c", "sleep 20 & echo started"], { cwd: os.tmpdir(), timeoutMs: 15_000 });
    expect(r.stdout.trim()).toBe("started");
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});
