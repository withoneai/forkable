// One built in, server side: the One CLI's status and login,
// the catalog and MCP one_* tools on the turn token (through the CLI), the
// preview's dev check on each project's dev token, the sample One on the
// keyless stub, and the Access routes. Builder has no Connect app of its
// own: each project connects itself (per-project Connect, CONTRACT 18).

import type { Context, Hono } from "hono";
import {
  CatalogUnavailable,
  versionLabel,
  verbFor,
  type AccessTestResponse,
  type ActivityResponse,
  type ApiError,
  type DevCheckBody,
  type DevReportBody,
  type MeResponse,
  type OneCliResponse,
  type Platform,
  type ProjectRow,
  type VisitorsPatchBody,
  type VisitorsResponse,
} from "@builder/core";

function fail(c: Context, status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return c.json(body, status as 400);
}
const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || undefined;

export interface OneToolContext {
  projectId: string;
  turnId: string | null;
}

export function mountOne(app: Hono, p: Platform, log: (line: string) => void): void {
  // ---- the One CLI (Settings, One CLI) ---------------------------------------

  const me = async (force = false): Promise<MeResponse> => {
    const cli = await p.one.status(force);
    const usable = cli.installed && cli.signedIn;
    return { me: usable && cli.account ? { name: cli.account.name, email: cli.account.email, avatarUrl: null } : null, grant: usable ? p.one.kind : null, cli };
  };

  app.get("/api/me", async (c) => c.json(await me()));
  app.get("/api/one/cli", async (c) => {
    const body: OneCliResponse = { cli: await p.one.status(c.req.query("force") === "1") };
    return c.json(body);
  });
  app.post("/api/one/cli/refresh", async (c) => {
    const body: OneCliResponse = { cli: await p.one.status(true) };
    return c.json(body);
  });
  // Opens One's consent in the builder's browser (`one login`). Only the editor starts it.
  app.post("/api/one/cli/login", async (c) => {
    if (!c.req.header("origin")) return fail(c, 403, "editor_only", "Only the editor starts a sign-in.");
    try {
      const body: OneCliResponse = { cli: await p.one.login() };
      return c.json(body);
    } catch (err) {
      return fail(c, 409, "no_cli", (err as Error).message);
    }
  });

  // ---- one_* tools: MCP (/api/mcp/:tool) and builder-one (/api/catalog/*) --

  const tool = async (name: string, args: Record<string, unknown>, ctx: OneToolContext): Promise<{ status: number; markdown: string }> => {
    const row = await p.workspace.get(ctx.projectId);
    if (!row) return { status: 404, markdown: "No such project." };
    const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string).trim() : "");
    try {
      switch (name) {
        case "one_find_actions": {
          const platform = str("platform").toLowerCase();
          const intent = str("intent");
          if (!platform || !intent) return { status: 400, markdown: 'Give a platform slug and what you want to do: one_find_actions gmail "list my latest emails".' };
          const r = await p.catalog.find(platform, intent);
          await p.activity.record(row.id, { platform, title: `Searched ${await p.catalog.platformName(platform)} actions`, method: "GET", path: `catalog find "${intent}"`, source: "platform", status: 200, ok: true, turnId: ctx.turnId });
          return { status: 200, markdown: r.markdown };
        }
        case "one_load_action": {
          const id = str("actionId");
          if (!id) return { status: 400, markdown: "Give an actionId from one_find_actions." };
          const r = await p.catalog.load(id, str("section") || undefined);
          await p.activity.record(row.id, { platform: r.row.connectionPlatform, actionId: id, title: `Read docs: ${r.row.title}`, method: "GET", path: "catalog load", source: "platform", status: 200, ok: true, turnId: ctx.turnId });
          return { status: 200, markdown: r.markdown };
        }
        case "one_platforms": {
          const list = await p.catalog.platforms(str("query") || undefined);
          if (!list.length) return { status: 200, markdown: str("query") ? `No platform matches "${str("query")}".` : "The platform list is not available (the One CLI is not set up)." };
          return { status: 200, markdown: list.slice(0, 60).map((x) => `- ${x.platform}  ${x.name}${x.category ? `  (${x.category})` : ""}`).join("\n") + (list.length > 60 ? `\n(${list.length - 60} more; narrow with a query)` : "") };
        }
        case "one_granted": {
          const c = await p.connect.projectConnect(row.id);
          const setup = c.setupId ? await p.connect.get(c.setupId) : null;
          const sample = p.connect.sample ? " It runs on the keyless sample One; answers are sample data." : "";
          if (!c.enabled) return { status: 200, markdown: `One Connect is off for this app, so it has no One login and every one(c).run returns a local refusal (connect_off). Keep building; the builder turns it on in the project's Settings, and gets a card for it when your turn ends.${sample}` };
          return { status: 200, markdown: `One Connect is on for this app (${setup?.name ?? "its Connect app"}). Sign in with One works in preview, and calls run on the builder's own sign-in to this app: what they granted it is what runs.${sample}` };
        }
        case "one_add_action": {
          const id = str("actionId");
          if (!id) return { status: 400, markdown: "Give an actionId from one_find_actions." };
          const r = await p.scopes.add(row, id);
          await p.activity.record(row.id, { platform: r.platform, actionId: id, title: `Added ${r.wrapper.title}`, method: "GET", path: "catalog load", source: "platform", status: 200, ok: true, turnId: ctx.turnId });
          return { status: 200, markdown: r.markdown };
        }
        case "one_remove_action": {
          const id = str("actionId");
          const ok = await p.scopes.remove(row, id);
          return { status: ok ? 200 : 404, markdown: ok ? `Removed ${id} and regenerated server/one/actions.gen.ts. Remove its call sites too.` : `${id} is not installed.` };
        }
        case "one_scope_preview": {
          const r = await p.scopes.derive(row);
          const describe = await p.scopes.describe(r.manifest.actions);
          const lines = [
            r.manifest.actions.length ? `This code would ask for:\n${r.manifest.actions.map((a) => `- ${describe(a)}`).join("\n")}` : "This code asks for nothing yet.",
            r.manifest.unused.length ? `Installed, not used (left out of the ask): ${r.manifest.unused.join(", ")}` : "",
            r.issues.length ? `Problems:\n${r.issues.map((i) => `- ${i.code} ${i.file}:${i.line} ${i.message}${i.severity === "warning" ? " (warning)" : ""}`).join("\n")}` : "No manifest problems.",
          ];
          return { status: 200, markdown: lines.filter(Boolean).join("\n\n") };
        }
      }
      return { status: 404, markdown: `Unknown tool ${name}.` };
    } catch (err) {
      if (err instanceof CatalogUnavailable) return { status: err.code === "not_found" ? 404 : 503, markdown: err.message };
      log(`tool ${name}: ${(err as Error).stack ?? err}`);
      return { status: 500, markdown: `${name} failed: ${(err as Error).message}` };
    }
  };

  const CATALOG_TOOL: Record<string, string> = { find: "one_find_actions", load: "one_load_action", platforms: "one_platforms", granted: "one_granted", add: "one_add_action", remove: "one_remove_action", scopes: "one_scope_preview" };
  app.post("/api/catalog/:verb", async (c) => {
    const tok = p.turns.tokenFor(bearer(c));
    if (!tok) return fail(c, 401, "token", "The catalog only answers a running turn.");
    const name = CATALOG_TOOL[c.req.param("verb")];
    if (!name) return fail(c, 404, "no_tool", "Unknown catalog verb.");
    const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await tool(name, args, tok);
    return c.json({ markdown: r.markdown }, r.status as 200);
  });

  app.post("/api/mcp/:tool{one_[a-z_]+}", async (c) => {
    const tok = p.turns.tokenFor(bearer(c));
    if (!tok) return fail(c, 401, "token", "This tool only works while a turn runs.");
    const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await tool(c.req.param("tool"), args, tok);
    return c.text(r.markdown, r.status as 200);
  });

  // ---- the preview's dev check (each project's dev token) -------------------
  // A preview app calls One itself, on the developer's sign-in to its own
  // Connect app; these answer its dev client before and after each call.

  const devRow = async (c: Context): Promise<ProjectRow | null> => p.workspace.devOk(c.req.param("projectId")!, bearer(c));
  const versionRow = async (c: Context) => {
    const v = p.versions?.devOk(c.req.param("projectId")!, c.req.param("short")!, bearer(c));
    const row = v ? await p.workspace.get(v.projectId) : null;
    return v && row ? { v, row } : null;
  };
  const checkBody = async (c: Context): Promise<DevCheckBody | null> => {
    const b = (await c.req.json().catch(() => null)) as DevCheckBody | null;
    return b && typeof b.actionId === "string" && b.actionId ? b : null;
  };

  app.post("/api/dev/:projectId/check", async (c) => {
    const row = await devRow(c);
    if (!row) return fail(c, 401, "token", "Bad dev token.");
    const b = await checkBody(c);
    if (!b) return fail(c, 400, "bad_body", "Expected { platform, actionId, method, path, title, as? }.");
    const r = await p.gate.check(row, b);
    return c.json(r.allow ? { allow: true, level: r.level, source: r.source } : { allow: false, body: r.body }, r.allow ? 200 : (r.status as 403));
  });
  app.post("/api/dev/:projectId/report", async (c) => {
    const row = await devRow(c);
    if (!row) return fail(c, 401, "token", "Bad dev token.");
    const b = (await c.req.json().catch(() => null)) as DevReportBody | null;
    if (!b?.actionId) return fail(c, 400, "bad_body", "Expected { platform, actionId, status, ok, blockedByGrant?, ms? }.");
    await p.gate.report(row, b);
    return c.json({ ok: true });
  });
  // The shared preview callback: bind this sign-in's state to this project before the browser leaves for One.
  app.post("/api/dev/:projectId/oauth-state", async (c) => {
    const row = await devRow(c);
    if (!row) return fail(c, 401, "token", "Bad dev token.");
    const { state } = ((await c.req.json().catch(() => ({}))) ?? {}) as { state?: unknown };
    if (typeof state !== "string" || !p.connect.bindState(row.id, row.slug, state)) return fail(c, 400, "bad_state", "That is not a sign-in state.");
    return c.json({ ok: true });
  });
  // Access, Ask One: which call a ticket asks for, once.
  app.post("/api/dev/:projectId/ticket", async (c) => {
    const row = await devRow(c);
    if (!row) return fail(c, 401, "token", "Bad dev token.");
    const { ticket } = ((await c.req.json().catch(() => ({}))) ?? {}) as { ticket?: unknown };
    const t = typeof ticket === "string" ? p.access.redeem(row.id, ticket) : null;
    if (!t) return fail(c, 404, "no_ticket", "That test expired. Run it again from Access.");
    return c.json({ platform: t.platform, actionId: t.actionId, title: t.title, method: t.method, path: t.path, pathParams: t.pathParams });
  });

  // A version preview: its own manifest, and every call that is not a read refused locally (version_preview).
  app.post("/api/dev/:projectId/v/:short/check", async (c) => {
    const got = await versionRow(c);
    if (!got) return fail(c, 401, "token", "Bad dev token, or that version preview is closed.");
    const b = await checkBody(c);
    if (!b) return fail(c, 400, "bad_body", "Expected { platform, actionId, method, path, title, as? }.");
    const r = await p.gate.check(got.row, b, { version: { id: got.v.key, path: got.v.dir } });
    return c.json(r.allow ? { allow: true, level: r.level, source: r.source } : { allow: false, body: r.body }, r.allow ? 200 : (r.status as 403));
  });
  app.post("/api/dev/:projectId/v/:short/report", async (c) => {
    const got = await versionRow(c);
    if (!got) return fail(c, 401, "token", "Bad dev token, or that version preview is closed.");
    const b = (await c.req.json().catch(() => null)) as DevReportBody | null;
    if (!b?.actionId) return fail(c, 400, "bad_body", "Expected a call report.");
    await p.gate.report(got.row, b);
    return c.json({ ok: true });
  });
  app.post("/api/dev/:projectId/v/:short/oauth-state", async (c) => {
    const got = await versionRow(c);
    if (!got) return fail(c, 401, "token", "Bad dev token, or that version preview is closed.");
    const { state } = ((await c.req.json().catch(() => ({}))) ?? {}) as { state?: unknown };
    if (typeof state !== "string" || !p.connect.bindState(got.row.id, versionLabel(got.row.slug, got.v.sha), state)) return fail(c, 400, "bad_state", "That is not a sign-in state.");
    return c.json({ ok: true });
  });
  // Build errors of an older version are not the project's: accepted and dropped.
  app.post("/api/dev/:projectId/v/:short/errors", async (c) => {
    if (!(await versionRow(c))) return fail(c, 401, "token", "Bad dev token, or that version preview is closed.");
    return c.json({ ok: true });
  });

  // ---- the sample One (keyless stub only) --------------------------------------
  // A preview app on the sample source talks to this instead of One
  // (ONE_API_URL, which the platform sets only then). Off the sample: 404.

  app.all("/api/stub-one/*", async (c) => {
    if (!p.stubOne) return fail(c, 404, "not_found", "No such route.");
    const sub = c.req.path.slice("/api/stub-one/".length);
    return p.stubOne.handle(c.req.raw, sub);
  });

  // ---- Access (editor) -----------------------------------------------------

  const load = async (c: Context): Promise<ProjectRow | Response> => {
    const row = await p.workspace.get(c.req.param("id")!);
    if (!row || row.archivedAt) return fail(c, 404, "not_found", "No such project.");
    return row;
  };

  app.get("/api/projects/:id/scopes", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(await p.scopes.response(row));
  });

  // Visitors on the owner's grant: only the editor sets this (no turn token,
  // no dev token reaches it), so the agent can never turn it on.
  app.patch("/api/projects/:id/visitors", async (c) => {
    // A browser always sends Origin on a PATCH, and the /api/* guard already
    // refused any origin but the editor's. A tool call from a turn has none
    // (curl and wget are denied too). Not a boundary against code that forges
    // the header; the same honest limit as the dev token.
    if (!c.req.header("origin")) return fail(c, 403, "editor_only", "Only the editor changes who may run actions on your grant.");
    const row = await load(c);
    if (row instanceof Response) return row;
    const b = (await c.req.json().catch(() => null)) as VisitorsPatchBody | null;
    if (!b || typeof b !== "object") return fail(c, 400, "bad_body", "Expected { enabled?, allow?, disallow?, answer? }.");
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
    const visitors = await p.workspace.setVisitors(row.id, { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, allow: ids(b.allow), disallow: ids(b.disallow) });
    if (b.answer && (b.answer.choice === "allow" || b.answer.choice === "keep") && typeof b.answer.turnId === "string") {
      const turn = await p.turns.get(b.answer.turnId).catch(() => null);
      if (turn && turn.projectId === row.id) await p.turns.note(turn.id, row.id, { t: "visitors_answer", choice: b.answer.choice, actionIds: ids(b.answer.actionIds) ?? [] });
    }
    const body: VisitorsResponse = { visitors };
    return c.json(body);
  });

  app.get("/api/projects/:id/activity", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const before = Number(c.req.query("before")) || undefined;
    const page = await p.activity.list(row.id, before);
    const refusals = await p.activity.refusals(row.id);
    const { makeReceipt } = await import("@builder/core");
    const receipts = [];
    for (const r of refusals) {
      const name = await p.catalog.platformName(r.platform ?? "");
      receipts.push(makeReceipt({ platformName: name, verb: verbFor({ method: r.method ?? "POST", path: r.path ?? "", platform: r.platform ?? "" }), source: r.refusal!.source, code: r.refusal!.code, platform: r.platform ?? "", actionId: r.actionId, at: r.at }));
    }
    const body: ActivityResponse = { rows: page.rows, nextBefore: page.nextBefore, receipts };
    return c.json(body);
  });

  const accessTest = (kind: "local" | "one") => async (c: Context) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const { platform } = (await c.req.json().catch(() => ({}))) as { platform?: string };
    if (!platform) return fail(c, 400, "bad_body", "Which platform?");
    const r: AccessTestResponse = kind === "local" ? await p.access.local(row, platform) : await p.access.one(row, platform);
    return c.json(r);
  };
  app.post("/api/projects/:id/access/test-local", accessTest("local"));
  app.post("/api/projects/:id/access/test-one", accessTest("one"));

}
