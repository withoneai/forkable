// the manifest extractor, codegen over the
// catalog fixtures, the ask JSON, the relay's outcomes and the receipt
// formatter.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateActions, planInput } from "../src/catalog/codegen.js";
import { levelFor, verbFor } from "../src/catalog/naming.js";
import { createStubGrant, loadKnowledgeFixtures, type KnowledgeRow } from "../src/fixtures.js";
import { receiptLine, makeReceipt } from "../src/receipts.js";
import { DevGate, queryStrings } from "../src/devgate.js";
import { PREVIEW_CALLBACK } from "../src/brand.js";
import { createStubOne, pathParamsOf, sampleConnectUserId } from "../src/stubone.js";
import { diffManifests, serializeManifest, toAsk } from "../src/scopes/ask.js";
import { extractManifest } from "../src/scopes/extract.js";
import type { ActivityInput } from "../src/activity.js";
import type { InstalledAction, Manifest, ReceiptSource, VisitorGrant } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, "..", "..", "..", "fixtures");
const knowledge = loadKnowledgeFixtures(join(FIX, "knowledge"));
const K = (id: string): KnowledgeRow | null => knowledge.get(id) ?? null;

const GET_THREADS = "conn_mod_def::GGSNlnppgZ0::qk3CudDWTVKPY7hpPVCqLQ";
const SEND = "conn_mod_def::GGXAjWkZO8U::uMc1LQIHTTKzeMm3rLL5gQ";
const DELETE_MSG = "conn_mod_def::GJ3ocgKltKQ::s8UCfiDLSaO9w9oPU32TYA";
const CALENDLY = "conn_mod_def::GJ1CqXgQaDM::Axz-At86SF-Z9PH0cP-x7Q";
const NO_SCHEMA = "conn_mod_def::GJ3oa8bJZNA::ZS9kXmE_Rzi4utfESor_ng";
const CONN_DEF: Record<string, string> = { gmail: "conn_def::19QDvh", calendly: "conn_def::3I5Pzu" };

/** A stand-in for the template's server/one/index.ts with the same exports the generated file and call sites use. */
const INDEX_TS = `
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ActionInput { body?: unknown; query?: object; pathParams?: object; headers?: object }
export interface Action<In extends ActionInput = ActionInput, Out = unknown> { platform: string; actionId: string; method: Method; path: string; title: string; headers?: Record<string, string>; readonly __types?: { input: In; output: Out } }
export function action<In extends ActionInput = ActionInput, Out = unknown>(def: { platform: string; actionId: string; method: Method | string; path: string; title: string; headers?: Record<string, string> }): Action<In, Out> { return def as Action<In, Out>; }
export type RunResult<Out> = { ok: true; status: number; data: Out } | { ok: false; status: number };
export function one(_c: unknown) { return { run<In extends ActionInput, Out>(_a: Action<In, Out>, _i: In): Promise<RunResult<Out>> { return null as never; } }; }
export async function requireUser(_c: unknown): Promise<{ id: string }> { return { id: "u" }; }
`;

let root: string;
const installed: InstalledAction[] = [GET_THREADS, SEND, DELETE_MSG, CALENDLY, NO_SCHEMA].map((actionId) => ({ actionId, platform: knowledge.get(actionId)!.connectionPlatform }));
let generated = "";

function project(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "server", "one"), { recursive: true });
  writeFileSync(join(dir, "server", "one", "index.ts"), INDEX_TS);
  writeFileSync(join(dir, "server", "one", "actions.gen.ts"), generated);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}
const extract = (dir: string, inst: InstalledAction[] = installed) => extractManifest({ dir, installed: inst, knowledge: K, connDef: (p) => CONN_DEF[p] ?? null });

const head = `import { one, requireUser } from "./one";\nimport { gmail } from "./one/actions.gen";\n`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "builder-one-test-"));
  generated = (await generateActions(installed, K)).code;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("manifest extractor", () => {
  it("reads a literal wrapper and leaves unused wrappers out of the ask", () => {
    const dir = project("literal", {
      "server/app.ts": `${head}export async function threads(c: unknown) {\n  await requireUser(c);\n  return one(c).run(gmail.listAndViewEmailThreads, { body: { numberOfThreads: 5 } });\n}\n`,
    });
    const r = extract(dir);
    expect(r.issues).toEqual([]);
    expect(r.manifest.actions).toEqual([{ platform: "gmail", connDefId: "conn_def::19QDvh", actionId: GET_THREADS, title: "List and View Email Threads", method: "POST", level: "read" }]);
    expect(r.manifest.unused).toEqual([SEND, DELETE_MSG, CALENDLY, NO_SCHEMA].sort());
    expect(r.callSites).toEqual([{ actionId: GET_THREADS, file: "server/app.ts", line: 5, col: 10 }]);
  });

  it("follows an alias and reads an inline literal action", () => {
    const dir = project("inline", {
      "server/app.ts": `${head}const send = gmail.sendEmail;\nexport async function a(c: unknown) {\n  await requireUser(c);\n  await one(c).run(send, { body: { to: "a@acme.example", subject: "Hi", body: "Hello" } });\n  const client = one(c);\n  return client.run({ platform: "gmail", actionId: "${DELETE_MSG}", method: "DELETE", path: "/x", title: "Delete" }, { pathParams: { userId: "me", id: "1" } });\n}\n`,
    });
    const r = extract(dir);
    expect(r.issues).toEqual([]);
    const want = [
      [SEND, "write"],
      [DELETE_MSG, "delete"],
    ].sort((x, y) => x[0]!.localeCompare(y[0]!));
    expect(r.manifest.actions.map((a) => [a.actionId, a.level])).toEqual(want);
  });

  it("gives BLD001 for a dynamic action", () => {
    const dir = project("dynamic", {
      "server/app.ts": `${head}export async function a(c: unknown, name: string) {\n  await requireUser(c);\n  return one(c).run((gmail as Record<string, never>)[name], {});\n}\n`,
    });
    const r = extract(dir);
    expect(r.issues.map((i) => i.code)).toEqual(["BLD001"]);
    expect(r.manifest.actions).toEqual([]);
  });

  it("gives BLD002 for an action id that is not installed", () => {
    const dir = project(
      "unknown",
      { "server/app.ts": `${head}export async function a(c: unknown) {\n  await requireUser(c);\n  return one(c).run(gmail.sendEmail, { body: { to: "a", subject: "b", body: "c" } });\n}\n` },
    );
    const r = extract(dir, installed.filter((a) => a.actionId !== SEND));
    expect(r.issues.map((i) => i.code)).toEqual(["BLD002"]);
  });

  it("gives BLD003 for a raw action id outside actions.gen.ts", () => {
    const dir = project("raw", { "server/ids.ts": `export const SEND_ID = "${SEND}";\n` });
    expect(extract(dir).issues.map((i) => [i.code, i.file])).toEqual([["BLD003", "server/ids.ts"]]);
  });

  it("gives BLD004 for a provider SDK import and a provider URL", () => {
    const dir = project("sdk", {
      "server/mail.ts": `import { google } from "googleapis";\nexport const g = google;\nexport const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages";\n`,
    });
    expect(extract(dir).issues.map((i) => i.code)).toEqual(["BLD004", "BLD004"]);
  });

  it("warns with BLD005 when a route skips requireUser", () => {
    const dir = project("nouser", { "server/app.ts": `${head}export async function a(c: unknown) {\n  return one(c).run(gmail.listAndViewEmailThreads, {});\n}\n` });
    const r = extract(dir);
    expect(r.issues.map((i) => [i.code, i.severity])).toEqual([["BLD005", "warning"]]);
    expect(r.manifest.actions).toHaveLength(1);
  });

  it("does not warn for a public route on the owner's grant, and still lists it", () => {
    const dir = project("owner", { "server/app.ts": `${head}export async function a(c: unknown) {\n  return one(c, { as: "owner" }).run(gmail.listAndViewEmailThreads, {});\n}\n` });
    const r = extract(dir);
    expect(r.issues).toEqual([]);
    expect(r.manifest.actions).toHaveLength(1);
  });

  it("marks owner-run call sites and the manifest entry, direct or through a variable", () => {
    const dir = project("owner-marks", {
      "server/app.ts": `${head}export async function pub(c: unknown) {\n  const o = one(c, { as: "owner" });\n  await o.run(gmail.sendEmail, { body: {} as never });\n  return one(c, { as: "owner" }).run(gmail.listAndViewEmailThreads, {});\n}\nexport async function admin(c: unknown) {\n  await requireUser(c);\n  return one(c).run(gmail.listAndViewEmailThreads, {});\n}\n`,
    });
    const r = extract(dir);
    expect(r.issues).toEqual([]);
    const by = Object.fromEntries(r.manifest.actions.map((a) => [a.actionId, a.runsAs]));
    expect(by[SEND]).toEqual(["owner"]);
    expect(by[GET_THREADS]).toEqual(["user", "owner"]);
    expect(r.callSites.map((c) => [c.actionId, c.line, c.as ?? "user"])).toEqual([
      [SEND, 5, "owner"],
      [GET_THREADS, 6, "owner"],
      [GET_THREADS, 10, "user"],
    ]);
    const saved = JSON.parse(serializeManifest(r.manifest)) as Manifest;
    expect(saved.actions.find((a) => a.actionId === SEND)!.runsAs).toEqual(["owner"]);
  });

  it("keeps a users-only manifest's bytes (no runsAs key)", () => {
    const dir = project("user-only", { "server/app.ts": `${head}export async function a(c: unknown) {\n  await requireUser(c);\n  return one(c).run(gmail.listAndViewEmailThreads, {});\n}\n` });
    const r = extract(dir);
    expect(r.manifest.actions[0]).not.toHaveProperty("runsAs");
    expect(serializeManifest(r.manifest)).not.toContain("runsAs");
  });

  it("serializes the manifest without line numbers, in a stable order", () => {
    const m: Manifest = { version: 1, actions: [{ platform: "gmail", connDefId: "conn_def::19QDvh", actionId: SEND, title: "Send Email", method: "POST", level: "write" }], unused: ["b", "a"] };
    const s = serializeManifest(m);
    expect(s).not.toMatch(/line/);
    expect(JSON.parse(s).unused).toEqual(["a", "b"]);
    expect(serializeManifest(JSON.parse(s))).toBe(s);
  });
});

describe("codegen over fixtures/knowledge", () => {
  it("types every fixture action, flattens allOf/if/then and falls back when there is no ioSchema", async () => {
    const r = await generateActions(installed, K);
    expect(r.wrappers.map((w) => w.ref)).toEqual(["gmail.listAndViewEmailThreads", "gmail.sendEmail", "gmail.permanentlyDeleteGmailMessage", "calendly.listEventTypes", "gmail.getGmailProfile"]);
    const cal = r.wrappers.find((w) => w.actionId === CALENDLY)!;
    expect(cal.conditions).toEqual(["query: when user_availability_schedule is set, user is required.", "query: at least one of organization, user is required."]);
    expect(cal.headers).toEqual({ Accept: "application/json" });
    expect(r.warnings).toEqual([{ actionId: NO_SCHEMA, message: "No schema for this action; types are loose." }]);
    expect(r.code).toContain("export type GmailGetGmailProfileInput = ActionInput;");
    // One sets the connection key and its own headers; they are not in the type.
    const send = r.wrappers.find((w) => w.actionId === SEND)!;
    expect(send.inputType).not.toContain("connectionKey");
    expect(send.inputType).not.toContain("x-one-secret");
    expect(send.inputType).toMatch(/to: /);
  });

  it("maps the schema's path key to pathParams", () => {
    const plan = planInput(knowledge.get(DELETE_MSG)!.ioSchema!.inputSchema);
    expect(Object.keys((plan.schema.properties as Record<string, unknown>) ?? {})).toEqual(["pathParams"]);
    expect(plan.schema.required).toEqual(["pathParams"]);
  });

  it("writes a file that passes tsc --noEmit, and wrong input fails it", async () => {
    const dir = join(root, "tsc");
    mkdirSync(join(dir, "server", "one"), { recursive: true });
    writeFileSync(join(dir, "server", "one", "index.ts"), INDEX_TS);
    writeFileSync(join(dir, "server", "one", "actions.gen.ts"), (await generateActions(installed, K)).code);
    writeFileSync(
      join(dir, "server", "use.ts"),
      `import { one } from "./one";\nimport { calendly, gmail } from "./one/actions.gen";\nexport async function f() {\n  const r = await one(null).run(gmail.listAndViewEmailThreads, { body: { numberOfThreads: 3, label: ["INBOX"] } });\n  if (r.ok) { const s: string | undefined = r.data.threads?.[0]?.messages?.[0]?.subject; void s; }\n  await one(null).run(gmail.permanentlyDeleteGmailMessage, { pathParams: { userId: "me", id: "x" } });\n  await one(null).run(calendly.listEventTypes, { query: { user: "https://api.calendly.com/users/x" } });\n  await one(null).run(gmail.getGmailProfile, { pathParams: { userId: "me" } });\n}\n`,
    );
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", skipLibCheck: true, lib: ["es2022", "dom"] }, include: ["server/**/*.ts"] }));
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const run = () => execFileSync(process.execPath, [tsc, "-p", dir, "--pretty", "false"], { encoding: "utf8" });
    expect(run).not.toThrow();
    writeFileSync(join(dir, "server", "bad.ts"), `import { one } from "./one";\nimport { gmail } from "./one/actions.gen";\nexport const g = one(null).run(gmail.sendEmail, { body: { subject: "missing to and body" } });\n`);
    expect(run).toThrow();
  });
});

describe("ask JSON", () => {
  it("groups by connDefId, one rule per connector, and reports connectors without one", () => {
    const m: Manifest = {
      version: 1,
      actions: [
        { platform: "gmail", connDefId: "conn_def::19QDvh", actionId: SEND, title: "Send Email", method: "POST", level: "write" },
        { platform: "gmail", connDefId: "conn_def::19QDvh", actionId: GET_THREADS, title: "Threads", method: "POST", level: "read" },
        { platform: "calendly", connDefId: "conn_def::3I5Pzu", actionId: CALENDLY, title: "Event types", method: "GET", level: "read" },
        { platform: "mystery", connDefId: null, actionId: "conn_mod_def::x::y", title: "?", method: "GET", level: "read" },
      ],
      unused: [],
    };
    const { ask, missing } = toAsk(m, "acme-inbox");
    expect(ask).toEqual({
      name: "acme-inbox ask",
      connectorRules: [
        { type: "connectionDefinition", connectionDefinitionId: "conn_def::19QDvh", methods: ["POST"], actionIds: [GET_THREADS, SEND].sort() },
        { type: "connectionDefinition", connectionDefinitionId: "conn_def::3I5Pzu", methods: ["GET"], actionIds: [CALENDLY] },
      ],
    });
    expect(missing).toEqual(["mystery"]);
  });

  it("diffs a widened manifest", () => {
    const before: Manifest = { version: 1, actions: [{ platform: "gmail", connDefId: "c", actionId: GET_THREADS, title: "t", method: "POST", level: "read" }], unused: [] };
    const after: Manifest = { ...before, actions: [...before.actions, { platform: "gmail", connDefId: "c", actionId: SEND, title: "Send Email", method: "POST", level: "write" }] };
    const d = diffManifests(before, after, (a) => `Gmail · ${a.level === "write" ? "send" : "get threads"} (${a.level})`);
    expect(d.widened).toBe(true);
    expect(d.lines).toEqual(["Gmail · send (write)"]);
    expect(diffManifests(after, before, () => "").widened).toBe(false);
  });
});

describe("dev gate outcomes", () => {
  const manifest: Manifest = {
    version: 1,
    actions: [
      { platform: "gmail", connDefId: "conn_def::19QDvh", actionId: GET_THREADS, title: "List and View Email Threads", method: "POST", level: "read" },
      { platform: "gmail", connDefId: "conn_def::19QDvh", actionId: SEND, title: "Send Email", method: "POST", level: "write" },
      { platform: "gmail", connDefId: "conn_def::19QDvh", actionId: DELETE_MSG, title: "Delete", method: "DELETE", level: "delete" },
    ],
    unused: [],
  };
  const rows: ActivityInput[] = [];
  let active: { id: string; status: string } | null = null;
  let v: VisitorGrant = { enabled: false, actions: [] };
  const gate = (kind: ReceiptSource = "one") =>
    new DevGate({
      catalog: { cached: (id: string) => K(id), platformName: async () => "Gmail" } as never,
      scopes: { derive: async () => ({ manifest, callSites: [], issues: [] }) } as never,
      activity: { record: async (_p: string, r: ActivityInput) => (rows.push(r), { id: rows.length, ...r }) } as never,
      activeTurn: async () => active,
      visitors: async () => v,
      kind: () => kind,
    });
  const p = { id: "p1", name: "acme", path: "/tmp/none" };
  const k = (id: string) => ({ actionId: id, platform: "gmail", method: K(id)!.method, path: K(id)!.path, title: K(id)!.title });

  it("stops an action outside the manifest locally, so the app never calls One", async () => {
    const r = await gate().check(p, k(NO_SCHEMA));
    expect(r.allow).toBe(false);
    if (r.allow) return;
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, source: "local", blockedByManifest: true, blockedByGrant: false, refusal: { source: "local", code: "not_in_manifest" } });
    expect(r.receipt.line).toBe("Gmail · get profile   held locally, not in this app's manifest");
    expect(rows.at(-1)).toMatchObject({ source: "local", status: 403 });
  });

  it("allows a manifest action, with its level and One as the source", async () => {
    expect(await gate().check(p, k(DELETE_MSG))).toEqual({ allow: true, level: "delete", source: "one" });
    expect(await gate("sample").check(p, k(GET_THREADS))).toEqual({ allow: true, level: "read", source: "sample" });
  });

  it("records One's own 403 from the app's report as declined, 403 with the One label", async () => {
    const { receipt, row } = await gate().report(p, { ...k(DELETE_MSG), status: 403, ok: false, blockedByGrant: true, ms: 41 });
    expect(receipt?.line).toBe("Gmail · delete   declined, 403");
    expect(receipt?.badge).toBe("One");
    expect(row).toMatchObject({ source: "one", status: 403, blockedByGrant: true, refusal: { source: "one", code: "blocked_by_grant" }, ms: 41 });
  });

  it("labels the sample One's refusal Sample, never One", async () => {
    const { receipt, row } = await gate("sample").report(p, { ...k(DELETE_MSG), status: 403, ok: false, blockedByGrant: true });
    expect(receipt).toMatchObject({ source: "sample", badge: "Sample", line: "Gmail · delete   declined, 403" });
    expect(row).toMatchObject({ source: "sample", refusal: { source: "sample" } });
  });

  it("records the app's own refusal before One as Local, never One's line", async () => {
    const { receipt, row } = await gate().report(p, { ...k(SEND), code: "signed_out", ok: false, status: 401 });
    expect(receipt).toMatchObject({ source: "local", badge: "Local" });
    expect(receipt!.line).not.toContain("declined, 403");
    expect(row).toMatchObject({ source: "local", refusal: { code: "signed_out" } });
  });

  it("records a call that went through with no receipt", async () => {
    const { receipt, row } = await gate().report(p, { ...k(GET_THREADS), status: 200, ok: true, ms: -5 });
    expect(receipt).toBeNull();
    expect(row).toMatchObject({ source: "one", status: 200, ok: true, ms: 0 });
  });

  describe("a visitor on the owner's grant", () => {
    const send = { ...k(SEND), as: "owner" as const };

    it("is refused locally while visitors are off, with the Local label and never One's line", async () => {
      v = { enabled: false, actions: [] };
      const r = await gate().check(p, send);
      expect(r.allow).toBe(false);
      if (r.allow) return;
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ ok: false, source: "local", blockedByGrant: false, refusal: { source: "local", code: "visitors_off" } });
      expect(r.receipt).toMatchObject({ source: "local", badge: "Local", line: "Gmail · send   held locally, not allowed for visitors" });
      expect(r.receipt.line).not.toContain("declined, 403");
      expect(r.receipt.caption).not.toMatch(/One refused/);
      expect(rows.at(-1)).toMatchObject({ source: "local", status: 403, refusal: { code: "visitors_off" } });
    });

    it("is refused for an action the builder did not tick, and allowed for one they did", async () => {
      v = { enabled: true, actions: [GET_THREADS] };
      const no = await gate().check(p, send);
      expect(no).toMatchObject({ allow: false, body: { source: "local", refusal: { code: "visitor_not_allowed" } }, receipt: { badge: "Local" } });
      v = { enabled: true, actions: [SEND] };
      expect((await gate().check(p, send)).allow).toBe(true);
      v = { enabled: false, actions: [SEND] };
      expect(await gate().check(p, send)).toMatchObject({ allow: false, body: { refusal: { code: "visitors_off" } } });
    });

    it("leaves signed-in calls alone", async () => {
      v = { enabled: false, actions: [] };
      expect((await gate().check(p, { ...send, as: "user" })).allow).toBe(true);
    });
  });

  it("holds a write while a turn runs (423 held) and lets reads through", async () => {
    active = { id: "t1", status: "running" };
    const w = await gate().check(p, k(SEND));
    expect(w).toMatchObject({ allow: false, status: 423, body: { ok: false, source: "held", refusal: { source: "held", code: "held_during_build" } } });
    expect(rows.at(-1)).toMatchObject({ source: "held", turnId: "t1" });
    expect((await gate().check(p, k(GET_THREADS))).allow).toBe(true);
    active = { id: "t1", status: "done" };
    expect((await gate().check(p, k(SEND))).allow).toBe(true);
    active = null;
  });
});

describe("the sample One (a preview app's stand-in for One)", () => {
  const stub = createStubGrant(FIX);
  const APP = { ONE_CLIENT_ID: "acme-sample-client", ONE_CLIENT_SECRET: `one_secret_sample_${"a".repeat(36)}`, ONE_CONNECT_KEY: `sk_live_sample_${"b".repeat(36)}` };
  const setups = {
    byClientId: async (id: string) => (id === APP.ONE_CLIENT_ID ? { row: { id: "cs_1" }, values: APP } : null),
    byConnectKey: async (key: string) => (key === APP.ONE_CONNECT_KEY ? { row: { id: "cs_1" }, values: APP } : null),
  };
  const one = createStubOne({ stub, setups: setups as never });
  const base = "http://127.0.0.1:1/api/stub-one/";
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = (q: Record<string, string>) => {
    const u = new URL(`${base}oauth/authorize`);
    for (const [k, x] of Object.entries({ client_id: APP.ONE_CLIENT_ID, redirect_uri: PREVIEW_CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s".repeat(24), ...q })) u.searchParams.set(k, x);
    return one.handle(new Request(u), "oauth/authorize");
  };
  const token = (form: Record<string, string>, secret = APP.ONE_CLIENT_SECRET) =>
    one.handle(
      new Request(`${base}oauth/token`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${APP.ONE_CLIENT_ID}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", redirect_uri: PREVIEW_CALLBACK, code_verifier: verifier, ...form }),
      }),
      "oauth/token",
    );
  const codeOf = async (q: Record<string, string> = {}) => {
    const r = await authorize(q);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(PREVIEW_CALLBACK);
    expect(loc.searchParams.get("state")).toBe("s".repeat(24));
    return loc.searchParams.get("code")!;
  };

  it("sends the browser only to the registered preview callback, with PKCE S256", async () => {
    expect((await authorize({ redirect_uri: "http://evil.example/api/one/callback" })).status).toBe(400);
    expect((await authorize({ redirect_uri: "http://acme.localhost:51990/api/one/callback" })).status).toBe(400);
    expect((await authorize({ client_id: "someone-else" })).status).toBe(400);
    expect((await authorize({ code_challenge_method: "plain" })).status).toBe(400);
    await codeOf();
  });

  it("exchanges a code once, with the right secret, redirect and verifier", async () => {
    expect((await token({ code: await codeOf() }, "one_secret_wrong")).status).toBe(401);
    expect((await token({ code: await codeOf(), code_verifier: "x".repeat(43) })).status).toBe(400);
    expect((await token({ code: await codeOf(), redirect_uri: "http://127.0.0.1:3000/api/one/callback" })).status).toBe(400);
    const code = await codeOf({ login_hint: "jordan@acme.example" });
    const ok = await token({ code });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { connect_user_id: string; access_token: string };
    expect(j.connect_user_id).toBe(sampleConnectUserId(APP.ONE_CLIENT_ID, "jordan@acme.example"));
    expect(j.connect_user_id).toMatch(/^cu_[0-9a-f]{64}$/);
    expect((await token({ code })).status).toBe(400);
  });

  const call = (path: string, o: { method?: string; actionId?: string; key?: string; cu?: string; body?: unknown } = {}) =>
    one.handle(
      new Request(`${base}v1/${path}`, {
        method: o.method ?? "GET",
        headers: { "x-one-secret": o.key ?? APP.ONE_CONNECT_KEY, "x-one-connect-user-id": o.cu ?? sampleConnectUserId(APP.ONE_CLIENT_ID, "avery@acme.example"), "x-one-action-id": o.actionId ?? "", "x-one-connection-key": "sample::gmail::acme", "content-type": "application/json" },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
      }),
      `v1/${path}`,
    );

  it("answers whoami for the signed-in person and refuses an unknown connect key", async () => {
    const w = (await (await call("users/whoami")).json()) as { user: { email: string; name: string } };
    expect(w.user).toMatchObject({ email: "avery@acme.example", name: "Avery Chen" });
    expect((await call("users/whoami", { key: "sk_live_not_ours" })).status).toBe(403);
    expect((await call("users/whoami", { cu: "cu_short" })).status).toBe(403);
  });

  it("runs a granted call and refuses one outside the grant the way One does: 403 with a correlationId", async () => {
    const ok = await call(`passthrough/gmail/v1/users/me/threads`, { method: "POST", actionId: GET_THREADS, body: { numberOfThreads: 2 } });
    expect(ok.status).toBe(200);
    const del = await call(`passthrough/gmail/v1/users/me/messages/x`, { method: "DELETE", actionId: DELETE_MSG });
    expect(del.status).toBe(403);
    expect(await del.json()).toMatchObject({ correlationId: expect.stringMatching(/^sample-/) });
  });

  it("reads path parameters back out of a filled path", () => {
    expect(pathParamsOf("/gmail/v1/users/{{userId}}/messages/{{id}}", "/gmail/v1/users/me/messages/abc%20d?x=1")).toEqual({ userId: "me", id: "abc d" });
    expect(pathParamsOf("/v1/send", "/v1/send")).toBeUndefined();
  });
});

describe("receipts", () => {
  const sources: ReceiptSource[] = ["one", "local", "held", "sample"];
  it("formats one line per source", () => {
    expect(receiptLine({ platformName: "Gmail", verb: "delete", source: "one" })).toBe("Gmail · delete   declined, 403");
    expect(receiptLine({ platformName: "Gmail", verb: "delete", source: "local", code: "not_in_manifest" })).toBe("Gmail · delete   held locally, not in this app's manifest");
    expect(receiptLine({ platformName: "Gmail", verb: "send", source: "held" })).toBe("Gmail · send   paused while the agent works");
    expect(makeReceipt({ platformName: "Gmail", verb: "delete", source: "sample", platform: "gmail" }).badge).toBe("Sample");
  });
  it("never renders a Local row with One's declined, 403 text", () => {
    for (const code of ["not_in_manifest", "not_connected", "signed_out", "visitors_off", "visitor_not_allowed", "anything", undefined]) {
      const r = makeReceipt({ platformName: "Gmail", verb: "delete", source: "local", code, platform: "gmail" });
      expect(r.line).not.toContain("declined, 403");
      expect(r.caption).not.toMatch(/One refused/);
      expect(r.badge).toBe("Local");
    }
    for (const s of sources) {
      const r = makeReceipt({ platformName: "Gmail", verb: "delete", source: s, platform: "gmail" });
      expect(r.line.includes("declined, 403")).toBe(s === "one" || s === "sample");
    }
  });
  it("derives verbs and levels from the catalog", () => {
    expect(verbFor({ method: "POST", path: "/v1/gmail/send-email", platform: "gmail" })).toBe("send");
    expect(verbFor({ method: "POST", path: "/v1/gmail/get-threads", platform: "gmail" })).toBe("get threads");
    expect(verbFor({ method: "DELETE", path: "/gmail/v1/users/{{userId}}/messages/{{id}}", platform: "gmail" })).toBe("delete");
    expect(levelFor({ method: "POST", title: "List and View Email Threads", tags: ["custom"] })).toBe("read");
    expect(levelFor({ method: "POST", title: "Send Email", tags: ["custom"] })).toBe("write");
  });
});


describe("list filters and query strings (2026-10-24: a nested Stripe filter went out as [object Object])", () => {
  it("flattens a nested query object into bracket keys", async () => {
    expect(queryStrings({ status: "open", due_date: { lt: 1700000000 }, limit: 100, expand: ["data.customer"], none: null })).toEqual({
      status: "open",
      "due_date[lt]": "1700000000",
      limit: "100",
      expand: ["data.customer"],
    });
  });

  it("the stub applies equality and ranges a list's items carry, nested or bracketed", async () => {
    const { filterList } = await import("../src/fixtures.js");
    const items = [
      { id: "a", status: "open", due_date: 100, labels: [{ name: "bug" }] },
      { id: "b", status: "open", due_date: 300 },
      { id: "c", status: "paid", due_date: 50 },
    ];
    expect(filterList(items, { status: "open", "due_date[lt]": "200", limit: "100" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterList(items, { status: "open", due_date: { gte: 100 } }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterList(items, { labels: "bug", state: "all" }).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filterList(items, { q: "anything" })).toHaveLength(3);
  });
});
