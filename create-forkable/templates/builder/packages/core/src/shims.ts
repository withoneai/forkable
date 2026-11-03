// Adapted from earlier One Systems code (MIT).
// Copyright (c) 2026 One Systems, Inc.
// Portions Copyright (c) 2025 Paperclip AI (forked). See LICENSES/harness-MIT.txt.
//
// The PostToolUse steer hook, and PATH shims in front of real binaries.
// The shims dir is first on every harness PATH. Tool guards
// refuse dev servers, installs and wrangler when BUILDER_AGENT=1 and exec the
// real binary otherwise; `one` refuses every subcommand; `builder-one` and
// `mcp.mjs` reach the local server with the turn token.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND, env, SERVER_ORIGIN } from "./brand.js";

const AGENT = env("AGENT");

export const PREVIEW_REFUSAL = `The preview runs inside ${BRAND.name}. Use project_add_dependency to add a package.`;
export const ONE_REFUSAL = `The One CLI belongs to the builder, and nothing in a build executes a platform action. Platform calls run in the app through server/one, on each person's grant to the app's own Connect app. Read One's catalog with the one_* tools or ${BRAND.slug}-one find|load|platforms.`;

/** Find the real binary on PATH, skipping the shims dir. */
const REAL = (name: string, shims: string) => `
real=""
IFS=:
for d in $PATH; do
  [ "$d" = "${shims}" ] && continue
  if [ -x "$d/${name}" ] && [ ! -d "$d/${name}" ]; then real="$d/${name}"; break; fi
done
unset IFS
if [ -z "$real" ]; then echo "${name}: not found" >&2; exit 127; fi
exec "$real" "$@"
`;

const refuse = `refuse() { echo "${PREVIEW_REFUSAL}" >&2; exit 1; }`;

function guard(name: string, rules: string, shims: string): string {
  return `#!/bin/sh
# ${BRAND.name} guard for ${name}. Generated; edits are overwritten at boot.
${refuse}
if [ "$${AGENT}" = "1" ]; then
${rules}
fi
${REAL(name, shims)}`;
}

const PM_RULES = `  case "$1" in
    dev|start|serve|preview|install|i|add|ci|update|up|upgrade) refuse ;;
    run|run-script) case "$2" in dev|start|serve|preview) refuse ;; esac ;;
    exec|dlx|x) case "$2" in vite|wrangler) refuse ;; esac ;;
  esac`;

const NPX_RULES = `  for a in "$@"; do
    case "$a" in -*) continue ;; vite|vite@*|wrangler|wrangler@*|@withone/*) refuse ;; *) break ;; esac
  done`;

const VITE_RULES = `  case "$1" in
    build|optimize) ;;
    *) refuse ;;
  esac`;

const WRANGLER_RULES = `  case "$1" in
    types|--version|-v) ;;
    *) refuse ;;
  esac`;

const ONE = `#!/bin/sh
# ${BRAND.name}: the One CLI is the builder's, not the coding agent's. The one_* tools read its catalog.
echo "${ONE_REFUSAL}" >&2
exit 1
`;

/** builder-one: the same one_* tools over the turn token, for OpenClaw and any shell. */
const BUILDER_ONE = `#!/usr/bin/env node
// ${BRAND.name} catalog shim. Read-only: find, load, add, granted, scopes.
const api = process.env.${env("API")} || ${JSON.stringify(SERVER_ORIGIN)};
const token = process.env.${env("TURN_TOKEN")} || "";
const [cmd, ...rest] = process.argv.slice(2);
const routes = { find: "find", load: "load", add: "add", remove: "remove", granted: "granted", scopes: "scopes", platforms: "platforms" };
if (!cmd || !routes[cmd]) {
  console.error("Usage: ${BRAND.slug}-one find <platform> <intent> | load <actionId> [section] | add <actionId> | remove <actionId> | platforms [query] | granted | scopes");
  process.exit(2);
}
const body = cmd === "find" ? { platform: rest[0], intent: rest.slice(1).join(" ") } : cmd === "load" || cmd === "add" || cmd === "remove" ? { actionId: rest[0], section: rest.slice(1).join(" ") || undefined } : cmd === "platforms" ? { query: rest.join(" ") || undefined } : {};
fetch(api + "/api/catalog/" + routes[cmd], { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) })
  .then(async (r) => {
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { text }; }
    if (!r.ok) { console.error((j.error && j.error.message) || text); process.exit(1); }
    console.log(typeof j.markdown === "string" ? j.markdown : JSON.stringify(j, null, 2));
  })
  .catch((e) => { console.error("${BRAND.name} is not reachable: " + e.message); process.exit(1); });
`;

/** PostToolUse hook: ask the server for a queued steer message and hand it to Claude. */
const STEER_HOOK = `#!/usr/bin/env node
// ${BRAND.name} steer hook. Fails open.
const api = process.env.${env("API")} || ${JSON.stringify(SERVER_ORIGIN)};
const token = process.env.${env("TURN_TOKEN")} || "";
const turn = process.env.${env("TURN_ID")} || "";
function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    const t = setTimeout(() => resolve(buf), 1500);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => { clearTimeout(t); resolve(buf); });
    process.stdin.on("error", () => { clearTimeout(t); resolve(buf); });
  });
}
(async () => {
  try {
    if (!turn || !token) return;
    const raw = await readStdin();
    try { const p = JSON.parse(raw); if (p && p.agent_id) return; } catch {}
    const r = await fetch(api + "/api/turns/" + turn + "/steer", { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return;
    const b = await r.json();
    if (!b || typeof b.text !== "string" || !b.text) return;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "The builder sent a message while you work:\\n" + b.text } }) + "\\n");
  } catch {}
})();
`;

/** The `builder` MCP server (stdio, newline-delimited JSON-RPC): one_* (read-only catalog, install) and project_*. No execute tool. */
const MCP = `#!/usr/bin/env node
// ${BRAND.name} MCP server. Calls the local server with the turn token.
// There is no execute tool, by design.
import { createInterface } from "node:readline";
const api = process.env.${env("API")} || ${JSON.stringify(SERVER_ORIGIN)};
const token = process.env.${env("TURN_TOKEN")} || "";
const TOOLS = [
  { name: "one_find_actions", description: "Search One's catalog for the actions a feature needs (through the builder's One CLI). Returns the best matches with ids, methods and a digest of the top pick. Read-only. Use before every platform call: never guess an action id.", inputSchema: { type: "object", properties: { platform: { type: "string", description: "Platform slug: gmail, slack, google-calendar, stripe, notion, hubspot. one_platforms lists them." }, intent: { type: "string", description: "What the app should do, in words: list my latest email threads" } }, required: ["platform", "intent"], additionalProperties: false } },
  { name: "one_load_action", description: "Read one action's docs from One's catalog: method, path, every field, response, gotchas. Optional section name (Response, Optional, Gotchas) for one part.", inputSchema: { type: "object", properties: { actionId: { type: "string" }, section: { type: "string" } }, required: ["actionId"], additionalProperties: false } },
  { name: "one_platforms", description: "List One's platforms (slug, name, category). Optional query narrows it.", inputSchema: { type: "object", properties: { query: { type: "string" } }, additionalProperties: false } },
  { name: "one_granted", description: "Whether One Connect is on for this app (its own Connect app, Sign in with One in preview). Off: every one(c).run returns a local refusal until the builder turns it on.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "one_add_action", description: "Install an action in this app: adds it to .builder/actions.json, regenerates the typed wrapper in server/one/actions.gen.ts, and returns the wrapper name, its TypeScript input type and the docs. Call it before writing one(c).run.", inputSchema: { type: "object", properties: { actionId: { type: "string", description: "conn_mod_def::... from one_find_actions" } }, required: ["actionId"], additionalProperties: false } },
  { name: "one_remove_action", description: "Uninstall an action and regenerate actions.gen.ts. Remove its call sites too.", inputSchema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"], additionalProperties: false } },
  { name: "one_scope_preview", description: "The manifest the current code would ask users to grant (every literal wrapper passed to one(c).run), with any BLD manifest errors.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "project_errors", description: "Open errors in this project: build, types, runtime, network, server, manifest. Each has source, file:line and message.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "project_add_dependency", description: "Add an npm package to this project. The platform edits package.json and runs the install, then returns the log tail. Never run installs yourself.", inputSchema: { type: "object", properties: { name: { type: "string", description: "Package name, optionally with a version: zod or zod@^4" }, dev: { type: "boolean" } }, required: ["name"], additionalProperties: false } },
  { name: "project_env", description: "Environment variables this app reads (process.env.X, c.env.X): each name and whether the builder has set it. Values never reach you. To ask for one, pass request: [{name, why}]; the builder gets a card with a secure input at the end of the turn. Never ask for a value in chat.", inputSchema: { type: "object", properties: { request: { type: "array", items: { type: "object", properties: { name: { type: "string", description: "STRIPE_SECRET_KEY" }, why: { type: "string", description: "One sentence: what the app does with it and where the builder gets it." } }, required: ["name", "why"], additionalProperties: false } } }, additionalProperties: false } },
  { name: "project_screenshot", description: "Load the preview headless and save a screenshot. Returns the image path (read it with your file tool) and any errors seen.", inputSchema: { type: "object", properties: { path: { type: "string", description: "URL path, default /" } }, additionalProperties: false } },
];
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
async function call(name, args) {
  const r = await fetch(api + "/api/mcp/" + name, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(args || {}) });
  const text = await r.text();
  return { text, isError: !r.ok };
}
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;
  try {
    if (method === "initialize") send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "${BRAND.slug}", version: "0.1.0" } } });
    else if (method === "tools/list") send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    else if (method === "tools/call") {
      const out = await call(params.name, params.arguments);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out.text }], isError: out.isError } });
    } else if (method === "ping") send({ jsonrpc: "2.0", id, result: {} });
    else send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "${BRAND.name} is not reachable: " + e.message }], isError: true } });
  }
});
`;

export interface ShimPaths {
  dir: string;
  steerHook: string;
  mcp: string;
}

/** Write every shim into BUILDER_HOME/shims (at boot). */
export function installShims(dir: string): ShimPaths {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    pnpm: guard("pnpm", PM_RULES, dir),
    npm: guard("npm", PM_RULES, dir),
    yarn: guard("yarn", PM_RULES, dir),
    bun: guard("bun", PM_RULES, dir),
    npx: guard("npx", NPX_RULES, dir),
    vite: guard("vite", VITE_RULES, dir),
    wrangler: guard("wrangler", WRANGLER_RULES, dir),
    one: ONE,
    [`${BRAND.slug}-one`]: BUILDER_ONE,
    "steer-hook.mjs": STEER_HOOK,
    "mcp.mjs": MCP,
  };
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, content);
    chmodSync(p, 0o755);
  }
  return { dir, steerHook: join(dir, "steer-hook.mjs"), mcp: join(dir, "mcp.mjs") };
}
