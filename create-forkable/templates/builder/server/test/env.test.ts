// No route, event or log ever carries a stored value (CONTRACT 16).
//
// Seeds canary values through the real routes (a saved template, one
// project's own Connect app, and that project's Environment), then reads
// every editor route, the MCP tool the agent has, a live SSE stream, the
// server's log, the project's files and the agent's per-turn facts, and
// greps each for every canary and for the tail of every secret one. Also:
// the guards (Origin, Host, CSRF).

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND, createPlatform, PORTS, prompts, type Platform, type ProjectRow, type SecurityRunner, linkScratchTemplateCache } from "@builder/core";
import { createApp } from "../src/app.js";
import { CSRF_HEADER } from "../src/env.js";
import { createHub } from "../src/hub.js";

/** A template's Connect app (saved once, linked by projects). */
const CANARY = {
  ONE_CLIENT_ID: "client_CANARYid7Q2w",
  ONE_CLIENT_SECRET: "one_secret_CANARYsecret9Xk4Lm2Np8Rt",
  ONE_CONNECT_KEY: "sk_live_CANARYkey3Vb6Hn1Jd5",
};
/** One project's own Connect app ("New Connect app"). */
const OWN = {
  ONE_CLIENT_ID: "client_CANARYown5Tz1",
  ONE_CLIENT_SECRET: "one_secret_CANARYownsec4Qp7Wd2Zs6",
  ONE_CONNECT_KEY: "sk_live_CANARYownkey8Mc2Rf4",
  ONE_PERMISSION_SET: "ask_CANARYown_set",
};
const APP = { WEATHER_API_KEY: "wk_CANARYapp4Ff8Gg2Hh", APP_OWNER_EMAIL: "owner.canary@acme.example" };
const SECRETS = [CANARY.ONE_CLIENT_SECRET, CANARY.ONE_CONNECT_KEY, OWN.ONE_CLIENT_SECRET, OWN.ONE_CONNECT_KEY, APP.WEATHER_API_KEY];
/** Strings that must never appear anywhere: every secret value and its last six characters, and the full non-secret ones. */
const FORBIDDEN = [...SECRETS, ...SECRETS.map((v) => v.slice(-6)), CANARY.ONE_CLIENT_ID, OWN.ONE_CLIENT_ID, OWN.ONE_PERMISSION_SET, APP.APP_OWNER_EMAIL];

const ORIGIN = `http://127.0.0.1:${PORTS.server}`;
const HOST = `127.0.0.1:${PORTS.server}`;

/** An in-memory Keychain, so the test never writes the login Keychain. */
const keychain = new Map<string, string>();
const fakeSecurity: SecurityRunner = async (args, stdin) => {
  if (args[0] === "-i") {
    const m = /-s "([^"]+)" -a "([^"]+)".* -w "([^"]+)"/.exec(stdin ?? "");
    if (m) keychain.set(`${m[1]}|${m[2]}`, m[3]!);
    return { code: m ? 0 : 1, stdout: "" };
  }
  const key = `${args[args.indexOf("-s") + 1]}|${args[args.indexOf("-a") + 1]}`;
  if (args[0] === "find-generic-password") return keychain.has(key) ? { code: 0, stdout: `${keychain.get(key)}\n` } : { code: 44, stdout: "" };
  if (args[0] === "delete-generic-password") return { code: keychain.delete(key) ? 0 : 44, stdout: "" };
  return { code: 1, stdout: "" };
};

let p: Platform;
let app: ReturnType<typeof createApp>;
let scratch: string;
let row: ProjectRow;
let other: ProjectRow;
let templateId = "";
const logs: string[] = [];
const seen: { what: string; text: string }[] = [];
let csrf = "";

const call = async (method: string, path: string, o: { body?: unknown; origin?: string | null; host?: string; csrf?: string | null; auth?: string } = {}) => {
  const headers: Record<string, string> = { host: o.host ?? HOST };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.csrf !== null && (o.csrf ?? csrf)) headers[CSRF_HEADER] = o.csrf ?? csrf;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.auth) headers.authorization = `Bearer ${o.auth}`;
  const res = await app.fetch(new Request(`http://${headers.host}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }));
  const text = await res.text();
  seen.push({ what: `${method} ${path} ${res.status}`, text: `${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}` });
  return { status: res.status, text, json: () => JSON.parse(text) as Record<string, unknown> };
};

const leaks = (text: string) => FORBIDDEN.filter((f) => text.includes(f));

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-env-routes-`));
  linkScratchTemplateCache(scratch);
  // The One CLI side is off (no binary found), so nothing here runs `one` or reaches the network.
  p = await createPlatform({ home: scratch, databasePort: 51800, preview: false, grant: "builder", cli: { resolve: async () => null }, log: (l) => logs.push(l), env: { backend: "keychain", security: fakeSecurity, probe: async () => ({ online: "accepted", message: "One knows this app." }) } });
  const hub = createHub();
  p.bus.on((id, e) => hub.emit(id, e));
  app = createApp({ platform: p, hub, detect: async () => [], log: (l) => logs.push(l) });
  ({ row } = await p.workspace.create({ name: "env-canary", harness: "replay", model: "demo", permission: "build", autoFix: false }));
  ({ row: other } = await p.workspace.create({ name: "env-canary-two", harness: "replay", model: "demo", permission: "build", autoFix: false }));
  mkdirSync(join(row.path, "server"), { recursive: true });
  writeFileSync(join(row.path, "server", "weather.ts"), 'export const key = (c: { env: Record<string, string | undefined> }) => c.env.WEATHER_API_KEY;\n');
}, 240_000);

afterAll(async () => {
  await p?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("environment routes", () => {
  it("hands out the CSRF token only through the editor's GET, and guards every change", async () => {
    const g = await call("GET", "/api/connect/templates", { csrf: null });
    expect(g.status).toBe(200);
    csrf = String(g.json().csrf);
    expect(csrf.length).toBeGreaterThan(20);
    expect(g.json().redirectUri).toBe(`http://127.0.0.1:${PORTS.proxy}/api/one/callback`);
    const body = { name: "Acme Connect app", values: CANARY };
    expect((await call("POST", "/api/connect/templates", { body, origin: null })).status).toBe(403);
    expect((await call("POST", "/api/connect/templates", { body, origin: "http://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/connect/templates", { body, origin: `http://acme.localhost:${PORTS.proxy}` })).status).toBe(403);
    expect((await call("POST", "/api/connect/templates", { body, csrf: "wrong" })).status).toBe(403);
    expect((await call("GET", "/api/connect/templates", { host: "evil.example" })).status).toBe(403);
    expect((await call("GET", `/api/projects/${row.id}/connect`, { host: "evil.example" })).status).toBe(403);
    expect((await call("PUT", `/api/projects/${row.id}/connect`, { body: { use: "new" }, csrf: "wrong" })).status).toBe(403);
    expect((await p.connect.list()).length).toBe(0);
  });

  it("refuses a bad value with field messages that do not echo it, and saves nothing", async () => {
    const r = await call("POST", "/api/connect/templates", { body: { name: "Bad", values: { ...CANARY, ONE_CLIENT_SECRET: CANARY.ONE_CONNECT_KEY } } });
    expect(r.status).toBe(400);
    expect(Object.keys((r.json().fields ?? {}) as object)).toContain("ONE_CLIENT_SECRET");
    expect(leaks(r.text)).toEqual([]);
    expect((await p.connect.list()).length).toBe(0);
  });

  it("saves a template, links a project to it, and turns One Connect on, with status by name only", async () => {
    const r = await call("POST", "/api/connect/templates", { body: { name: "Acme Connect app", values: CANARY } });
    expect(r.status).toBe(200);
    const t = (r.json() as { setup: { id: string; configured: boolean; kind: string; vars: { name: string; present: boolean; where: string; hint: string | null }[] } }).setup;
    templateId = t.id;
    expect(t).toMatchObject({ kind: "template", configured: true });
    expect(t.vars.every((v) => v.name === "ONE_PERMISSION_SET" || (v.present && v.where === "keychain"))).toBe(true);
    expect(t.vars.find((v) => v.name === "ONE_CLIENT_ID")!.hint).toBe("…7Q2w");
    const linked = await call("PUT", `/api/projects/${row.id}/connect`, { body: { use: "template", setupId: t.id } });
    expect(linked.status).toBe(200);
    const j = linked.json() as { connect: { enabled: boolean; setupId: string; via: string }; owned: boolean; ready: boolean; redirectUris: { preview: string } };
    expect(j.connect).toEqual({ enabled: true, setupId: t.id, via: "template" });
    expect(j.owned).toBe(false);
    expect(j.redirectUris.preview).toBe(`http://127.0.0.1:${PORTS.proxy}/api/one/callback`);
    // The preview Worker gets the values (its dev server env, never a file); the route never does.
    const env = await p.connect.previewEnv(row.id);
    expect(env).toMatchObject({ ONE_MODE: "connect", ONE_CLIENT_ID: CANARY.ONE_CLIENT_ID, ONE_REDIRECT_URI: j.redirectUris.preview });
    expect(await p.connect.previewEnv(other.id)).toEqual({ ONE_MODE: "off" });
  });

  it("gives the second project its own Connect app, saved write-only, and copies none of the template's", async () => {
    const n = await call("PUT", `/api/projects/${other.id}/connect`, { body: { use: "new", name: "Two's app" } });
    expect(n.status).toBe(200);
    const sid = (n.json() as { connect: { setupId: string } }).connect.setupId;
    expect(sid).not.toBe(templateId);
    expect((await call("PUT", `/api/projects/${other.id}/connect`, { body: { enabled: true } })).status).toBe(409);
    const s = await call("PUT", `/api/connect/setups/${sid}/env`, { body: { values: OWN } });
    expect(s.status).toBe(200);
    expect((s.json() as { setup: { configured: boolean; ownerProjectId: string } }).setup).toMatchObject({ configured: true, ownerProjectId: other.id });
    const on = await call("PUT", `/api/projects/${other.id}/connect`, { body: { enabled: true } });
    expect((on.json() as { connect: { enabled: boolean } }).connect.enabled).toBe(true);
    expect((await p.connect.previewEnv(other.id)).ONE_CONNECT_KEY).toBe(OWN.ONE_CONNECT_KEY);
    expect((await p.connect.previewEnv(row.id)).ONE_CONNECT_KEY).toBe(CANARY.ONE_CONNECT_KEY);
    await call("GET", `/api/projects/${other.id}/connect`);
    await call("GET", `/api/projects/${row.id}/connect`);
    await call("GET", "/api/connect/templates");
  });

  it("checks a setup without returning a value", async () => {
    const r = await call("POST", `/api/connect/setups/${templateId}/check`, { body: { values: {} } });
    const j = r.json() as { ok: boolean; online: string };
    expect(j.ok).toBe(true);
    expect(j.online).toBe("accepted");
    const typed = await call("POST", "/api/connect/check", { body: { values: { ...OWN, ONE_CONNECT_KEY: OWN.ONE_CLIENT_SECRET } } });
    expect((typed.json() as { ok: boolean }).ok).toBe(false);
  });

  it("stores project values, reads the code's names with file:line, and tells the agent names only", async () => {
    const r = await call("PUT", `/api/projects/${row.id}/env`, { body: { values: APP } });
    expect(r.status).toBe(200);
    const j = r.json() as { vars: { name: string; present: boolean; sites: { file: string; line: number }[] }[]; missing: string[] };
    const w = j.vars.find((v) => v.name === "WEATHER_API_KEY")!;
    expect(w.present).toBe(true);
    expect(w.sites).toEqual([{ file: "server/weather.ts", line: 1 }]);
    expect(j.missing).toEqual([]);
    const tok = p.turns.mintToken(row.id);
    const mcp = await call("POST", "/api/mcp/project_env", { body: { request: [{ name: "SLACK_SIGNING_SECRET", why: "Verifies Slack's requests." }] }, origin: null, csrf: null, auth: tok.token });
    expect(mcp.status).toBe(200);
    expect(mcp.text).toContain("WEATHER_API_KEY: set");
    const facts = p.env.facts(row);
    seen.push({ what: "agent facts", text: facts + prompts.systemAppend({ kind: "user", previewUrl: "x", permission: "build", openErrors: [], selections: [], restored: null, fixAttempt: 0, one: facts }) });
    expect(facts).toContain("WEATHER_API_KEY set");
  });

  it("never sends a value on the SSE stream while values change", async () => {
    const ctl = new AbortController();
    const res = await app.fetch(new Request(`http://${HOST}/api/projects/${row.id}/events`, { headers: { host: HOST }, signal: ctl.signal }));
    const reader = res.body!.getReader();
    let sse = "";
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          sse += new TextDecoder().decode(value);
        }
      } catch {
        /* aborted */
      }
    })();
    for (let i = 0; i < 50 && !sse.includes("hello"); i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 200));
    await call("PUT", `/api/projects/${row.id}/env`, { body: { values: { WEATHER_API_KEY: `${APP.WEATHER_API_KEY}` } } });
    await call("DELETE", `/api/projects/${row.id}/env/APP_OWNER_EMAIL`);
    await new Promise((r) => setTimeout(r, 300));
    ctl.abort();
    await reader.cancel().catch(() => {});
    await pump;
    expect(sse).toContain("env.changed");
    seen.push({ what: "SSE", text: sse });
  });

  it("no response, event, log, project file or index ever holds a value", async () => {
    for (const path of ["/api/me", "/api/one/cli", "/api/connect/templates", "/api/settings", `/api/projects/${row.id}`, `/api/projects/${row.id}/env`, `/api/projects/${row.id}/connect`, `/api/projects/${other.id}/connect`, `/api/projects/${row.id}/scopes`, `/api/projects/${row.id}/files`, `/api/projects/${row.id}/file?path=server/weather.ts`, `/api/projects/${row.id}/activity`, `/api/projects/${row.id}/errors`, `/api/projects/${row.id}/publishes`, `/api/projects/${other.id}/files`, "/api/health"]) {
      await call("GET", path);
    }
    for (const s of seen) expect({ what: s.what, leaks: leaks(s.text) }).toEqual({ what: s.what, leaks: [] });
    expect(leaks(logs.join("\n"))).toEqual([]);
    // The project folders (what the agent reads and what publish uploads).
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (n === "node_modules" || n === ".git" ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of [...walk(row.path), ...walk(other.path)]) expect({ f, leaks: leaks(readFileSync(f, "utf8")) }).toEqual({ f, leaks: [] });
    expect(leaks(readFileSync(join(scratch, "env-index.json"), "utf8"))).toEqual([]);
    // Delete removes from the store too, and the linked project can no longer sign in.
    const del = await call("DELETE", `/api/connect/setups/${templateId}/env/ONE_CONNECT_KEY`);
    expect((del.json() as { setup: { configured: boolean } }).setup.configured).toBe(false);
    expect(await p.connect.previewEnv(row.id)).toEqual({ ONE_MODE: "off" });
    expect(leaks(del.text)).toEqual([]);
    expect([...keychain.values()].some((v) => v.includes(CANARY.ONE_CONNECT_KEY) || Buffer.from(v.slice(4), "base64").toString() === CANARY.ONE_CONNECT_KEY)).toBe(false);
    // A template a project still links to is not deleted.
    expect((await call("DELETE", `/api/connect/setups/${templateId}`)).status).toBe(409);
  });
});
