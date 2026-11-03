// Smoke check://   pnpm exec tsx server/scripts/smoke-one.ts
// No network, no keys, no One CLI run: Builder's One CLI status (missing,
// signed out, signed in) on a fake runner, no Builder-level Connect app, the
// builder MCP server's tools listed and called through an MCP client,
// one_add_action writing a wrapper that passes tsc in a scratch project, the
// /scopes shape, then a project on the sample Connect template: the app's
// Sign in with One against the sample One (state bound through the dev
// token, PKCE), the dev gate's outcomes (local, held, allowed) and the sample
// One's own `declined, 403` reported back as a Sample receipt, no execute
// tool, and the `one` shim refusing. Exits 0 when every check passes.

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { eq } from "drizzle-orm";
import { BRAND, createPlatform, env, GEN_FILE, ONE_REFUSAL, PREVIEW_CALLBACK, schema, type OneRunner, type Platform, type ScopesResponse, linkScratchTemplateCache } from "@builder/core";
import { createApp } from "../src/app.js";
import { createHub } from "../src/hub.js";

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const DELETE_MSG = "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA";
const PROFILE = "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `   (${detail})` : ""}`);
  if (!ok) failures++;
};

// Any request off this machine fails the smoke.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error(`smoke-one: refused a request to ${url.hostname}`);
  return realFetch(input, init);
}) as typeof fetch;

const scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-smoke-one-`));
linkScratchTemplateCache(scratch);

async function cliStatus(): Promise<void> {
  // A fake `one` on a fake path: Builder shells out and reads --version and --agent whoami, nothing else.
  let whoami: "signed-in" | "signed-out" = "signed-out";
  const ran: { args: string[]; builderEnv: string[] }[] = [];
  const runner: OneRunner = async (_bin, args, o) => {
    ran.push({ args, builderEnv: Object.keys(o.env).filter((k) => k.startsWith(env(""))) });
    if (args[0] === "--version") return { code: 0, stdout: "2.9.2\n", stderr: "" };
    if (args.join(" ") === "--agent whoami") return whoami === "signed-in" ? { code: 0, stdout: JSON.stringify({ user: { name: "Avery Chen", email: "Avery@acme.example" } }), stderr: "" } : { code: 1, stdout: JSON.stringify({ error: "Not signed in" }), stderr: "" };
    return { code: 1, stdout: "", stderr: "not in this smoke" };
  };
  let bin: string | null = null;
  const p = await createPlatform({ home: scratch, preview: false, grant: "builder", cli: { runner, resolve: async () => bin } });
  try {
    const app = createApp({ platform: p, hub: createHub(), detect: async () => [], log: () => {} });
    const get = async (path: string) => (await app.request(path)).json() as Promise<Record<string, unknown>>;
    const missing = (await get("/api/one/cli?force=1")) as { cli: { installed: boolean; installHint: string; error: string | null } };
    check("no One CLI: not installed, with the install hint", !missing.cli.installed && missing.cli.installHint === "npm install -g @withone/cli" && /not installed/.test(missing.cli.error ?? ""));
    bin = "/opt/fake/bin/one";
    const out = (await (await app.request("/api/one/cli/refresh", { method: "POST" })).json()) as { cli: { installed: boolean; version: string | null; signedIn: boolean; path: string | null } };
    check("CLI found, version read, signed out", out.cli.installed && out.cli.version === "2.9.2" && !out.cli.signedIn && out.cli.path === bin);
    const me0 = (await get("/api/me")) as { me: unknown; grant: unknown };
    check("/api/me is nobody while the CLI is signed out", me0.me === null && me0.grant === null);
    whoami = "signed-in";
    const me1 = (await (await app.request("/api/one/cli/refresh", { method: "POST" })).json()) as { cli: { signedIn: boolean; account: { name: string; email: string } | null } };
    check("signed in: the CLI's own account", me1.cli.signedIn && me1.cli.account?.name === "Avery Chen" && me1.cli.account.email === "avery@acme.example");
    const me2 = (await get("/api/me")) as { me: { name: string } | null; grant: string | null; connectApp?: unknown; signInUrl?: unknown };
    check("/api/me names the builder from the CLI, grant one", me2.me?.name === "Avery Chen" && me2.grant === "one");
    check("no Builder-level Connect app: nothing in /api/me, no /api/one/authorize", me2.connectApp === undefined && me2.signInUrl === undefined && (await app.request("/api/one/authorize")).status === 404);
    check("Builder ran only --version and --agent whoami", ran.every((r) => r.args[0] === "--version" || r.args.join(" ") === "--agent whoami"), [...new Set(ran.map((r) => r.args.join(" ")))].join(", "));
    check("the CLI gets none of Builder's own env", ran.every((r) => r.builderEnv.length === 0), ran.flatMap((r) => r.builderEnv).join(", "));
  } finally {
    await p.stop();
  }
}

async function tools(): Promise<void> {
  const p: Platform = await createPlatform({ home: scratch, preview: false, grant: "sample" });
  const app = createApp({ platform: p, hub: createHub(), detect: async () => [], log: () => {} });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let mcp: Client | null = null;
  try {
    const { row } = await p.workspace.create({ name: "smoke-one", harness: "replay", model: "demo", permission: "build", autoFix: false });
    const tok = p.turns.mintToken(row.id);

    // MCP over stdio, exactly as a harness starts it.
    mcp = new Client({ name: "smoke-one", version: "0.0.0" });
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [p.shims.mcp], env: { [env("API")]: api, [env("TURN_TOKEN")]: tok.token, PATH: process.env.PATH ?? "" } }));
    const listed = (await mcp.listTools()).tools.map((t) => t.name);
    const want = ["one_find_actions", "one_load_action", "one_platforms", "one_granted", "one_add_action", "one_remove_action", "one_scope_preview", "project_errors", "project_add_dependency", "project_screenshot", "project_env"];
    check("MCP lists the one_* and project_* tools", want.every((w) => listed.includes(w)), listed.join(", "));
    check("no tool can execute an action", !listed.some((n) => /exec|run_action|call_action|passthrough/i.test(n)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await mcp!.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
    };
    const find = await call("one_find_actions", { platform: "gmail", intent: "list my latest email threads" });
    check("one_find_actions answers from the catalog", !find.isError && find.text.includes(GET_THREADS) && find.text.includes("List and View Email Threads"));
    const load = await call("one_load_action", { actionId: SEND, section: "Request Body" });
    check("one_load_action reads a section of the docs", !load.isError && /Send Email/.test(load.text) && /to/.test(load.text));
    const granted = await call("one_granted");
    check("one_granted names the keyless sample One", /keyless sample One/.test(granted.text));
    const platforms = await call("one_platforms", { query: "mail" });
    check("one_platforms lists platforms", platforms.text.includes("gmail"));
    const bad = await call("one_load_action", { actionId: "conn_mod_def::nope::nope" });
    check("an unknown id is an error, not a guess", bad.isError);
    for (const id of [GET_THREADS, SEND, DELETE_MSG, PROFILE]) {
      const added = await call("one_add_action", { actionId: id });
      if (added.isError) check(`one_add_action ${id}`, false, added.text.slice(0, 200));
    }
    const gen = readFileSync(join(row.path, GEN_FILE), "utf8");
    check("one_add_action writes typed wrappers", gen.includes("listAndViewEmailThreads: action<GmailListAndViewEmailThreadsInput") && gen.includes("sendEmail: action<GmailSendEmailInput"));
    const actionsJson = JSON.parse(readFileSync(join(row.path, BRAND.projectDir, "actions.json"), "utf8")) as { actionId: string }[];
    check(".builder/actions.json lists the four actions", actionsJson.length === 4);

    // Call sites, then tsc in the real scaffolded project (template node_modules).
    writeFileSync(
      join(row.path, "server", "mail.ts"),
      `import { Hono } from "hono";
import type { AppEnv } from "./env";
import { one, requireUser } from "./one";
import { gmail } from "./one/actions.gen";

export const mail = new Hono<AppEnv>();
mail.get("/threads", async (c) => {
  await requireUser(c);
  const r = await one(c).run(gmail.listAndViewEmailThreads, { body: { numberOfThreads: 5 } });
  if (!r.ok) return c.json(r, r.status as 403);
  return c.json({ subjects: (r.data.threads ?? []).map((t) => t.messages?.[0]?.subject ?? "") });
});
mail.post("/send", async (c) => {
  await requireUser(c);
  const r = await one(c).run(gmail.sendEmail, { body: { to: "priya@globex.example", subject: "Hello", body: "Hi from Acme Inc" } });
  return c.json(r, r.status as 200);
});
mail.delete("/:id", async (c) => {
  await requireUser(c);
  const r = await one(c).run(gmail.permanentlyDeleteGmailMessage, { pathParams: { userId: "me", id: c.req.param("id") } });
  return c.json(r, r.status as 200);
});
`,
    );
    const tsc = spawnSync(process.execPath, [join(row.path, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", row.path, "--pretty", "false"], { encoding: "utf8" });
    check("the generated wrappers and their call sites pass tsc --noEmit", tsc.status === 0, (tsc.stdout + tsc.stderr).trim().split("\n")[0] ?? "");

    const preview = await call("one_scope_preview");
    check("one_scope_preview reads the manifest from the code", preview.text.includes("Gmail · get threads (read)") && preview.text.includes("Gmail · send (write)") && preview.text.includes("Gmail · delete (delete)"), preview.text.split("\n").slice(0, 4).join(" | "));

    // The /scopes route.
    const scopes = (await (await app.request(`/api/projects/${row.id}/scopes`)).json()) as ScopesResponse;
    check(
      "/scopes has manifest, ask, call sites, warnings, platforms",
      scopes.manifest.actions.length === 3 &&
        scopes.manifest.unused.length === 1 &&
        scopes.ask.connectorRules.length === 1 &&
        scopes.ask.connectorRules[0]!.connectionDefinitionId === "conn_def::19QDvh" &&
        scopes.callSites.length === 3 &&
        scopes.warnings.some((w) => w.actionId === PROFILE && /loose/.test(w.message)) &&
        scopes.platforms.gmail?.name === "Gmail" &&
        "committed" in scopes &&
        "diff" in scopes,
      `${scopes.manifest.actions.length} actions, ${scopes.ask.connectorRules[0]?.actionIds.length} in the ask`,
    );

    // The dev gate, on the project's dev token: what the app's dev client asks before each call and reports after.
    const devToken = p.workspace.devToken(row);
    const dev = (path: string, body: Record<string, unknown>, token = devToken) =>
      realFetch(`${api}/api/dev/${row.id}/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
    const kn = (id: string) => p.catalog.cached(id)!;
    const act = (id: string) => ({ platform: "gmail", actionId: id, method: kn(id).method, path: kn(id).path, title: kn(id).title });
    check("the dev gate refuses a bad token", (await dev("check", act(SEND), "wrong-token")).status === 401);
    const allowed = await dev("check", act(GET_THREADS));
    check("a manifest read is allowed, labeled Sample", allowed.status === 200 && allowed.body.allow === true && allowed.body.level === "read" && allowed.body.source === "sample");
    const local = await dev("check", act(PROFILE));
    const lb = local.body.body as Record<string, unknown> | undefined;
    check("outside the manifest: local 403, blockedByManifest", local.status === 403 && local.body.allow === false && lb?.source === "local" && lb?.blockedByManifest === true && lb?.blockedByGrant === false);

    // One Connect off: the preview has no One login and no One calls.
    check("One Connect starts off", JSON.stringify(await p.connect.previewEnv(row.id)) === JSON.stringify({ ONE_MODE: "off" }));
    const offTool = await call("one_granted");
    check("one_granted says One Connect is off", /One Connect is off/.test(offTool.text));
    // Turn it on with the sample template, as the demo does.
    const sample = (await p.connect.list("template")).find((t) => t.sample);
    check("the sample Connect template exists and is configured", !!sample && p.env.setupConfigured(sample.id), sample?.name);
    const on = await p.connect.apply(row, { use: "template", setupId: sample!.id });
    check("the project links the sample template, One Connect on", on.enabled && on.via === "template");
    const penv = await p.connect.previewEnv(row.id);
    check("the preview gets the shared callback and the sample One's address", penv.ONE_MODE === "connect" && penv.ONE_REDIRECT_URI === PREVIEW_CALLBACK && /\/api\/stub-one$/.test(penv.ONE_API_URL ?? "") && penv[env("ONE_SAMPLE")] === "1");
    check("one_granted says One Connect is on", /One Connect is on/.test((await call("one_granted")).text));

    // The app's Sign in with One against the sample One: bind the state, authorize with PKCE, exchange once.
    const state = randomBytes(18).toString("base64url");
    check("binding a sign-in state needs the dev token", (await dev("oauth-state", { state }, "wrong-token")).status === 401);
    check("the app binds its sign-in state", (await dev("oauth-state", { state })).status === 200);
    const verifier = randomBytes(32).toString("base64url");
    const authUrl = new URL(`${api}/api/stub-one/oauth/authorize`);
    for (const [k, v] of Object.entries({ client_id: penv.ONE_CLIENT_ID!, redirect_uri: penv.ONE_REDIRECT_URI!, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state })) authUrl.searchParams.set(k, v);
    const auth = await realFetch(authUrl, { redirect: "manual" });
    const back = new URL(auth.headers.get("location") ?? "http://x/");
    check("the sample One sends the browser to the shared callback", auth.status === 302 && `${back.origin}${back.pathname}` === PREVIEW_CALLBACK && back.searchParams.get("state") === state);
    const pending = p.connect.takeState(back.searchParams.get("state"));
    check("the shared callback knows which preview started it", pending?.projectId === row.id && pending.label === row.slug);
    const tokenRes = await realFetch(`${api}/api/stub-one/oauth/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${penv.ONE_CLIENT_ID}:${penv.ONE_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", redirect_uri: PREVIEW_CALLBACK, code_verifier: verifier }) });
    const tok1 = (await tokenRes.json()) as { connect_user_id?: string };
    check("the code exchange gives the app its connect user", tokenRes.status === 200 && /^cu_[0-9a-f]{64}$/.test(tok1.connect_user_id ?? ""));
    const oneCall = (path: string, method: string, actionId: string, body?: unknown) =>
      realFetch(`${api}/api/stub-one/v1/${path}`, { method, headers: { "x-one-secret": penv.ONE_CONNECT_KEY!, "x-one-connect-user-id": tok1.connect_user_id ?? "", "x-one-action-id": actionId, "x-one-connection-key": "sample::gmail::acme", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const who = (await (await oneCall("users/whoami", "GET", "")).json()) as { user?: { name: string } };
    check("whoami on the app's own grant names the developer", who.user?.name === "Avery Chen");
    // A read the gate allowed, then One's own refusal of a delete, reported back.
    const threads = await oneCall("passthrough/gmail/v1/users/me/threads", "POST", GET_THREADS, { numberOfThreads: 3 });
    check("the app's read runs on the sample One", threads.status === 200);
    await dev("report", { ...act(GET_THREADS), status: threads.status, ok: threads.ok, ms: 3 });
    const delCheck = await dev("check", act(DELETE_MSG));
    check("the gate lets a manifest delete go to One", delCheck.status === 200 && delCheck.body.allow === true);
    const del = await oneCall("passthrough/gmail/v1/users/me/messages/x", "DELETE", DELETE_MSG);
    const delBody = (await del.json()) as { correlationId?: string };
    check("the sample One refuses the delete as One does: 403 with a correlationId", del.status === 403 && /^sample-/.test(delBody.correlationId ?? ""));
    await dev("report", { ...act(DELETE_MSG), status: 403, ok: false, blockedByGrant: true, ms: 4 });
    await p.database.db.insert(schema.turns).values({ id: "t_smoke_running", projectId: row.id, kind: "user", prompt: "running", harness: "replay", status: "running" });
    const held = await dev("check", act(SEND));
    const readWhileRunning = await dev("check", act(GET_THREADS));
    await p.database.db.update(schema.turns).set({ status: "done" }).where(eq(schema.turns.id, "t_smoke_running"));
    check("a write during a turn is held (423)", held.status === 423 && (held.body.body as { source?: string } | undefined)?.source === "held");
    check("a read during a turn is still allowed", readWhileRunning.status === 200);
    const after = await dev("check", act(SEND));
    check("the write is allowed once the turn ends", after.status === 200 && after.body.allow === true);

    // Activity and receipts, and the Access tests.
    const activity = (await (await app.request(`/api/projects/${row.id}/activity`)).json()) as { rows: { source: string }[]; receipts: { line: string; badge: string; source: string }[] };
    check("Activity has rows by source", ["local", "held", "sample", "platform"].every((s) => activity.rows.some((r) => r.source === s)), [...new Set(activity.rows.map((r) => r.source))].join(", "));
    const localReceipt = activity.receipts.find((r) => r.source === "local");
    check("a Local receipt never reads declined, 403", !!localReceipt && !localReceipt.line.includes("declined, 403") && localReceipt.badge === "Local", localReceipt?.line);
    const oneReceipt = activity.receipts.find((r) => r.source === "sample");
    check("the sample One's refusal is the receipt, labeled Sample", oneReceipt?.line === "Gmail · delete   declined, 403" && oneReceipt.badge === "Sample", oneReceipt?.line);
    const tl = (await (await app.request(`/api/projects/${row.id}/access/test-local`, { method: "POST", body: JSON.stringify({ platform: "gmail" }), headers: { "content-type": "application/json" } })).json()) as { receipt: { line: string; badge: string } | null };
    const t1 = (await (await app.request(`/api/projects/${row.id}/access/test-one`, { method: "POST", body: JSON.stringify({ platform: "gmail" }), headers: { "content-type": "application/json" } })).json()) as { receipt: { line: string; badge: string } | null; note: string | null };
    check("Test a refusal, local", tl.receipt?.badge === "Local" && /held locally/.test(tl.receipt.line), tl.receipt?.line);
    check("Test a refusal, Ask One (Sample on the stub grant)", t1.receipt?.badge === "Sample" && t1.receipt.line.endsWith("declined, 403"), t1.receipt?.line ?? t1.note ?? "");

    // Catalog over the builder-one shim route, and the token rule.
    // Async: the server answering the shim runs in this process.
    const viaShim = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn(join(p.shims.dir, `${BRAND.slug}-one`), ["find", "gmail", "send", "an", "email"], { env: { ...process.env, [env("API")]: api, [env("TURN_TOKEN")]: tok.token } });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("close", (status) => resolve({ status, stdout }));
    });
    check(`${BRAND.slug}-one find works on the turn token`, viaShim.status === 0 && viaShim.stdout.includes(SEND));
    const noTok = await realFetch(`${api}/api/catalog/find`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "gmail", intent: "send" }) });
    check("the catalog refuses without a turn token", noTok.status === 401);
    const execRoute = await realFetch(`${api}/api/catalog/execute`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok.token}` }, body: "{}" });
    check("there is no execute route", execRoute.status === 404);
    tok.revoke();

    // The `one` shim refuses every subcommand.
    const shim = spawnSync(join(p.shims.dir, "one"), ["--agent", "actions", "execute", "gmail", "x", "y"], { encoding: "utf8", env: { ...process.env, [env("AGENT")]: "1" } });
    check("the one shim exits 1 with the refusal", shim.status === 1 && shim.stderr.includes(ONE_REFUSAL), shim.stderr.trim());
  } finally {
    await mcp?.close().catch(() => {});
    server.close();
    await p.stop();
  }
}

try {
  await cliStatus();
  await tools();
} catch (err) {
  check("smoke ran to the end", false, (err as Error).stack ?? String(err));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
