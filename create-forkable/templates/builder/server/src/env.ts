// Environment routes (docs/CONTRACT.md sections 16 and 18): each project's
// One Connect (its Connect app, made new, linked from a template or another
// project, or copied), the saved templates, and each project's app values.
// Write-only: no route returns a value, and request bodies are never logged.
// Every change needs the editor's Origin, a loopback Host (no DNS
// rebinding) and the per-process CSRF token.

import type { Context, Hono } from "hono";
import {
  BRAND,
  CONNECT_REDIRECT_URI,
  ConnectRefused,
  EnvInvalid,
  ONE_DASHBOARD_URL,
  PORTS,
  SERVER_ORIGIN,
  previewUrl,
  redirectUriFor,
  validateAppName,
  type ApiError,
  type ConnectSetupResponse,
  type ConnectTemplatesResponse,
  type EnvInvalidBody,
  type Platform,
  type ProjectConnectBody,
  type ProjectConnectResponse,
  type ProjectEnvResponse,
  type ProjectRow,
  type VercelPublishResult,
} from "@builder/core";
import type { Hub } from "./hub.js";

export const CSRF_HEADER = `x-${BRAND.slug}-csrf`;

const EDITOR_ORIGINS = new Set([SERVER_ORIGIN, `http://localhost:${PORTS.server}`, `http://127.0.0.1:${PORTS.uiDev}`, `http://localhost:${PORTS.uiDev}`]);
const LOOPBACK_HOSTS = new Set([`127.0.0.1:${PORTS.server}`, `localhost:${PORTS.server}`, `127.0.0.1:${PORTS.uiDev}`, `localhost:${PORTS.uiDev}`]);

function fail(c: Context, status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  c.header("cache-control", "no-store");
  return c.json(body, status as 400);
}

function invalid(c: Context, e: EnvInvalid): Response {
  const body: EnvInvalidBody = { error: { code: "invalid", message: e.message }, fields: e.fields };
  c.header("cache-control", "no-store");
  return c.json(body, 400);
}

export interface EnvDeps {
  platform: Platform;
  hub: Hub;
  log: (line: string) => void;
  /** Restart a running preview so it picks up new values. */
  restartPreview: (row: ProjectRow) => void;
}

export function mountEnv(app: Hono, d: EnvDeps): void {
  const p = d.platform;

  // Every env route: a loopback Host, so a page that rebinds its own name to 127.0.0.1 reads nothing.
  app.use("/api/env/*", async (c, next) => {
    if (!LOOPBACK_HOSTS.has(c.req.header("host") ?? "")) return fail(c, 403, "host", "This API only answers on this computer's own address.");
    await next();
    c.header("cache-control", "no-store");
  });
  app.use("/api/projects/:id/env", async (c, next) => {
    if (!LOOPBACK_HOSTS.has(c.req.header("host") ?? "")) return fail(c, 403, "host", "This API only answers on this computer's own address.");
    await next();
    c.header("cache-control", "no-store");
  });
  app.use("/api/projects/:id/env/*", async (c, next) => {
    if (!LOOPBACK_HOSTS.has(c.req.header("host") ?? "")) return fail(c, 403, "host", "This API only answers on this computer's own address.");
    await next();
    c.header("cache-control", "no-store");
  });
  for (const path of ["/api/connect/*", "/api/projects/:id/connect", "/api/projects/:id/connect/*"]) {
    app.use(path, async (c, next) => {
      if (!LOOPBACK_HOSTS.has(c.req.header("host") ?? "")) return fail(c, 403, "host", "This API only answers on this computer's own address.");
      await next();
      c.header("cache-control", "no-store");
    });
  }

  /** A change: the editor's Origin (a browser always sends it on PUT, POST and DELETE) and the CSRF token. */
  const guard = (c: Context): Response | null => {
    const origin = c.req.header("origin");
    if (!origin || !EDITOR_ORIGINS.has(origin)) return fail(c, 403, "editor_only", `Only the ${BRAND.name} editor on this computer changes these values.`);
    if (c.req.header(CSRF_HEADER) !== p.env.csrf) return fail(c, 403, "csrf", "This page is out of date. Reload it and try again.");
    return null;
  };

  /** {values: {NAME: "..."}}, strings only, at most 40 names. */
  const readValues = async (c: Context): Promise<Record<string, string> | Response> => {
    const b = (await c.req.json().catch(() => null)) as { values?: unknown } | null;
    const v = b?.values;
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail(c, 400, "bad_body", "Send {values: {NAME: value}}.");
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 40) return fail(c, 400, "too_many", "At most 40 values at once.");
    const out: Record<string, string> = {};
    for (const [k, val] of entries) {
      if (typeof val !== "string") return fail(c, 400, "bad_body", `${/^[A-Z][A-Z0-9_]{0,63}$/.test(k) ? k : "A value"} is not text.`);
      out[k] = val;
    }
    return out;
  };

  // ---- One Connect: setups (templates and each project's own) -----------------

  const refused = (c: Context, e: unknown): Response => {
    if (e instanceof EnvInvalid) return invalid(c, e);
    if (e instanceof ConnectRefused) return fail(c, e.status, e.code, e.message);
    d.log(`connect: ${(e as Error).name}: ${(e as Error).message}`);
    return fail(c, 500, "store", "Could not store the values. Nothing was saved.");
  };

  /** Preview servers that run on a setup restart, so a changed value takes effect. */
  const restartUsers = async (setupId: string) => {
    for (const u of await p.connect.usedBy(setupId)) {
      const row = await p.workspace.get(u.id);
      if (row && u.enabled) d.restartPreview(row);
    }
  };

  const templatesResponse = async (): Promise<ConnectTemplatesResponse> => {
    const all = await p.connect.list();
    const infos = await Promise.all(all.map((r) => p.connect.info(r)));
    return {
      templates: infos.filter((x) => x.kind === "template"),
      projectSetups: infos.filter((x) => x.kind === "project"),
      redirectUri: CONNECT_REDIRECT_URI,
      store: p.env.storeInfo("connect:new"),
      dashboardUrl: ONE_DASHBOARD_URL,
      csrf: p.env.csrf,
      sample: p.connect.sample,
    };
  };
  const setupOut = async (c: Context, id: string): Promise<Response> => {
    const row = await p.connect.get(id);
    if (!row) return fail(c, 404, "not_found", "No such Connect app.");
    const body: ConnectSetupResponse = { setup: await p.connect.info(row) };
    return c.json(body);
  };

  app.get("/api/connect/templates", async (c) => c.json(await templatesResponse()));

  /** A new template: {name, values?} (made in the dashboard first), or {name, fromSetupId} to save a copy of one. */
  app.post("/api/connect/templates", async (c) => {
    const g = guard(c);
    if (g) return g;
    const b = (await c.req.json().catch(() => null)) as { name?: unknown; values?: unknown; fromSetupId?: unknown } | null;
    const name = typeof b?.name === "string" ? b.name : "";
    try {
      if (typeof b?.fromSetupId === "string") {
        const t = await p.connect.saveAsTemplate(b.fromSetupId, name);
        return setupOut(c, t.id);
      }
      const values = b?.values && typeof b.values === "object" && !Array.isArray(b.values) ? Object.fromEntries(Object.entries(b.values as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
      if (Object.keys(values).length) await p.env.checkSetup(null, values).then((r) => {
        const bad = r.items.filter((i) => i.level === "error");
        if (bad.length) throw new EnvInvalid(`Check ${bad.map((i) => i.name).join(", ")}.`, Object.fromEntries(bad.map((i) => [i.name, i.message])));
      });
      const t = await p.connect.create({ name: name || "Connect app", kind: "template" });
      if (Object.keys(values).length) await p.env.saveSetup(t.id, values);
      return setupOut(c, t.id);
    } catch (err) {
      return refused(c, err);
    }
  });

  app.patch("/api/connect/setups/:sid", async (c) => {
    const g = guard(c);
    if (g) return g;
    const b = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    try {
      await p.connect.rename(c.req.param("sid"), typeof b?.name === "string" ? b.name : "");
    } catch (err) {
      return refused(c, err);
    }
    return setupOut(c, c.req.param("sid"));
  });

  app.delete("/api/connect/setups/:sid", async (c) => {
    const g = guard(c);
    if (g) return g;
    try {
      await p.connect.remove(c.req.param("sid"));
    } catch (err) {
      return refused(c, err);
    }
    return c.json(await templatesResponse());
  });

  app.put("/api/connect/setups/:sid/env", async (c) => {
    const g = guard(c);
    if (g) return g;
    const sid = c.req.param("sid");
    if (!(await p.connect.get(sid))) return fail(c, 404, "not_found", "No such Connect app.");
    const values = await readValues(c);
    if (values instanceof Response) return values;
    try {
      await p.env.saveSetup(sid, values);
      await p.connect.touch(sid);
    } catch (err) {
      return refused(c, err);
    }
    await restartUsers(sid);
    return setupOut(c, sid);
  });

  app.delete("/api/connect/setups/:sid/env/:name", async (c) => {
    const g = guard(c);
    if (g) return g;
    const sid = c.req.param("sid");
    if (!(await p.connect.get(sid))) return fail(c, 404, "not_found", "No such Connect app.");
    try {
      await p.env.removeSetupVar(sid, c.req.param("name"));
      await p.connect.touch(sid);
    } catch (err) {
      return refused(c, err);
    }
    await restartUsers(sid);
    return setupOut(c, sid);
  });

  // Check takes the typed (unsaved) values too, so it can run before Save. A POST, so it is guarded like a change.
  const typedValues = async (c: Context): Promise<Record<string, string>> => {
    const b = (await c.req.json().catch(() => ({}))) as { values?: Record<string, unknown> };
    return Object.fromEntries(Object.entries(b.values ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  };
  app.post("/api/connect/setups/:sid/check", async (c) => {
    const g = guard(c);
    if (g) return g;
    const sid = c.req.param("sid");
    if (!(await p.connect.get(sid))) return fail(c, 404, "not_found", "No such Connect app.");
    return c.json(await p.env.checkSetup(sid, await typedValues(c)));
  });
  app.post("/api/connect/check", async (c) => {
    const g = guard(c);
    if (g) return g;
    return c.json(await p.env.checkSetup(null, await typedValues(c)));
  });

  // ---- One Connect for one project ------------------------------------------------

  const connectOut = async (row: ProjectRow): Promise<ProjectConnectResponse> => {
    const connect = await p.connect.projectConnect(row.id);
    const setupRow = connect.setupId ? await p.connect.get(connect.setupId) : null;
    const setup = setupRow ? await p.connect.info(setupRow) : null;
    const templates = await Promise.all((await p.connect.list("template")).map((r) => p.connect.info(r)));
    const others = await Promise.all((await p.connect.others(row.id)).map(async (o) => ({ projectId: o.projectId, name: o.name, slug: o.slug, setup: await p.connect.info(o.setup) })));
    const { manifest } = await p.scopes.derive(row).catch(() => ({ manifest: { version: 1 as const, actions: [], unused: [] } }));
    const platforms = [...new Set(manifest.actions.map((a) => a.platform))];
    const last = (await p.publish.list(row.id).catch(() => [])).find((x) => x.target === "vercel" && x.status === "ok");
    const deployed = (last?.result as VercelPublishResult | null)?.redirectUri ?? null;
    return {
      connect,
      setup,
      owned: Boolean(setupRow && setupRow.kind === "project" && setupRow.ownerProjectId === row.id),
      ready: Boolean(setup?.configured),
      redirectUris: { preview: CONNECT_REDIRECT_URI, production: deployed ?? redirectUriFor(row.slug), productionSource: deployed ? "deployed" : "planned" },
      templates,
      others,
      usesOne: await Promise.all(platforms.map(async (x) => ({ platform: x, name: await p.catalog.platformName(x) }))),
      previewSignIn: previewUrl(row.slug, "/api/one/authorize"),
      store: p.env.storeInfo(setupRow ? `connect:${setupRow.id}` : "connect:new"),
      dashboardUrl: ONE_DASHBOARD_URL,
      csrf: p.env.csrf,
      sample: p.connect.sample,
    };
  };

  app.get("/api/projects/:id/connect", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(await connectOut(row));
  });

  // Only the editor changes a project's One Connect (Origin, CSRF): a turn has neither.
  app.put("/api/projects/:id/connect", async (c) => {
    const g = guard(c);
    if (g) return g;
    const row = await load(c);
    if (row instanceof Response) return row;
    const b = (await c.req.json().catch(() => null)) as ProjectConnectBody | null;
    if (!b || typeof b !== "object") return fail(c, 400, "bad_body", "Expected {enabled}, {use}, or {answer}.");
    const before = await p.connect.projectConnect(row.id);
    try {
      if ("use" in b || "enabled" in b) await p.connect.apply(row, b);
    } catch (err) {
      return refused(c, err);
    }
    // The turn-end card ("This app uses Gmail. Turn on One Connect for it?") records the answer.
    const answer = "answer" in b ? b.answer : undefined;
    if (answer && typeof answer.turnId === "string") {
      const turn = await p.turns.get(answer.turnId).catch(() => null);
      const after = await p.connect.projectConnect(row.id);
      if (turn && turn.projectId === row.id) await p.turns.note(turn.id, row.id, { t: "connect_answer", choice: after.enabled ? "on" : "later" });
    }
    const after = await p.connect.projectConnect(row.id);
    if (before.enabled !== after.enabled || before.setupId !== after.setupId) d.restartPreview(row);
    return c.json(await connectOut(row));
  });

  /** Save this project's Connect app as a template (a copy; the project keeps its own). */
  app.post("/api/projects/:id/connect/save-template", async (c) => {
    const g = guard(c);
    if (g) return g;
    const row = await load(c);
    if (row instanceof Response) return row;
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const cur = await p.connect.projectConnect(row.id);
    if (!cur.setupId) return fail(c, 409, "no_setup", "This project has no Connect app to save yet.");
    try {
      const t = await p.connect.saveAsTemplate(cur.setupId, typeof b.name === "string" ? b.name : "");
      return setupOut(c, t.id);
    } catch (err) {
      return refused(c, err);
    }
  });

  // ---- per project ----------------------------------------------------------

  const load = async (c: Context): Promise<ProjectRow | Response> => {
    const row = await p.workspace.get(c.req.param("id")!);
    if (!row || row.archivedAt) return fail(c, 404, "not_found", "No such project.");
    return row;
  };
  const projectResponse = async (row: ProjectRow): Promise<ProjectEnvResponse> => {
    const manifest = await p.scopes.derive(row).then((r) => r.manifest).catch(() => null);
    const st = p.env.projectStatus(row, manifest);
    return { ...st, store: p.env.storeInfo(`project:${row.id}`), csrf: p.env.csrf };
  };

  app.get("/api/projects/:id/env", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(await projectResponse(row));
  });

  app.put("/api/projects/:id/env", async (c) => {
    const g = guard(c);
    if (g) return g;
    const row = await load(c);
    if (row instanceof Response) return row;
    const values = await readValues(c);
    if (values instanceof Response) return values;
    try {
      await p.env.saveProject(row.id, values);
    } catch (err) {
      if (err instanceof EnvInvalid) return invalid(c, err);
      d.log(`env: saving ${row.slug}'s values failed: ${(err as Error).name}`);
      return fail(c, 500, "store", "Could not store the values. Nothing was saved.");
    }
    d.hub.emit(row.id, { type: "env.changed", names: Object.keys(values) });
    d.restartPreview(row);
    return c.json(await projectResponse(row));
  });

  app.delete("/api/projects/:id/env/:name", async (c) => {
    const g = guard(c);
    if (g) return g;
    const row = await load(c);
    if (row instanceof Response) return row;
    const name = c.req.param("name");
    if (validateAppName(name).level === "error" && !p.env.store.has(`project:${row.id}`, name)) return fail(c, 400, "bad_name", "No such variable.");
    await p.env.removeProject(row.id, name);
    d.hub.emit(row.id, { type: "env.changed", names: [name] });
    d.restartPreview(row);
    return c.json(await projectResponse(row));
  });
}
