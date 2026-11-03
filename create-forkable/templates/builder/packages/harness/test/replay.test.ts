import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getHarness } from "../src/index.js";
import type { HarnessEvent, TurnInput } from "../src/types.js";

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-replay-"));
  const cwd = path.join(dir, "proj");
  const stateDir = path.join(dir, "state");
  const file = path.join(dir, "scenario.json");
  writeFileSync(path.join(dir, "keep"), "");
  writeFileSync(
    file,
    JSON.stringify({
      turns: [
        {
          events: [
            { t: "text_delta", text: "Writ" },
            { t: "text", text: "Writing the task list." },
            { t: "tool_start", id: "1", name: "Write", kind: "write", files: ["src/App.tsx"] },
            { t: "tool_end", id: "1", ok: true },
            { t: "usage", usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 }, total: true },
          ],
          writes: [{ path: "src/App.tsx", content: "export default 1;\n" }],
          delayMs: 1,
        },
        {
          match: "fix",
          events: [{ t: "text", text: "Fixed." }],
          writes: [{ path: "src/App.tsx", content: "export default 2;\n" }],
          delete: ["src/old.ts"],
        },
        { match: "fail", events: [], exit: "error", error: "boom" },
      ],
    }),
  );
  const input = (prompt: string, over: Partial<TurnInput> = {}): TurnInput => ({
    cwd, prompt, permission: "build", systemAppend: "", mcp: null, env: {}, timeoutMs: 10_000, idleMs: 10_000,
    stateDir, turnId: "t", replay: { file, speed: 0 }, ...over,
  });
  return { cwd, input };
}

async function collect(turn: { events: AsyncIterable<HarnessEvent> }) {
  const out: HarnessEvent[] = [];
  for await (const e of turn.events) out.push(e);
  return out;
}

describe("replay harness", () => {
  it("emits the scripted events in order and writes files before the last one", async () => {
    const { cwd, input } = setup();
    const turn = getHarness("replay").start(input("A task list for Acme Inc", { replay: { file: input("").replay!.file, speed: 1 } }));
    const seen: { t: string; fileThere: boolean }[] = [];
    for await (const e of turn.events) seen.push({ t: e.t, fileThere: existsSync(path.join(cwd, "src/App.tsx")) });
    const r = await turn.done;
    expect(seen.map((s) => s.t)).toEqual(["session", "text_delta", "text", "tool_start", "tool_end", "usage"]);
    expect(seen.at(-1)!.fileThere).toBe(true);
    expect(seen[1]!.fileThere).toBe(false);
    expect(readFileSync(path.join(cwd, "src/App.tsx"), "utf8")).toBe("export default 1;\n");
    expect(r.exit).toBe("ok");
    expect(r.text).toBe("Writing the task list.");
    expect(r.usage).toEqual({ input: 10, output: 20, cacheRead: 0, cacheWrite: 0 });
    expect(r.sessionId).toMatch(/^replay-/);
  });

  it("picks by match, applies deletes, keeps the session id", async () => {
    const { cwd, input } = setup();
    await getHarness("replay").start(input("first")).done;
    writeFileSync(path.join(cwd, "src/old.ts"), "x");
    const turn = getHarness("replay").start(input("Please fix the error", { sessionId: "s1" }));
    const evs = await collect(turn);
    const r = await turn.done;
    expect(evs[0]).toEqual({ t: "session", id: "s1" });
    expect(readFileSync(path.join(cwd, "src/App.tsx"), "utf8")).toBe("export default 2;\n");
    expect(existsSync(path.join(cwd, "src/old.ts"))).toBe(false);
    expect(r.sessionId).toBe("s1");
  });

  it("plays turns in order by counter when nothing matches, and honors index", async () => {
    const { input } = setup();
    const a = await getHarness("replay").start(input("one")).done;
    const b = await getHarness("replay").start(input("two")).done;
    expect(a.text).toBe("Writing the task list.");
    expect(b.text).toBe("Fixed.");
    const c = await getHarness("replay").start(input("three", { replay: { file: input("").replay!.file, index: 0, speed: 0 } })).done;
    expect(c.text).toBe("Writing the task list.");
  });

  it("a scripted failure ends with that exit", async () => {
    const { input } = setup();
    const r = await getHarness("replay").start(input("make it fail")).done;
    expect(r.exit).toBe("error");
    expect(r.error).toBe("boom");
  });

  it("refuses paths outside the project", async () => {
    const { input } = setup();
    const file = input("").replay!.file;
    writeFileSync(file, JSON.stringify({ turns: [{ events: [], writes: [{ path: "../escape.txt", content: "x" }] }] }));
    const r = await getHarness("replay").start(input("x")).done;
    expect(r.exit).toBe("error");
    expect(r.error).toMatch(/escapes/);
  });

  it("cancel stops a slow turn", async () => {
    const { input } = setup();
    const file = input("").replay!.file;
    writeFileSync(file, JSON.stringify({ turns: [{ events: Array.from({ length: 50 }, () => ({ t: "text_delta", text: "." })), delayMs: 50 }] }));
    const turn = getHarness("replay").start(input("x", { replay: { file, speed: 1 } }));
    setTimeout(() => void turn.cancel(), 120);
    const r = await turn.done;
    expect(r.exit).toBe("cancelled");
  });
});
