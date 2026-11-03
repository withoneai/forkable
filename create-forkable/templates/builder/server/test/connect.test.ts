// Per-project Connect: the shared
// preview callback on the proxy, templates linked or copied ("used by N"),
// another project's Connect app, the move of an old builder-level app into
// the "Your earlier Connect app" template, and the PKCE cookie path that lets
// the forwarded callback reach the app's own cookie.
//
// Runs on a scratch home with its own Postgres port and a file store; the
// proxy listens on a random port (never 51990) and requests carry the Host
// the browser would send.

import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOneConnect } from "@withone/connect/server";
import { BRAND, EnvService, PORTS, PREVIEW_CALLBACK, createPlatform, linkScratchTemplateCache, projectCallback, resolveHome, versionLabel, type Platform, type ProjectRow } from "@builder/core";
import { createApp } from "../src/app.js";
import { createHub } from "../src/hub.js";
import { createProxy } from "../src/proxy.js";

const LEGACY = { ONE_CLIENT_ID: "client_legacy_9d1e", ONE_CLIENT_SECRET: "one_secret_LEGACYsecret4Hk8Pq2", ONE_CONNECT_KEY: "sk_live_LEGACYkey6Tn3Wb7" };
const TPL = { ONE_CLIENT_ID: "client_tpl_51ab", ONE_CLIENT_SECRET: "one_secret_TPLsecret2Fg6Jk9Lm", ONE_CONNECT_KEY: "sk_live_TPLkey8Rd4Vs1Xz" };
const OLDPROJ = { ONE_CLIENT_ID: "client_oldproj_7c", ONE_CLIENT_SECRET: "one_secret_OLDPROJsec5Ny1Qa3", ONE_CONNECT_KEY: "sk_live_OLDPROJkey9Ue2Io4" };
const SECRETS = [LEGACY, TPL, OLDPROJ].flatMap((v) => [v.ONE_CLIENT_SECRET, v.ONE_CONNECT_KEY]);

let scratch: string;
let p: Platform;
let app: ReturnType<typeof createApp>;
let proxy: http.Server;
let proxyPort = 0;
const logs: string[] = [];
let a: { row: ProjectRow; devToken: string };
let b: { row: ProjectRow; devToken: string };
let c: { row: ProjectRow; devToken: string };

const boot = () => createPlatform({ home: scratch, databasePort: 51840, preview: false, grant: "sample", log: (l) => logs.push(l), env: { backend: "file" } });

/** A GET to the proxy with the Host the browser sends. */
const viaProxy = (path: string, host = new URL(PREVIEW_CALLBACK).host): Promise<{ status: number; location: string | null; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxyPort, path, method: "GET", headers: { host, "x-forwarded-host": "evil.example", forwarded: "host=evil.example" } }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null, body }));
    });
    req.on("error", reject);
    req.end();
  });

const bind = async (projectId: string, token: string, state: string) => {
  const res = await app.fetch(new Request(`http://127.0.0.1:${PORTS.server}/api/dev/${projectId}/oauth-state`, { method: "POST", headers: { host: `127.0.0.1:${PORTS.server}`, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ state }) }));
  return res.status;
};
let n = 0;
const newState = () => `st_${Date.now().toString(36)}_${(n++).toString().padStart(4, "0")}_abcdefgh`;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), `${BRAND.slug}-connect-`));
  linkScratchTemplateCache(scratch);
  // A home from before per-project Connect: the builder-level app in BUILDER_HOME/.env.
  await new EnvService({ home: resolveHome(scratch), backend: "file", probe: null }).store.set("builder", { ...LEGACY, ONE_REDIRECT_URI: "http://127.0.0.1:51989/api/one/callback" });
  p = await boot();
  app = createApp({ platform: p, hub: createHub(), detect: async () => [], log: (l) => logs.push(l) });
  a = await p.workspace.create({ name: "Acme Tasks", harness: "replay", model: "demo", permission: "build", autoFix: false });
  b = await p.workspace.create({ name: "Acme Inbox", harness: "replay", model: "demo", permission: "build", autoFix: false });
  c = await p.workspace.create({ name: "Acme CRM", harness: "replay", model: "demo", permission: "build", autoFix: false });
  proxy = createProxy({ platform: p, clientJs: async () => "" });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
  proxyPort = (proxy.address() as AddressInfo).port;
}, 240_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => proxy?.close(r));
  await p?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the shared preview callback", () => {
  it("forwards to the project that bound the state, once, with only the OAuth fields", async () => {
    const s = newState();
    expect(await bind(a.row.id, a.devToken, s)).toBe(200);
    const r = await viaProxy(`/api/one/callback?code=c0de&state=${s}&error_description=x&next=http://evil.example/&redirect_uri=http://evil.example/cb&host=evil.example`);
    expect(r.status).toBe(302);
    const loc = new URL(r.location!);
    expect(`${loc.origin}${loc.pathname}`).toBe(projectCallback(a.row.slug));
    expect(loc.host).toBe(`${a.row.slug}.localhost:${PORTS.proxy}`);
    expect([...loc.searchParams.keys()].sort()).toEqual(["code", "error_description", "state"]);
    expect(loc.searchParams.get("code")).toBe("c0de");
    // Used once.
    const again = await viaProxy(`/api/one/callback?code=c0de&state=${s}`);
    expect(again.status).toBe(400);
    expect(again.location).toBeNull();
    expect(again.body).toMatch(/works once, for ten minutes/);
  });

  it("takes the target host from the project's slug in the database, never the request", async () => {
    const s = newState();
    expect(await bind(b.row.id, b.devToken, s)).toBe(200);
    // The localhost form of the callback host, a protocol-relative path, and forwarded-host headers (sent on every request here).
    const r = await viaProxy(`//evil.example/api/one/callback?code=k&state=${s}`, `localhost:${PORTS.proxy}`);
    expect(r.status).toBe(302);
    expect(new URL(r.location!).host).toBe(`${b.row.slug}.localhost:${PORTS.proxy}`);
  });

  it("refuses open-redirect attempts: unknown, malformed or missing state, another host, another path", async () => {
    for (const q of ["", "?code=x", "?state=", "?state=unknown_state_value_123456", "?state=..%2F..%2Fevil", `?state=${"a".repeat(200)}`, "?state=https://evil.example/aaaaaaaaaaaa"]) {
      const r = await viaProxy(`/api/one/callback${q}`);
      expect({ q, status: r.status, location: r.location }).toEqual({ q, status: 400, location: null });
    }
    const s = newState();
    expect(await bind(a.row.id, a.devToken, s)).toBe(200);
    // Not the callback: another host or another path never forwards (and leaves the state unused).
    expect((await viaProxy(`/api/one/callback?state=${s}`, "evil.example")).location).toBeNull();
    expect((await viaProxy(`/api/one/callback?state=${s}`, `127.0.0.1:${PORTS.proxy + 1}`)).location).toBeNull();
    expect((await viaProxy(`/api/one/callback/../x?state=${s}`)).location).toBeNull();
    expect((await viaProxy(`/api/one/callbackx?state=${s}`)).location).toBeNull();
    const ok = await viaProxy(`/api/one/callback?state=${s}`);
    expect(new URL(ok.location!).host).toBe(`${a.row.slug}.localhost:${PORTS.proxy}`);
  });

  it("binds a state only with the project's own dev token, and never moves a state to another project", async () => {
    const s = newState();
    expect(await bind(a.row.id, b.devToken, s)).toBe(401);
    expect(await bind(a.row.id, "", s)).toBe(401);
    expect(await bind(a.row.id, a.devToken, "short")).toBe(400);
    expect(await bind(a.row.id, a.devToken, "has spaces in it, not base64url")).toBe(400);
    expect(await bind(a.row.id, a.devToken, s)).toBe(200);
    // B tries to claim A's state, so A's sign-in would land on B.
    expect(await bind(b.row.id, b.devToken, s)).toBe(400);
    expect(new URL((await viaProxy(`/api/one/callback?state=${s}`)).location!).host).toBe(`${a.row.slug}.localhost:${PORTS.proxy}`);
  });

  it("expires a state after ten minutes", async () => {
    const s = newState();
    const s2 = newState();
    expect(await bind(a.row.id, a.devToken, s)).toBe(200);
    expect(await bind(a.row.id, a.devToken, s2)).toBe(200);
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now + 9 * 60_000);
    expect((await viaProxy(`/api/one/callback?state=${s2}`)).status).toBe(302);
    spy.mockReturnValue(now + 10 * 60_000 + 1000);
    expect((await viaProxy(`/api/one/callback?state=${s}`)).status).toBe(400);
    spy.mockRestore();
  });

  it("sends a version preview's sign-in back to that version's own host", () => {
    const label = versionLabel(a.row.slug, "1a2b3c4d5e6f");
    expect(p.connect.bindState(a.row.id, label, "version_state_abcdefghij")).toBe(true);
    const hit = p.connect.takeState("version_state_abcdefghij");
    expect(hit).toMatchObject({ projectId: a.row.id, label });
    expect(new URL(projectCallback(hit!.label)).host).toBe(`${a.row.slug}--v-1a2b3c4.localhost:${PORTS.proxy}`);
  });

  it("keeps the PKCE cookie on the app's own host: its path covers the forwarded callback", () => {
    const oc = createOneConnect({ clientId: TPL.ONE_CLIENT_ID, clientSecret: TPL.ONE_CLIENT_SECRET, connectKey: TPL.ONE_CONNECT_KEY, redirectUri: PREVIEW_CALLBACK, userStore: { saveUser: async () => {}, loadUser: async () => null, clearUser: async () => {} } });
    const start = oc.startAuthorization();
    const authorize = new URL(start.redirectUrl);
    expect(authorize.searchParams.get("redirect_uri")).toBe(PREVIEW_CALLBACK);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    // The package scopes its verifier cookie to the callback's directory. The app sets it on <slug>.localhost
    // at /api/one/authorize; the proxy forwards to <slug>.localhost/api/one/callback, inside that path.
    const path = start.cookie.options.path;
    expect(path).toBe("/api/one");
    expect(start.cookie.options.httpOnly).toBe(true);
    expect(start.cookie.options.secure).toBe(false);
    const forwarded = new URL(projectCallback(a.row.slug));
    expect(forwarded.pathname.startsWith(`${path}/`)).toBe(true);
    expect(forwarded.pathname).toBe(new URL(PREVIEW_CALLBACK).pathname);
  });
});

describe("templates and links", () => {
  let tplId = "";

  it("moved the old builder-level app into the template \"Your earlier Connect app\", once, and removed it from .env", async () => {
    const t = (await p.connect.list("template")).filter((x) => x.name === "Your earlier Connect app");
    expect(t).toHaveLength(1);
    expect(await p.env.setupValues(t[0]!.id)).toEqual(LEGACY);
    expect(p.env.store.status("builder")).toEqual([]);
    expect(logs.some((l) => l.includes('moved the builder-level Connect app into the template "Your earlier Connect app"'))).toBe(true);
    // The sample template is there too, labeled.
    expect((await p.connect.list("template")).filter((x) => x.sample)).toHaveLength(1);
  });

  it("links two projects to one template (used by 2), refuses to delete it, and shows the template's values to both", async () => {
    const t = await p.connect.create({ name: "Acme shared app", kind: "template" });
    tplId = t.id;
    await expect(p.connect.apply(a.row, { use: "template", setupId: t.id })).rejects.toMatchObject({ code: "not_configured" });
    await p.env.saveSetup(t.id, TPL);
    expect(await p.connect.apply(a.row, { use: "template", setupId: t.id })).toEqual({ enabled: true, setupId: t.id, via: "template" });
    expect(await p.connect.apply(b.row, { use: "template", setupId: t.id })).toEqual({ enabled: true, setupId: t.id, via: "template" });
    const info = await p.connect.info((await p.connect.get(t.id))!);
    expect(info.usedBy.map((u) => u.name).sort()).toEqual(["Acme Inbox", "Acme Tasks"]);
    expect(info.usedBy.every((u) => u.enabled)).toBe(true);
    await expect(p.connect.remove(t.id)).rejects.toMatchObject({ code: "in_use", message: expect.stringMatching(/^2 projects use this Connect app/) });
    expect((await p.connect.previewEnv(a.row.id)).ONE_CLIENT_ID).toBe(TPL.ONE_CLIENT_ID);
    // A change to a linked template reaches every project on it.
    await p.env.saveSetup(t.id, { ONE_PERMISSION_SET: "ask_shared_1" });
    expect((await p.connect.previewEnv(a.row.id)).ONE_PERMISSION_SET).toBe("ask_shared_1");
    expect((await p.connect.previewEnv(b.row.id)).ONE_PERMISSION_SET).toBe("ask_shared_1");
    // On the sample source the app talks to the stub One, labeled.
    expect((await p.connect.previewEnv(a.row.id)).ONE_API_URL).toMatch(/\/api\/stub-one$/);
  });

  it("copies a template into the project's own app: used by 1, and later template changes do not reach it", async () => {
    const r = await p.connect.apply(b.row, { use: "template", setupId: tplId, copy: true });
    expect(r.via).toBe("new");
    expect(r.enabled).toBe(true);
    expect(r.setupId).not.toBe(tplId);
    const own = (await p.connect.get(r.setupId!))!;
    expect(own).toMatchObject({ kind: "project", ownerProjectId: b.row.id, name: "Acme Inbox Connect app" });
    expect((await p.connect.info((await p.connect.get(tplId))!)).usedBy.map((u) => u.name)).toEqual(["Acme Tasks"]);
    await p.env.saveSetup(tplId, { ONE_PERMISSION_SET: "ask_shared_2" });
    expect((await p.connect.previewEnv(b.row.id)).ONE_PERMISSION_SET).toBe("ask_shared_1");
    expect((await p.connect.previewEnv(a.row.id)).ONE_PERMISSION_SET).toBe("ask_shared_2");
    expect(await p.env.setupValues(own.id)).toMatchObject({ ONE_CLIENT_ID: TPL.ONE_CLIENT_ID, ONE_CLIENT_SECRET: TPL.ONE_CLIENT_SECRET });
  });

  it("links a third project to another project's own app, lists it among others, and keeps it when the owner goes", async () => {
    const own = (await p.connect.projectConnect(b.row.id)).setupId!;
    expect((await p.connect.others(c.row.id)).map((o) => o.name)).toEqual(["Acme Inbox"]);
    await expect(p.connect.apply(c.row, { use: "project", projectId: c.row.id })).rejects.toMatchObject({ code: "same_project" });
    expect(await p.connect.apply(c.row, { use: "project", projectId: b.row.id })).toEqual({ enabled: true, setupId: own, via: "project" });
    expect((await p.connect.info((await p.connect.get(own))!)).usedBy.map((u) => u.name).sort()).toEqual(["Acme CRM", "Acme Inbox"]);
    await p.connect.dropProject(b.row.id);
    const kept = await p.connect.get(own);
    expect(kept).toMatchObject({ ownerProjectId: null });
    expect(p.env.setupConfigured(own)).toBe(true);
    // Turning off keeps the link; "none" drops it.
    expect(await p.connect.apply(c.row, { enabled: false })).toEqual({ enabled: false, setupId: own, via: "project" });
    expect(await p.connect.previewEnv(c.row.id)).toEqual({ ONE_MODE: "off" });
    expect(await p.connect.apply(c.row, { use: "none" })).toEqual({ enabled: false, setupId: null, via: null });
  });

  it("saves a project's app as a template copy, and turning on needs a configured setup", async () => {
    await expect(p.connect.apply(c.row, { enabled: true })).rejects.toMatchObject({ code: "no_setup" });
    await p.connect.apply(c.row, { use: "new" });
    await expect(p.connect.apply(c.row, { enabled: true })).rejects.toMatchObject({ code: "not_configured" });
    const own = (await p.connect.projectConnect(c.row.id)).setupId!;
    await expect(p.connect.saveAsTemplate(own, "CRM template")).rejects.toMatchObject({ code: "not_configured" });
    await p.env.saveSetup(own, OLDPROJ);
    const t = await p.connect.saveAsTemplate(own, "CRM template");
    expect(t).toMatchObject({ kind: "template", name: "CRM template" });
    expect(await p.env.setupValues(t.id)).toEqual(OLDPROJ);
    expect((await p.connect.info(t)).usedBy).toEqual([]);
  });

  it("never puts a value in a setup's info, the log or a project's files", async () => {
    const infos = JSON.stringify(await Promise.all((await p.connect.list()).map((r) => p.connect.info(r))));
    for (const sec of SECRETS) {
      expect(infos).not.toContain(sec);
      expect(logs.join("\n")).not.toContain(sec);
    }
  });
});

describe("the move of older Connect values, on the next boot", () => {
  it("makes a project's old Connect values its own app (left off), once, and keeps its other values", async () => {
    // A project from before per-project Connect kept its Connect values among its app values.
    await p.env.store.set(`project:${a.row.id}`, { ...OLDPROJ, WEATHER_API_KEY: "wk_keep_1" });
    await p.connect.apply(a.row, { use: "none" });
    await new Promise((r) => proxy.close(r));
    await p.stop();
    p = await boot();
    proxy = createProxy({ platform: p, clientJs: async () => "" });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    proxyPort = (proxy.address() as AddressInfo).port;
    const cur = await p.connect.projectConnect(a.row.id);
    expect(cur.enabled).toBe(false);
    expect(cur.via).toBe("new");
    expect(await p.env.setupValues(cur.setupId!)).toEqual(OLDPROJ);
    expect(await p.env.store.values(`project:${a.row.id}`)).toEqual({ WEATHER_API_KEY: "wk_keep_1" });
    expect(logs.some((l) => l.includes("moved Acme Tasks's Connect values into its own Connect app (One Connect left off)"))).toBe(true);
    // The builder-level move does not run twice.
    expect((await p.connect.list("template")).filter((x) => x.name === "Your earlier Connect app")).toHaveLength(1);
  }, 240_000);
});
