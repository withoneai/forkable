import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import { cleanEnv } from "../../agents.js";
import type { Ctx, DetectedCli, Writer, WriterCompletion } from "../../contract.js";
import { ledger } from "../../ledger.js";

/** Runs a CLI tool-less with a hard timeout; `stdin` carries the prompt when the CLI reads it there. */
function exec(bin: string, args: string[], stdin?: string): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 8e6, cwd: os.tmpdir(), env: cleanEnv(), killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr ?? "").trim().split(/\r?\n/).pop() ?? "";
        reject(new Error(`${err.message}${detail ? `: ${detail}` : ""}`.slice(0, 500)));
        return;
      }
      resolve({ stdout: String(stdout) });
    });
    if (child.stdin) {
      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    }
  });
}

// The local engine: the coding agent already installed on this machine, run
// headless and tool-less. Drafts cost nothing extra on the user's own
// subscription. Never a bypass-permissions flag: the writer has no tools, so
// an email that says "run this command" has nothing to run.

export const TIMEOUT_MS = 120_000;

/** Draft model and the cheaper model for summaries, per CLI. "default" means: let the CLI choose. */
export const LOCAL_MODELS: Record<DetectedCli["id"], { draft: string; fast: string }> = {
  "claude-code": { draft: "sonnet", fast: "haiku" },
  codex: { draft: "default", fast: "default" },
  "gemini-cli": { draft: "default", fast: "default" },
};

interface RunResult { text: string; costUsd: number | null; model: string }

async function runClaude(bin: string, model: string, system: string, user: string): Promise<RunResult> {
  const args = ["-p", "--tools", "", "--output-format", "json", "--system-prompt", system];
  if (model !== "default") args.splice(1, 0, "--model", model);
  const { stdout } = await exec(bin, args, user);
  const out = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number; model?: string; modelUsage?: Record<string, unknown> };
  if (out.is_error) throw new Error(`Claude Code answered with an error: ${String(out.result ?? "").slice(0, 200)}`);
  const usedModel = out.modelUsage ? Object.keys(out.modelUsage)[0] : undefined;
  return { text: out.result ?? "", costUsd: typeof out.total_cost_usd === "number" ? out.total_cost_usd : null, model: usedModel ?? model };
}

interface ResultLine { result?: string; is_error?: boolean; total_cost_usd?: number; modelUsage?: Record<string, unknown> }

/** Same contract as runClaude, but reads the NDJSON stream line by line and hands text deltas to `onDelta` as they arrive. Still tool-less, still no bypass flag. */
async function runClaudeStream(bin: string, model: string, system: string, user: string, onDelta: (text: string) => void): Promise<RunResult> {
  const args = ["-p", "--tools", "", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--system-prompt", system];
  if (model !== "default") args.splice(1, 0, "--model", model);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { timeout: TIMEOUT_MS, cwd: os.tmpdir(), env: cleanEnv(), killSignal: "SIGKILL" });
    let resultLine: ResultLine | null = null;
    let stderrBuf = "";
    let settled = false;
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim().startsWith("{")) return;
      let ev: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } } & ResultLine;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta" && typeof ev.event.delta.text === "string") {
        onDelta(ev.event.delta.text);
      } else if (ev.type === "result") {
        resultLine = ev;
      }
    });
    child.stderr?.on("data", (d) => { stderrBuf += String(d); });
    child.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      if (!resultLine) {
        const detail = stderrBuf.trim().split(/\r?\n/).pop() ?? "";
        reject(new Error(`Claude Code exited with no result${detail ? `: ${detail}` : ""}`.slice(0, 500)));
        return;
      }
      const r = resultLine as ResultLine;
      if (r.is_error) {
        reject(new Error(`Claude Code answered with an error: ${String(r.result ?? "").slice(0, 200)}`));
        return;
      }
      const usedModel = r.modelUsage ? Object.keys(r.modelUsage)[0] : undefined;
      resolve({ text: r.result ?? "", costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null, model: usedModel ?? model });
    });
    child.stdin?.end(user);
  });
}

async function runCodex(bin: string, model: string, system: string, user: string): Promise<RunResult> {
  const prompt = `${system}\n\n---\n\n${user}`;
  const args = ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (model !== "default") args.push("-m", model);
  args.push(prompt);
  const { stdout } = await exec(bin, args);
  let last: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; msg?: { type?: string; message?: string } };
      if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") last = ev.item.text;
      else if (ev.msg?.type === "agent_message" && typeof ev.msg.message === "string") last = ev.msg.message;
    } catch {
      // not JSON: ignore
    }
  }
  if (last === null) throw new Error("Codex produced no agent message");
  return { text: last, costUsd: null, model };
}

async function runGemini(bin: string, model: string, system: string, user: string): Promise<RunResult> {
  const prompt = `${system}\n\n---\n\n${user}`;
  const args = ["-p", prompt, "--output-format", "json"];
  if (model !== "default") args.push("--model", model);
  const { stdout } = await exec(bin, args);
  const out = JSON.parse(stdout) as { response?: string };
  if (typeof out.response !== "string") throw new Error("Gemini CLI produced no response");
  return { text: out.response, costUsd: null, model };
}

export function localWriter(cli: { id: DetectedCli["id"]; bin: string }, model?: string): Writer {
  const draftModel = model ?? LOCAL_MODELS[cli.id].draft;
  return {
    engine: "local",
    provider: cli.id,
    model: draftModel,
    async complete(ctx: Ctx, input): Promise<WriterCompletion> {
      const started = Date.now();
      const w = this;
      let res: RunResult | null = null;
      let error: unknown = null;
      try {
        if (cli.id === "claude-code") {
          res = input.stream
            ? await runClaudeStream(cli.bin, w.model, input.system, input.user, input.stream)
            : await runClaude(cli.bin, w.model, input.system, input.user);
        } else if (cli.id === "codex") res = await runCodex(cli.bin, w.model, input.system, input.user);
        else res = await runGemini(cli.bin, w.model, input.system, input.user);
      } catch (e) {
        error = e;
      }
      const ms = Date.now() - started;
      const row = await ledger.record(ctx.db, {
        mailboxId: ctx.mailbox.id,
        userId: ctx.user.id,
        platform: cli.id,
        action: input.json ? "complete-json" : "complete",
        method: "EXEC",
        path: cli.bin,
        mode: "local",
        level: "read",
        status: error ? 0 : 200,
        ok: !error,
        blockedByGrant: false,
        refusal: null,
        engine: "local",
        model: res?.model ?? w.model,
        ms,
        summary: input.summary,
        note: error ? String((error as Error).message ?? error).split("\n")[0]!.slice(0, 300) : null,
        costUsd: res?.costUsd ?? null,
      });
      try {
        ctx.emit({ type: "ledger", row });
      } catch {
        // closed stream
      }
      if (error || !res) throw error ?? new Error("local writer failed");
      return { text: res.text, model: res.model, costUsd: res.costUsd, ms };
    },
  };
}
