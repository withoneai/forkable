// HTTP routes (docs/CONTRACT.md section 9).

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { Hono, type Context } from "hono";
import {
  adoptStaged,
  applyDirectEdits,
  BRAND,
  contentTypeOf,
  isAttachmentName,
  projectAttachmentsDir,
  saveAttachment,
  stagedDir,
  stagedExisting,
  sweepStaged,
  deferredPrompt,
  editSubject,
  git,
  PORTS,
  previewUrl,
  readSettings,
  SERVER_ORIGIN,
  DEV_URL,
  toSummary,
  validateAppName,
  VERSION,
  writeSettings,
  type ApiError,
  type CreateProjectBody,
  type CreateTurnBody,
  type DevServerErrorBody,
  type EditsBody,
  type EditsResponse,
  type FileEntry,
  type Platform,
  type Project,
  type ProjectEvent,
  type ProjectPatch,
  type ProjectRow,
  type Settings,
  type VersionResponse,
} from "@builder/core";
import type { HarnessId, HarnessInfo, Permission } from "@builder/harness/types";
import type { Hub } from "./hub.js";
import { mountOne } from "./one.js";
import { mountPublish } from "./publish.js";
import { mountEnv } from "./env.js";

export interface AppDeps {
  platform: Platform;
  hub: Hub;
  detect: (force?: boolean) => Promise<HarnessInfo[]>;
  log: (line: string) => void;
}

const EDITOR_ORIGINS = new Set([
  SERVER_ORIGIN,
  `http://localhost:${PORTS.server}`,
  `http://127.0.0.1:${PORTS.uiDev}`,
  `http://localhost:${PORTS.uiDev}`,
]);

const HARNESS_IDS: HarnessId[] = ["claude-code", "codex", "openclaw", "replay"];
const PERMISSIONS: Permission[] = ["build", "plan", "full"];

function fail(c: Context, status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return c.json(body, status as 400);
}

const bearer = (c: Context): string | undefined => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || undefined;

/** A project-relative path that stays inside the project; null otherwise. */
function safePath(root: string, rel: string | undefined): string | null {
  if (!rel) return null;
  const clean = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^\/+/, "");
  const abs = resolve(root, clean);
  if (!abs.startsWith(root + "/")) return null;
  if (/(^|\/)\.git(\/|$)/.test(clean) || /(^|\/)node_modules(\/|$)/.test(clean)) return null;
  return abs;
}

const GENERATED = /(^|\/)actions\.gen\.ts$/;

export function createApp(d: AppDeps): Hono {
  const { platform: p, hub } = d;
  const app = new Hono();

  // Editor routes refuse other origins (a preview app in the browser must not drive the editor).
  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    const tokenRoute =
      path.startsWith("/api/dev/") || path.startsWith("/api/relay/") || path.startsWith("/api/stub-one/") || path.startsWith("/api/catalog/") || path.startsWith("/api/mcp/") || /^\/api\/turns\/[^/]+\/steer$/.test(path) || path === "/api/health";
    if (!tokenRoute) {
      const origin = c.req.header("origin");
      if (origin && !EDITOR_ORIGINS.has(origin)) return fail(c, 403, "origin", "This API only answers the editor.");
    }
    await next();
  });

  // One built in: the One CLI, catalog and one_* tools, the preview's dev check, the sample One, Access.
  mountOne(app, p, d.log);
  // Publish: scan, GitHub, Vercel, history.
  mountPublish(app, p, d.log);
  // Environment (CONTRACT 16, 18): each project's One Connect, the templates, and each app's values, write-only.
  mountEnv(app, {
    platform: p,
    hub,
    log: d.log,
    restartPreview: (row) => {
      if (p.devservers && p.devservers.state(row.id).state !== "stopped") void p.devservers.restart({ id: row.id, path: row.path, devUrl: DEV_URL(row.id), devToken: p.workspace.devToken(row) });
    },
  });

  const harnessesCache: { at: number; list: HarnessInfo[] | null } = { at: 0, list: null };
  const harnesses = async (force = false) => {
    if (!force && harnessesCache.list && Date.now() - harnessesCache.at < 60_000) return harnessesCache.list;
    harnessesCache.list = await d.detect(force);
    harnessesCache.at = Date.now();
    return harnessesCache.list;
  };
  // Probe the agents once at boot so Home has them by the time it asks.
  void harnesses().catch(() => {});
  const defaultHarness = async (): Promise<HarnessId | null> => {
    const s = readSettings(p.home);
    const list = await harnesses();
    if (s.defaultHarness && list.some((h) => h.id === s.defaultHarness && h.bin)) return s.defaultHarness;
    const ready = list.filter((h) => h.bin && h.id !== "replay");
    return (ready.find((h) => h.signedIn !== false && h.status === "ready") ?? ready[0] ?? list.find((h) => h.id === "replay"))?.id ?? null;
  };

  const projectOf = async (row: ProjectRow): Promise<Project> => {
    const [cps, active, openErrs] = await Promise.all([p.checkpoints.list(row.id), p.turns.active(row.id), p.errors.countOpen(row.id)]);
    const published = cps.some((c) => c.published.length > 0);
    const ds = p.devservers?.state(row.id) ?? { state: "stopped" as const, step: null, port: null, message: null };
    return {
      ...toSummary(row, { lastShot: cps.find((c) => c.shot)?.shot ?? null, published }),
      devPort: row.devPort,
      preview: ds.state,
      previewStep: ds.step,
      activeTurnId: active?.id ?? null,
      openErrors: openErrs,
    };
  };
  const load = async (c: Context): Promise<ProjectRow | Response> => {
    const row = await p.workspace.get(c.req.param("id")!);
    if (!row || row.archivedAt) return fail(c, 404, "not_found", "No such project.");
    return row;
  };
  const devTarget = (row: ProjectRow) => ({ id: row.id, path: row.path, devUrl: DEV_URL(row.id), devToken: p.workspace.devToken(row) });

  app.get("/api/health", (c) => c.json({ ok: true, name: BRAND.name, version: VERSION, ports: { server: PORTS.server, proxy: PORTS.proxy }, home: p.home.root }));

  app.get("/api/harnesses", async (c) => {
    const list = await harnesses(c.req.query("force") === "1");
    return c.json({ harnesses: list, defaultId: await defaultHarness() });
  });

  // A pending prompt's images are staged files; only the ones still on disk.
  const settingsOut = () => {
    const s = readSettings(p.home);
    return s.pendingImages?.length ? { ...s, pendingImages: stagedExisting(p.home, s.pendingImages) } : s;
  };
  app.get("/api/settings", (c) =>
    c.json({
      settings: settingsOut(),
      paths: { home: p.home.root, projects: p.home.projects, db: p.home.db, cache: join(p.home.root, "cache") },
      ports: { server: PORTS.server, proxy: PORTS.proxy, devRange: [PORTS.devMin, PORTS.devMax] },
    }),
  );
  app.patch("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<Settings>;
    const allowed: (keyof Settings)[] = ["defaultHarness", "defaultModel", "defaultPermission", "autoFix", "theme", "size", "pendingPrompt", "pendingImages"];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k as keyof Settings))) as Partial<Settings>;
    if (patch.defaultPermission && !PERMISSIONS.includes(patch.defaultPermission)) return fail(c, 400, "bad_permission", "Unknown permission level.");
    if (patch.pendingImages !== undefined) patch.pendingImages = patch.pendingImages ? stagedExisting(p.home, patch.pendingImages) : null;
    writeSettings(p.home, patch);
    harnessesCache.at = 0;
    return c.json({
      settings: settingsOut(),
      paths: { home: p.home.root, projects: p.home.projects, db: p.home.db, cache: join(p.home.root, "cache") },
      ports: { server: PORTS.server, proxy: PORTS.proxy, devRange: [PORTS.devMin, PORTS.devMax] },
    });
  });

  // ---- projects ----------------------------------------------------------

  app.get("/api/projects", async (c) => {
    const rows = await p.workspace.list();
    const projects = await Promise.all(
      rows.map(async (r) => {
        const cps = await p.checkpoints.list(r.id);
        return toSummary(r, { lastShot: cps.find((x) => x.shot)?.shot ?? null, published: cps.some((x) => x.published.length > 0) });
      }),
    );
    return c.json({ projects });
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as CreateProjectBody;
    const settings = readSettings(p.home);
    const harness = body.harness ?? (await defaultHarness());
    if (!harness || !HARNESS_IDS.includes(harness)) return fail(c, 400, "no_harness", "No coding agent found. Install Claude Code or Codex, then try again.");
    const permission = body.permission ?? settings.defaultPermission;
    const prompt = body.prompt?.trim();
    if (!prompt && !body.name?.trim()) return fail(c, 400, "empty", "Describe what to build, or give the project a name.");
    const created = await p.workspace.create({
      prompt,
      name: body.name,
      harness,
      model: body.model ?? (harness === settings.defaultHarness ? settings.defaultModel : null),
      permission,
      autoFix: settings.autoFix,
      log: d.log,
    });
    if (settings.pendingPrompt || settings.pendingImages?.length) writeSettings(p.home, { pendingPrompt: null, pendingImages: null });
    void p.devservers?.ensure(devTarget(created.row));
    // Images attached on Home were staged; they move into the project before the first turn.
    const images = prompt ? adoptStaged(p.home, created.row.path, body.images) : [];
    const turn = prompt ? await p.turns.submit(created.row, { prompt, images, kind: body.mode === "plan" ? "plan" : "user" }) : null;
    return c.json({ project: await projectOf(created.row), turn }, 201);
  });

  app.get("/api/projects/:id", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json({ project: await projectOf(row) });
  });

  app.patch("/api/projects/:id", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => ({}))) as ProjectPatch;
    const patch: Partial<ProjectRow> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
    if (body.harness) {
      if (!HARNESS_IDS.includes(body.harness)) return fail(c, 400, "bad_harness", "Unknown coding agent.");
      patch.harness = body.harness;
      if (body.model === undefined && body.harness !== row.harness) patch.model = null;
    }
    if (body.model !== undefined) patch.model = body.model;
    if (body.permission) {
      if (!PERMISSIONS.includes(body.permission)) return fail(c, 400, "bad_permission", "Unknown permission level.");
      patch.permission = body.permission;
    }
    if (typeof body.autoFix === "boolean") patch.autoFix = body.autoFix;
    const next = await p.workspace.update(row.id, patch);
    const project = await projectOf(next!);
    hub.emit(row.id, { type: "project.updated", project });
    return c.json({ project });
  });

  app.delete("/api/projects/:id", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    await p.versions?.stop(row.id);
    await p.devservers?.stop(row.id);
    await p.workspace.archive(row.id, c.req.query("deleteFiles") === "1");
    if (c.req.query("deleteFiles") === "1") {
      await p.env.dropProject(row.id).catch(() => {});
      await p.connect.dropProject(row.id).catch(() => {});
    }
    return c.body(null, 204);
  });

  // ---- turns -------------------------------------------------------------

  app.post("/api/projects/:id/turns", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => ({}))) as CreateTurnBody;
    if (!body.prompt?.trim()) return fail(c, 400, "empty", "Type what you want changed.");
    const images = (body.images ?? []).filter(isAttachmentName).map((f) => join(projectAttachmentsDir(row.path), f)).filter((f) => existsSync(f));
    const turn = await p.turns.submit(row, { prompt: body.prompt.trim(), selections: body.selections ?? [], images, kind: body.mode === "plan" ? "plan" : "user" });
    return c.json({ turn }, 202);
  });

  // Images for the composer (paste, drop, attach). Stored in the project's
  // ignored .builder/attachments; the harness reads them by path.
  app.post("/api/projects/:id/attachments", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const r = saveAttachment(projectAttachmentsDir(row.path), c.req.header("content-type") ?? "", Buffer.from(await c.req.arrayBuffer()));
    if (!r.ok) return fail(c, r.status, r.code, r.message);
    return c.json({ file: r.file, url: `/api/projects/${row.id}/attachments/${r.file}` }, 201);
  });

  const sendImage = (c: Context, dir: string) => {
    const file = c.req.param("file");
    if (!isAttachmentName(file)) return fail(c, 400, "bad_file", "No such image.");
    const abs = join(dir, file);
    if (!existsSync(abs)) return fail(c, 404, "not_found", "No such image.");
    return new Response(readFileSync(abs), { headers: { "content-type": contentTypeOf(file), "cache-control": "private, max-age=3600" } });
  };
  app.get("/api/projects/:id/attachments/:file", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return sendImage(c, projectAttachmentsDir(row.path));
  });

  // Images attached on Home, before a project exists: staged in the home's
  // state dir, moved into the project by POST /api/projects {images}.
  app.post("/api/attachments", async (c) => {
    sweepStaged(p.home, readSettings(p.home).pendingImages ?? []);
    const r = saveAttachment(stagedDir(p.home), c.req.header("content-type") ?? "", Buffer.from(await c.req.arrayBuffer()));
    if (!r.ok) return fail(c, r.status, r.code, r.message);
    return c.json({ file: r.file, url: `/api/attachments/${r.file}` }, 201);
  });
  app.get("/api/attachments/:file", (c) => sendImage(c, stagedDir(p.home)));
  app.delete("/api/attachments/:file", (c) => {
    const file = c.req.param("file");
    if (!isAttachmentName(file)) return fail(c, 400, "bad_file", "No such image.");
    rmSync(join(stagedDir(p.home), file), { force: true });
    return c.body(null, 204);
  });

  // Direct edits from the preview: the AST-safe ones become one
  // checkpoint now, the rest (and comments) go to the agent as one turn.
  app.post("/api/projects/:id/edits", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => ({}))) as EditsBody;
    const edits = (body.edits ?? []).filter((e) => e && typeof e.loc === "string").slice(0, 100);
    if (!edits.length) return fail(c, 400, "empty", "Nothing to apply.");
    if (await p.turns.active(row.id)) return fail(c, 409, "turn_running", "The agent is working. Apply your edits when this step ends.");
    const manual = await p.checkpoints.manualEdits(row.id, row.path);
    if (manual) await p.turns.record(row, "manual", "Manual edits", manual.sha);
    const r = applyDirectEdits(row.path, edits);
    let checkpoint = null;
    if (r.files.length) {
      checkpoint = await p.checkpoints.commit(row.id, row.path, { subject: editSubject(r.applied), kind: "edit", turnId: null, harness: null, sessionId: null });
      if (checkpoint) await p.turns.record(row, "edit", editSubject(r.applied), checkpoint.sha);
    }
    const turn = r.deferred.length ? await p.turns.submit(row, { prompt: deferredPrompt(r.deferred), selections: [] }) : null;
    const out: EditsResponse = { applied: r.applied.length, deferred: r.deferred.map((d) => ({ loc: d.edit.loc, kind: d.edit.kind, reason: d.reason })), checkpoint, turn };
    return c.json(out);
  });

  app.get("/api/projects/:id/turns", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(await p.turns.list(row.id, c.req.query("before") || undefined));
  });

  app.get("/api/projects/:id/turns/:turnId/events", async (c) => {
    const after = Number(c.req.query("after") ?? 0) || 0;
    return c.json({ events: await p.turns.events(c.req.param("turnId"), after) });
  });

  app.post("/api/projects/:id/turns/:turnId/cancel", async (c) => {
    const turn = await p.turns.cancel(c.req.param("turnId"));
    if (!turn) return fail(c, 404, "not_found", "No such turn.");
    return c.json({ turn });
  });

  app.post("/api/projects/:id/turns/:turnId/steer", async (c) => {
    const { text } = (await c.req.json().catch(() => ({}))) as { text?: string };
    if (!text?.trim()) return fail(c, 400, "empty", "Type a message.");
    const ok = p.turns.steer(c.req.param("turnId"), text.trim());
    if (!ok) return fail(c, 409, "not_running", "That step already ended. Send it as a new message.");
    return c.json({ queued: true });
  });

  // Claude's PostToolUse hook, on the turn token.
  app.get("/api/turns/:turnId/steer", (c) => {
    const tok = p.turns.tokenFor(bearer(c));
    if (!tok || tok.turnId !== c.req.param("turnId")) return fail(c, 401, "token", "Bad turn token.");
    return c.json({ text: p.turns.claimSteer(tok.turnId) });
  });

  app.get("/api/projects/:id/events", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return hub.subscribe(c, row.id, async () => {
      const out: ProjectEvent[] = [];
      const ds = p.devservers?.state(row.id);
      if (ds) out.push({ type: "preview.status", state: ds.state, step: ds.step, message: ds.message });
      const v = p.versions?.get(row.id);
      if (v) out.push({ type: "version.status", sha: v.sha, state: v.state, step: v.step, message: v.message });
      for (const t of await p.turns.running(row.id)) {
        out.push({ type: "turn.started", turn: t });
        for (const e of await p.turns.events(t.id)) out.push({ type: "turn.event", turnId: t.id, seq: e.seq, event: e.event, at: e.at });
        out.push({ type: "turn.status", turnId: t.id, status: t.status, fixAttempt: t.fixAttempt });
      }
      return out;
    });
  });

  // ---- files -------------------------------------------------------------

  app.get("/api/projects/:id/files", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const r = await git.runGit(row.path, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    const files = [...new Set(r.stdout.split("\0").filter(Boolean))].filter((f) => existsSync(join(row.path, f))).sort();
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const entries: FileEntry[] = [
      ...[...dirs].sort().map((path) => ({ path, type: "dir" as const })),
      ...files.map((path) => ({ path, type: "file" as const, size: statSync(join(row.path, path)).size, generated: GENERATED.test(path) || undefined })),
    ];
    return c.json({ files: entries });
  });

  app.get("/api/projects/:id/file", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const rel = c.req.query("path");
    const abs = safePath(row.path, rel);
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return fail(c, 404, "not_found", "No such file.");
    const buf = readFileSync(abs);
    const binary = buf.subarray(0, 8000).includes(0);
    const tooLarge = binary || buf.length > 1024 * 1024;
    return c.json({ path: rel, content: tooLarge ? "" : buf.toString("utf8"), generated: GENERATED.test(rel!), tooLarge: tooLarge || undefined });
  });

  app.put("/api/projects/:id/file", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; content?: string };
    const abs = safePath(row.path, body.path);
    if (!abs || typeof body.content !== "string") return fail(c, 400, "bad_path", "That path is outside the project.");
    if (GENERATED.test(body.path!)) return fail(c, 400, "generated", "This file is generated from One's catalog. Change the actions instead.");
    if (/(^|\/)\.dev\.vars$|(^|\/)\.env/.test(body.path!)) return fail(c, 400, "secret_file", "This file is managed by the platform.");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body.content);
    await p.workspace.touch(row.id);
    if (!(await p.turns.active(row.id))) void p.turns.typecheck(row, null).catch(() => {});
    return c.json({ path: body.path, content: body.content, generated: false });
  });

  // ---- checkpoints -------------------------------------------------------

  app.post("/api/projects/:id/checkpoint", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    if (await p.turns.active(row.id)) return fail(c, 409, "busy", "Wait for the agent to finish, then save a version.");
    const checkpoint = await p.checkpoints.manualEdits(row.id, row.path);
    if (checkpoint) await p.turns.record(row, "manual", "Manual edits", checkpoint.sha);
    return c.json({ checkpoint });
  });

  app.get("/api/projects/:id/checkpoints", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json({ checkpoints: await p.checkpoints.list(row.id) });
  });

  app.get("/api/projects/:id/checkpoints/:sha/diff", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const cp = await p.checkpoints.get(row.id, c.req.param("sha"));
    if (!cp) return fail(c, 404, "not_found", "No such version.");
    return c.json({ sha: cp.sha, files: await p.checkpoints.diff(row.path, cp.sha) });
  });

  app.post("/api/projects/:id/checkpoints/:sha/restore", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    if (await p.turns.active(row.id)) return fail(c, 409, "busy", "Wait for the agent to finish, then restore.");
    try {
      const checkpoint = await p.checkpoints.restore(row.id, row.path, c.req.param("sha"));
      await p.turns.record(row, "restore", checkpoint.subject.replace(/^Restore to/, "Restored to"), checkpoint.sha);
      await p.workspace.touch(row.id);
      void p.turns.typecheck(row, null).catch(() => {});
      return c.json({ checkpoint });
    } catch (err) {
      return fail(c, 400, "restore", (err as Error).message);
    }
  });

  app.post("/api/projects/:id/checkpoints/:sha/bookmark", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const { on } = (await c.req.json().catch(() => ({}))) as { on?: boolean };
    const checkpoint = await p.checkpoints.bookmark(row.id, c.req.param("sha"), on !== false);
    if (!checkpoint) return fail(c, 404, "not_found", "No such version.");
    return c.json({ checkpoint });
  });

  // ---- Preview this version ------------------------------
  // A checkpoint on its own dev port and host. Never changes HEAD, the index
  // or the working tree; never commits; its own fresh database; writes on the
  // builder's grant refused locally (version_preview).

  const versionBody = (row: ProjectRow): VersionResponse => ({ version: p.versions?.get(row.id) ?? null });
  app.get("/api/projects/:id/version", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json(versionBody(row));
  });
  app.post("/api/projects/:id/checkpoints/:sha/preview", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    if (!p.versions) return fail(c, 400, "previews_off", "Previews are off in this mode.");
    try {
      const version = await p.versions.start(row, c.req.param("sha"));
      const body: VersionResponse = { version };
      return c.json(body, 201);
    } catch (err) {
      return fail(c, 404, "not_found", (err as Error).message);
    }
  });
  app.post("/api/projects/:id/version/viewed", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    p.versions?.viewed(row.id);
    return c.body(null, 204);
  });
  app.delete("/api/projects/:id/version", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    await p.versions?.stop(row.id);
    return c.body(null, 204);
  });

  // ---- errors and preview ------------------------------------------------

  app.get("/api/projects/:id/errors", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    return c.json({ errors: await p.errors.list(row.id, c.req.query("open") === "1") });
  });

  app.post("/api/projects/:id/fix", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const body = (await c.req.json().catch(() => ({}))) as { errorIds?: string[] };
    return c.json({ turn: await p.turns.fixNow(row, body.errorIds) }, 202);
  });

  app.post("/api/projects/:id/preview/restart", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    if (p.devservers) void p.devservers.restart(devTarget(row));
    return c.json({ project: await projectOf(row) });
  });

  app.post("/api/projects/:id/preview/viewed", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    if (p.devservers) {
      p.devservers.viewed(row.id);
      if (p.devservers.state(row.id).state === "stopped") void p.devservers.ensure(devTarget(row));
    }
    return c.body(null, 204);
  });

  app.get("/api/projects/:id/shots/:file", async (c) => {
    const row = await load(c);
    if (row instanceof Response) return row;
    const file = c.req.param("file");
    if (!/^[\w.-]+\.png$/.test(file)) return fail(c, 400, "bad_file", "Bad file name.");
    const abs = join(row.path, BRAND.projectDir, "shots", file);
    if (!existsSync(abs)) return fail(c, 404, "not_found", "No such screenshot.");
    return new Response(readFileSync(abs), { headers: { "content-type": "image/png", "cache-control": "private, max-age=31536000, immutable" } });
  });

  // ---- build errors from the dev tagger (dev token) ----------------------
  // /api/relay/... is the path older projects' dev tagger still posts to.

  const devErrors = async (c: Context) => {
    const row = await p.workspace.devOk(c.req.param("projectId")!, bearer(c));
    if (!row) return fail(c, 401, "token", "Bad dev token.");
    const body = (await c.req.json().catch(() => null)) as DevServerErrorBody | null;
    if (!body) return fail(c, 400, "bad_body", "Expected an error body.");
    if (body.clear) {
      await p.errors.resolveAll(row.id, ["build"]);
      hub.emit(row.id, { type: "preview.hmr", ok: true });
      return c.json({ ok: true });
    }
    await p.errors.record(row.id, row.path, { source: body.source === "server" ? "server" : "build", message: body.message, file: body.file, line: body.line, col: body.col, stack: body.stack });
    hub.emit(row.id, { type: "preview.hmr", ok: false, message: body.message.split("\n")[0] });
    return c.json({ ok: true });
  };
  app.post("/api/dev/:projectId/errors", devErrors);
  app.post("/api/relay/:projectId/errors", devErrors);

  // ---- MCP tools (turn token) -------------------------------------------

  app.post("/api/mcp/:tool", async (c) => {
    const tok = p.turns.tokenFor(bearer(c));
    if (!tok) return fail(c, 401, "token", "This tool only works while a turn runs.");
    const row = await p.workspace.get(tok.projectId);
    if (!row) return fail(c, 404, "not_found", "No such project.");
    const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tool = c.req.param("tool");
    if (tool === "project_errors") {
      const errs = await p.errors.open(row.id);
      if (!errs.length) return c.text("No open errors.");
      return c.text(errs.map((e) => `[${e.source}] ${e.file ? `${e.file}${e.line ? `:${e.line}` : ""} ` : ""}${e.message}`).join("\n\n"));
    }
    if (tool === "project_add_dependency") {
      const name = String(args.name ?? "").trim();
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[\w.^~<>=*|-]+)?$/i.test(name)) return fail(c, 400, "bad_name", "That is not an npm package name.");
      const at = name.lastIndexOf("@");
      const [pkg, range] = at > 0 ? [name.slice(0, at), name.slice(at + 1)] : [name, "latest"];
      const pj = JSON.parse(readFileSync(join(row.path, "package.json"), "utf8")) as Record<string, Record<string, string>>;
      const field = args.dev ? "devDependencies" : "dependencies";
      pj[field] = { ...(pj[field] ?? {}), [pkg]: range === "latest" ? "*" : range };
      writeFileSync(join(row.path, "package.json"), `${JSON.stringify(pj, null, 2)}\n`);
      const ok = await p.turns.install(null, row);
      if (ok && range === "latest") {
        // Pin what was installed so the version is reproducible.
        try {
          const installed = JSON.parse(readFileSync(join(row.path, "node_modules", pkg, "package.json"), "utf8")) as { version: string };
          pj[field]![pkg] = `^${installed.version}`;
          writeFileSync(join(row.path, "package.json"), `${JSON.stringify(pj, null, 2)}\n`);
        } catch {
          /* keep * */
        }
      }
      return c.text(ok ? `Added ${pkg} to ${field}.` : `Installing ${pkg} failed. See project_errors.`, ok ? 200 : 500);
    }
    if (tool === "project_env") {
      // Names and set or missing, never a value. A request is shown to the builder at the end of the turn.
      const reqs = Array.isArray(args.request) ? (args.request as unknown[]).slice(0, 10) : [];
      const asked: string[] = [];
      for (const r of reqs) {
        const name = typeof (r as { name?: unknown })?.name === "string" ? (r as { name: string }).name.trim() : "";
        const why = typeof (r as { why?: unknown })?.why === "string" ? (r as { why: string }).why.trim() : "";
        if (validateAppName(name).level === "error") return c.text(`${/^[A-Z][A-Z0-9_]{0,63}$/.test(name) ? `${name}: ${validateAppName(name).message}` : "Names are capital letters, digits and underscores, starting with a letter."}`, 400);
        p.turns.requestEnv(tok.turnId, name, why || "The app reads it.");
        asked.push(name);
      }
      const { vars } = p.env.projectStatus(row);
      const lines = vars.map((v) => `- ${v.name}: ${v.present ? "set" : "missing"}${v.target === "publish" ? " (published app only)" : ""}${v.sites[0] ? `, read at ${v.sites[0].file}:${v.sites[0].line}` : ""}`);
      return c.text(
        [
          lines.length ? `Environment (values never reach you):\n${lines.join("\n")}` : "No environment variables yet.",
          asked.length ? `Asked the builder for ${asked.join(", ")}. A card with a secure input appears at the end of this turn. Tell them in your reply which value to set and where they get it. Never ask them to paste a value in chat.` : "To ask for a value, call project_env with request: [{name, why}].",
        ].join("\n\n"),
      );
    }
    if (tool === "project_screenshot") {
      if (!p.verifier || !p.devservers) return c.text("Screenshots are off in this mode.", 400);
      await p.devservers.ensure(devTarget(row));
      const path = String(args.path ?? "/");
      const shot = join(row.path, BRAND.projectDir, "shots", `mcp-${Date.now().toString(36)}.png`);
      const r = await p.verifier.check(previewUrl(row.slug, path), shot);
      return c.text([`Screenshot: ${r.shot ?? "not taken"}`, r.errors.length ? `Errors seen:\n${r.errors.map((e) => `- ${e.message}`).join("\n")}` : "No errors seen."].join("\n"));
    }
    return fail(c, 404, "no_tool", "Unknown tool.");
  });

  app.notFound((c) => (c.req.path.startsWith("/api/") ? fail(c, 404, "not_found", "No such route.") : c.text("Not found", 404)));
  app.onError((err, c) => {
    d.log(`error ${c.req.method} ${c.req.path}: ${err.stack ?? err}`);
    return fail(c, 500, "server", "Something went wrong on the server. The log has the details.");
  });
  return app;
}
