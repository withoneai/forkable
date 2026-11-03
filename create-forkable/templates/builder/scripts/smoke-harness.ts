// One real turn on an installed harness.
//   pnpm exec tsx scripts/smoke-harness.ts --harness claude-code|codex|openclaw
// Prints "skipped, not installed" and exits 0 when the CLI is missing.
// Otherwise: a scratch BUILDER_HOME, a project from the template, the turn
// "Change the heading to Hello Acme", then asserts a checkpoint with the four
// trailers, the guard refusing under the agent env, no tagged process left
// listening, and (Claude) the builder MCP server connected at init.

// Its own server ports (an editor may hold 51989 and 51990, the eval 51979
// and 51980). Core reads the ports at load, so this re-runs itself with them.
import { spawnSync as respawn } from "node:child_process";
if (!process.env.BUILDER_SMOKE_PORTS) {
  const r = respawn(process.execPath, ["--import", "tsx", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, BUILDER_SMOKE_PORTS: "1", BUILDER_SERVER_PORT: process.env.BUILDER_SERVER_PORT ?? "51949", BUILDER_PROXY_PORT: process.env.BUILDER_PROXY_PORT ?? "51950" },
  });
  process.exit(r.status ?? 1);
}
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAND, env, git, scanAgentProcesses, trailer, linkScratchTemplateCache } from "@builder/core";
import { startServer } from "@builder/server";
import { agentEnv, getHarness, isOpenClawSetupError } from "@builder/harness";
import type { HarnessId } from "@builder/harness/types";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const id = arg("harness", "claude-code") as HarnessId;
const model = process.argv.includes("--model") ? arg("model", "") : null;

async function main(): Promise<number> {
  const info = await getHarness(id).detect(true);
  if (!info.bin) {
    console.log(`${info.label}: skipped, not installed`);
    return 0;
  }
  console.log(`${info.label} ${info.version ?? ""} at ${info.bin}, signed in: ${info.signedIn}`);
  const scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-smoke-harness-`));
  linkScratchTemplateCache(scratch);
  const server = await startServer({ home: scratch, log: () => {} });
  const p = server.platform;
  const checks: [string, boolean, string?][] = [];
  let setupSkip = false;
  try {
    const { row } = await p.workspace.create({ name: `smoke-${id}`, harness: id, model, permission: "build", autoFix: false });
    const t0 = Date.now();
    const turn = await p.turns.submit(row, { prompt: "Change the heading to Hello Acme" });
    await p.turns.idle(row.id, 10 * 60_000);
    const ms = Date.now() - t0;
    const done = (await p.turns.get(turn.id))!;
    const events = (await p.turns.events(turn.id)).map((e) => e.event);
    console.log(`turn ${done.status} (${done.exit}) in ${(ms / 1000).toFixed(1)} s${done.error ? `: ${done.error}` : ""}`);
    if (id === "openclaw" && done.status !== "done" && isOpenClawSetupError(done.error ?? "")) {
      console.log(`OpenClaw: skipped, installed but its own runtime is not set up on this machine (OpenClaw says: ${done.error})`);
      setupSkip = true;
      return 0;
    }
    if (done.text) console.log(`agent: ${done.text.slice(0, 300).replace(/\s+/g, " ")}`);

    const app = readFileSync(join(row.path, "src", "App.tsx"), "utf8");
    checks.push(["heading changed", /Hello Acme/.test(app)]);
    const [head] = await git.log(row.path, 1);
    const want = [trailer("Turn"), trailer("Harness"), trailer("Session"), trailer("Kind")];
    checks.push([
      "checkpoint with four trailers",
      !!head && head.subject !== "Template" && want.every((k) => head.trailers[k]),
      head ? `${head.sha.slice(0, 7)} ${head.subject} | ${want.map((k) => `${k}=${head.trailers[k] ?? "-"}`).join(" ")}` : "no commit",
    ]);

    // The guard sees BUILDER_AGENT=1 in exactly the env the harness got.
    const agent = agentEnv({ projectId: row.id, turnId: turn.id, shimsDir: p.shims.dir });
    const guard = spawnSync(process.execPath, ["tools/guard-dev.mjs"], { cwd: row.path, env: agent, encoding: "utf8" });
    checks.push([`guard refuses with ${env("AGENT")}=1`, guard.status === 1 && /preview runs inside/i.test(guard.stderr + guard.stdout), (guard.stderr || guard.stdout).trim()]);
    const shim = spawnSync(join(p.shims.dir, "pnpm"), ["dev"], { cwd: row.path, env: agent, encoding: "utf8" });
    checks.push(["pnpm shim refuses dev", shim.status === 1, shim.stderr.trim()]);
    const one = spawnSync(join(p.shims.dir, "one"), ["actions", "execute"], { env: agent, encoding: "utf8" });
    checks.push(["one shim exits 1", one.status === 1]);

    const left = (await scanAgentProcesses(row.id)).filter((x) => x.ports.length);
    checks.push(["no tagged process left listening", left.length === 0, left.map((l) => `${l.pid} ${l.command} ${l.ports}`).join("; ")]);

    if (id === "claude-code") {
      const mcp = events.find((e) => e.t === "mcp");
      checks.push(["builder MCP connected at init", !!mcp && mcp.t === "mcp" && mcp.name === BRAND.slug && mcp.status === "connected", JSON.stringify(mcp ?? null)]);
      console.log("note: --setting-sources project,local skipping user hooks was verified with --include-hook-events (packages/harness/src/adapters/claude.ts header)");
    }
    const tools = events.filter((e) => e.t === "tool_start").map((e) => (e.t === "tool_start" ? `${e.name}${e.detail ? ` ${e.detail}` : ""}` : ""));
    console.log(`tools: ${tools.join(", ") || "none"}`);
    const denied = events.filter((e) => e.t === "denied");
    if (denied.length) console.log(`denied: ${denied.map((d) => (d.t === "denied" ? d.tool : "")).join(", ")}`);
    console.log(`usage: ${JSON.stringify(done.usage)}${done.costUsd != null ? `, $${done.costUsd.toFixed(4)} est.` : ""}`);
  } finally {
    await server.stop();
    if (!process.argv.includes("--keep")) rmSync(scratch, { recursive: true, force: true });
  }
  if (setupSkip) return 0;
  let ok = true;
  for (const [name, pass, detail] of checks) {
    ok &&= pass;
    console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
  }
  return ok ? 0 : 1;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
