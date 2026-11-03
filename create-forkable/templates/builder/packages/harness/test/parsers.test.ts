import { describe, expect, it } from "vitest";
import { ClaudeStreamParser } from "../src/parsers/claude.js";
import { CodexStreamParser } from "../src/parsers/codex.js";
import { isOpenClawSetupError, openClawEvents, parseOpenClawEnvelope } from "../src/parsers/openclaw.js";
import type { HarnessEvent } from "../src/types.js";
import { lines, text } from "./helpers.js";

const run = <P extends { parse(l: string): HarnessEvent[] }>(p: P, file: string) => lines(file).flatMap((l) => p.parse(l));

describe("claude stream-json parser", () => {
  it("reads a real turn: minted session, MCP connected, Write and Bash, usage total", () => {
    const p = new ClaudeStreamParser("/tmp/harness-rec/proj");
    const evs = run(p, "claude/write-bash-mcp.jsonl");
    expect(evs[0]).toEqual({ t: "session", id: "938e2418-190d-4399-b254-dc144c97d470" });
    expect(evs).toContainEqual({ t: "mcp", name: "builder", status: "connected" });
    const starts = evs.filter((e) => e.t === "tool_start");
    expect(starts.map((s) => [s.name, s.kind])).toEqual([["Write", "write"], ["Bash", "run"]]);
    expect(starts[0]).toMatchObject({ files: ["hello.txt"] });
    expect(starts[1]).toMatchObject({ detail: "echo done" });
    const ends = evs.filter((e) => e.t === "tool_end");
    expect(ends).toHaveLength(2);
    expect(ends.every((e) => e.t === "tool_end" && e.ok)).toBe(true);
    expect(evs.some((e) => e.t === "text_delta")).toBe(true);
    const totals = evs.filter((e) => e.t === "usage" && e.total);
    expect(totals).toHaveLength(1);
    expect(p.final?.isError).toBe(false);
    expect(p.final?.totalCostUsd).toBeGreaterThan(0);
    expect(p.final?.text).toMatch(/hello\.txt/);
  });

  it("reports a deny-list refusal once (system event and result denials deduped)", () => {
    const p = new ClaudeStreamParser();
    const denied = run(p, "claude/denied.jsonl").filter((e) => e.t === "denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ tool: "Bash", reason: expect.stringContaining("curl --version") });
  });

  it("a failed resume has no trusted session and names the error", () => {
    const p = new ClaudeStreamParser();
    const evs = run(p, "claude/resume-missing.jsonl");
    expect(evs.some((e) => e.t === "session")).toBe(false);
    expect(p.init).toBeNull();
    expect(p.final?.errors[0]).toMatch(/No conversation found/);
  });

  it("seed stream: failed MCP, thinking delta, retry, ghost result id, relative files, one tools", () => {
    const p = new ClaudeStreamParser("/work/acme");
    const evs = run(p, "claude/seed-stream.jsonl");
    expect(evs.filter((e) => e.t === "session")).toEqual([{ t: "session", id: "sess-1" }]);
    expect(evs).toContainEqual({ t: "mcp", name: "builder", status: "failed", error: "spawn node ENOENT" });
    expect(evs).toContainEqual({ t: "thinking", text: "Plan the edit", delta: true });
    expect(evs).toContainEqual({ t: "retry", attempt: 1, error: "overloaded" });
    const edit = evs.find((e) => e.t === "tool_start" && e.name === "Edit");
    expect(edit).toMatchObject({ kind: "write", files: ["src/App.tsx"] });
    const one = evs.find((e) => e.t === "tool_start" && e.name.startsWith("mcp__"));
    expect(one).toMatchObject({ kind: "one", input: { actionId: "conn_mod_def::x" } });
    expect(evs).toContainEqual({ t: "tool_end", id: "call-2", ok: false, preview: "src/App.tsx(18,3): error TS2322" });
    expect(evs).toContainEqual({ t: "denied", tool: "Bash(pnpm dev)" });
    expect(evs.filter((e) => e.t === "limit")).toHaveLength(0);
    expect(p.final?.contextWindow).toBe(1_000_000);
    expect(evs).toContainEqual({ t: "usage", total: true, usage: { input: 9, output: 3400, cacheRead: 250000, cacheWrite: 4100 } });
  });

  it("an authentication retry marks the turn signed out", () => {
    const p = new ClaudeStreamParser();
    run(p, "claude/signed-out.jsonl");
    expect(p.signedOut).toBe(true);
  });

  it("a rejected rate limit window is a limit event with the reset time", () => {
    const p = new ClaudeStreamParser();
    const evs = p.parse(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1792843800 } }));
    expect(evs).toEqual([{ t: "limit", resetsAt: new Date(1792843800 * 1000).toISOString() }]);
  });

  it("ignores non-JSON and subagent traffic", () => {
    const p = new ClaudeStreamParser();
    expect(p.parse("No conversation found")).toEqual([]);
    expect(p.parse(JSON.stringify({ type: "assistant", parent_tool_use_id: "x", message: { content: [{ type: "text", text: "inner" }] } }))).toEqual([]);
  });
});

describe("codex exec --json parser", () => {
  it("reads a real turn: thread, file_change, MCP call, usage without the cached part", () => {
    const p = new CodexStreamParser("/tmp/harness-rec/cx");
    const evs = run(p, "codex/write-mcp.jsonl");
    expect(evs[0]).toEqual({ t: "session", id: "01a16cce-d4af-7991-a2ce-bf16f820cdee" });
    expect(evs.find((e) => e.t === "tool_start" && e.name === "file_change")).toMatchObject({ kind: "write", files: ["note.txt"] });
    expect(evs.find((e) => e.t === "tool_start" && e.name === "mcp__builder__project_errors")).toMatchObject({ kind: "other" });
    expect(evs).toContainEqual({ t: "tool_end", id: "item_2", ok: true, preview: "server says: pong" });
    expect(evs).toContainEqual({ t: "usage", total: true, usage: { input: 71631 - 64128, output: 637, cacheRead: 64128, cacheWrite: 0 } });
    expect(p.lastText).toMatch(/server says: pong/);
    expect(p.failed).toBeNull();
  });

  it("an MCP call refused for approval is a denial; a failed command is a failed tool", () => {
    const p = new CodexStreamParser("/tmp/harness-rec/cx");
    const evs = run(p, "codex/mcp-approval-failed.jsonl");
    expect(evs).toContainEqual({ t: "tool_end", id: "item_1", ok: false });
    expect(evs.find((e) => e.t === "denied")).toMatchObject({ tool: "mcp__builder__project_errors" });
  });

  it("a resumed turn keeps the thread id", () => {
    const p = new CodexStreamParser("/tmp/harness-rec/cx");
    run(p, "codex/resume.jsonl");
    expect(p.threadId).toBe("01a16cce-d4af-7991-a2ce-bf16f820cdee");
  });

  it("turn.failed sets the failure", () => {
    const p = new CodexStreamParser();
    const evs = run(p, "codex/failed.jsonl");
    expect(p.failed).toBe("boom");
    expect(evs.filter((e) => e.t === "error")).toHaveLength(2);
  });
});

describe("openclaw envelope", () => {
  it("reads the real runtime-missing error envelope", () => {
    const env = parseOpenClawEnvelope(text("openclaw/error-runtime-missing.json"))!;
    expect(env.ok).toBe(false);
    expect(env.sessionId).toBe("77bc746e-9e8e-4cc3-8a29-ce9e64d57aa7");
    expect(isOpenClawSetupError(env.error?.message)).toBe(true);
    expect(openClawEvents(env).map((e) => e.t)).toEqual(["session", "error"]);
  });

  it("reads an ok envelope after log noise", () => {
    const env = parseOpenClawEnvelope(`[openclaw] starting\n${text("openclaw/ok-synthetic.json")}`)!;
    expect(env.ok).toBe(true);
    expect(env.final).toBe("Changed the heading to Hello Acme.");
    expect(env.usage).toEqual({ input: 12000, output: 340, cacheRead: 0, cacheWrite: 0 });
    expect(env.costUsd).toBe(0.0123);
    expect(openClawEvents(env).map((e) => e.t)).toEqual(["session", "text", "usage"]);
  });

  it("no envelope is null", () => {
    expect(parseOpenClawEnvelope("crashed")).toBeNull();
  });
});
