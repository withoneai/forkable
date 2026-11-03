// Per-project One Connect: each
// app connects itself. A project's Settings has One Connect, off by default.
// When on, the app's login is Sign in with One on its own Connect app, and
// preview calls run on the developer's own sign-in to that app.
//
// A Connect app is made in the One dashboard (the CLI has no Connect-app
// verb and the oauth-clients API is dashboard-only), so Builder keeps each
// one it is given as a setup: a row here (name, kind, owner) and its values
// in the environment store, write-only (scope connect:<id>, the Keychain
// first). Three ways a project gets one:
//   new       a setup made for this project (it owns it)
//   template  a saved setup, linked by reference (or copied)
//   project   another project's own setup, linked by reference (or copied)
// Every setup works for every project's preview with one registered
// redirect URI, the proxy's shared callback (PREVIEW_CALLBACK): the app
// registers its OAuth state here before it sends the browser to One, and the
// proxy sends the callback on to exactly that project.

import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { ConnectSetupInfo, ProjectConnectBody } from "./api-types.js";
import { env, PREVIEW_CALLBACK, SERVER_ORIGIN } from "./brand.js";
import type { Db } from "./db/client.js";
import { connectSetups, projects } from "./db/schema.js";
import { EnvInvalid, type EnvService } from "./envservice.js";
import { CONNECT_VAR_NAMES } from "./envvars.js";
import { newId } from "./ids.js";
import type { ConnectVia, ProjectConnect } from "./types.js";

type SetupRow = typeof connectSetups.$inferSelect;

export const CONNECT_OFF: ProjectConnect = { enabled: false, setupId: null, via: null };

export function parseProjectConnect(v: unknown): ProjectConnect {
  if (!v || typeof v !== "object") return { ...CONNECT_OFF };
  const o = v as Record<string, unknown>;
  const via = o.via === "new" || o.via === "template" || o.via === "project" ? (o.via as ConnectVia) : null;
  const setupId = typeof o.setupId === "string" && o.setupId ? o.setupId : null;
  return { enabled: o.enabled === true && Boolean(setupId), setupId, via: setupId ? via : null };
}

export class ConnectRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/** A sign-in in flight: the OAuth state one preview registered, and where its callback goes. */
interface PendingState {
  projectId: string;
  /** The preview host label: the project's slug, or <slug>--v-<short> for a version preview. */
  label: string;
  at: number;
}

const STATE_TTL = 10 * 60_000;
const STATE_MAX = 2000;
/** The package's state: base64url, 16 to 128 characters. */
const STATE = /^[A-Za-z0-9_-]{16,128}$/;

export const SAMPLE_SETUP_NAME = "Acme sample Connect app";

export interface ConnectSetupsOptions {
  db: Db;
  env: EnvService;
  /** The keyless sample: a stub One answers sign-in and calls, nothing leaves this computer. */
  sample: boolean;
  log?: (line: string) => void;
}

export class ConnectSetups {
  private states = new Map<string, PendingState>();

  constructor(private o: ConnectSetupsOptions) {}

  get sample(): boolean {
    return this.o.sample;
  }

  // ---- setups ----------------------------------------------------------------

  async get(id: string): Promise<SetupRow | null> {
    const [r] = await this.o.db.select().from(connectSetups).where(eq(connectSetups.id, id)).limit(1);
    return r ?? null;
  }

  async list(kind?: "project" | "template"): Promise<SetupRow[]> {
    const q = this.o.db.select().from(connectSetups);
    return kind ? q.where(eq(connectSetups.kind, kind)).orderBy(asc(connectSetups.createdAt)) : q.orderBy(asc(connectSetups.createdAt));
  }

  async create(o: { name: string; kind: "project" | "template"; ownerProjectId?: string | null; sample?: boolean }): Promise<SetupRow> {
    const name = o.name.trim().slice(0, 80) || "Connect app";
    const [r] = await this.o.db
      .insert(connectSetups)
      .values({ id: newId("cs"), name, kind: o.kind, ownerProjectId: o.ownerProjectId ?? null, sample: o.sample ?? false })
      .returning();
    return r!;
  }

  async rename(id: string, name: string): Promise<SetupRow> {
    const n = name.trim().slice(0, 80);
    if (!n) throw new ConnectRefused("Give it a name.", "bad_name", 400);
    const [r] = await this.o.db.update(connectSetups).set({ name: n, updatedAt: new Date() }).where(eq(connectSetups.id, id)).returning();
    if (!r) throw new ConnectRefused("No such Connect app.", "not_found", 404);
    return r;
  }

  async touch(id: string): Promise<void> {
    await this.o.db.update(connectSetups).set({ updatedAt: new Date() }).where(eq(connectSetups.id, id));
  }

  /** Projects that point at a setup (on or off), archived ones left out. */
  async usedBy(id: string): Promise<{ id: string; name: string; slug: string; enabled: boolean }[]> {
    const rows = await this.o.db.select({ id: projects.id, name: projects.name, slug: projects.slug, c: projects.oneConnect }).from(projects).where(isNull(projects.archivedAt));
    return rows.filter((r) => parseProjectConnect(r.c).setupId === id).map((r) => ({ id: r.id, name: r.name, slug: r.slug, enabled: parseProjectConnect(r.c).enabled }));
  }

  /** Delete a setup and its values. Refused while a project links to it. */
  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new ConnectRefused("No such Connect app.", "not_found", 404);
    const used = await this.usedBy(id);
    if (used.length) throw new ConnectRefused(`${used.length === 1 ? `${used[0]!.name} uses` : `${used.length} projects use`} this Connect app. Point ${used.length === 1 ? "it" : "them"} at another one first.`, "in_use");
    await this.o.env.dropSetup(id);
    await this.o.db.delete(connectSetups).where(eq(connectSetups.id, id));
    this.o.log?.(`connect: removed setup ${id}`);
  }

  async info(row: SetupRow): Promise<ConnectSetupInfo> {
    let ownerName: string | null = null;
    if (row.ownerProjectId) {
      const [p] = await this.o.db.select({ name: projects.name }).from(projects).where(eq(projects.id, row.ownerProjectId)).limit(1);
      ownerName = p?.name ?? null;
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === "template" ? "template" : "project",
      ownerProjectId: row.ownerProjectId,
      ownerProjectName: ownerName,
      sample: row.sample,
      vars: this.o.env.setupStatus(row.id),
      configured: this.o.env.setupConfigured(row.id),
      usedBy: await this.usedBy(row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Save a copy of a setup as a template (values copied inside this process, never returned). */
  async saveAsTemplate(fromId: string, name: string): Promise<SetupRow> {
    const from = await this.get(fromId);
    if (!from) throw new ConnectRefused("No such Connect app.", "not_found", 404);
    if (!this.o.env.setupConfigured(fromId)) throw new ConnectRefused("Add the client ID, client secret and connect key first, then save it as a template.", "not_configured");
    const t = await this.create({ name: name || from.name, kind: "template", sample: from.sample });
    await this.o.env.copySetup(fromId, t.id);
    this.o.log?.(`connect: saved setup ${fromId} as template ${t.id}`);
    return t;
  }

  // ---- a project's One Connect -------------------------------------------------

  async projectConnect(projectId: string): Promise<ProjectConnect> {
    const [r] = await this.o.db.select({ c: projects.oneConnect }).from(projects).where(eq(projects.id, projectId)).limit(1);
    return parseProjectConnect(r?.c);
  }

  private async write(projectId: string, c: ProjectConnect): Promise<ProjectConnect> {
    const next = parseProjectConnect(c);
    await this.o.db.update(projects).set({ oneConnect: next, updatedAt: new Date() }).where(eq(projects.id, projectId));
    return next;
  }

  /** The project's own setup, made on first use ("New Connect app"). */
  async ownSetup(projectId: string, projectName: string): Promise<SetupRow> {
    const [mine] = await this.o.db
      .select()
      .from(connectSetups)
      .where(and(eq(connectSetups.ownerProjectId, projectId), eq(connectSetups.kind, "project")))
      .orderBy(asc(connectSetups.createdAt))
      .limit(1);
    return mine ?? this.create({ name: `${projectName} Connect app`, kind: "project", ownerProjectId: projectId });
  }

  /**
   * The editor's choices (PUT /api/projects/:id/connect). Turning on needs a
   * configured setup; linking never copies a value, copying never shows one.
   */
  async apply(project: { id: string; name: string }, b: ProjectConnectBody): Promise<ProjectConnect> {
    const cur = await this.projectConnect(project.id);
    if ("use" in b) {
      if (b.use === "none") return this.write(project.id, { ...CONNECT_OFF });
      if (b.use === "new") {
        const own = await this.ownSetup(project.id, project.name);
        if (b.name?.trim()) await this.rename(own.id, b.name);
        return this.write(project.id, { enabled: false, setupId: own.id, via: "new" });
      }
      if (b.use === "project" && b.projectId === project.id) throw new ConnectRefused("Pick another project.", "same_project", 400);
      const from = b.use === "template" ? await this.get(b.setupId) : await this.projectSetup(b.projectId);
      if (!from || (b.use === "template" && from.kind !== "template")) throw new ConnectRefused(b.use === "template" ? "No such template." : "That project has no Connect app of its own.", "not_found", 404);
      if (!this.o.env.setupConfigured(from.id)) throw new ConnectRefused(`${from.name} is missing its client ID, secret or connect key. Finish it first.`, "not_configured");
      if (b.copy) {
        const own = await this.ownSetup(project.id, project.name);
        await this.o.env.copySetup(from.id, own.id);
        await this.touch(own.id);
        return this.write(project.id, { enabled: true, setupId: own.id, via: "new" });
      }
      return this.write(project.id, { enabled: true, setupId: from.id, via: b.use });
    }
    if ("enabled" in b) {
      if (b.enabled && !cur.setupId) throw new ConnectRefused("Pick a Connect app first: a new one, a template or another project's.", "no_setup", 409);
      if (b.enabled && !this.o.env.setupConfigured(cur.setupId!)) throw new ConnectRefused("Add the client ID, client secret and connect key first.", "not_configured", 409);
      return this.write(project.id, { ...cur, enabled: b.enabled });
    }
    return cur;
  }

  /** A project's own setup, for "Use the one from another project". */
  async projectSetup(projectId: string): Promise<SetupRow | null> {
    const c = await this.projectConnect(projectId);
    if (c.setupId) {
      const s = await this.get(c.setupId);
      if (s) return s;
    }
    const [mine] = await this.o.db.select().from(connectSetups).where(and(eq(connectSetups.ownerProjectId, projectId), eq(connectSetups.kind, "project"))).limit(1);
    return mine ?? null;
  }

  /** Other projects with a configured Connect app of their own, newest first. */
  async others(projectId: string): Promise<{ projectId: string; name: string; slug: string; setup: SetupRow }[]> {
    const rows = await this.o.db.select({ id: projects.id, name: projects.name, slug: projects.slug, c: projects.oneConnect }).from(projects).where(and(isNull(projects.archivedAt), ne(projects.id, projectId)));
    const out: { projectId: string; name: string; slug: string; setup: SetupRow }[] = [];
    for (const r of rows) {
      const c = parseProjectConnect(r.c);
      if (!c.setupId) continue;
      const s = await this.get(c.setupId);
      if (!s || s.kind !== "project" || s.ownerProjectId !== r.id || !this.o.env.setupConfigured(s.id)) continue;
      out.push({ projectId: r.id, name: r.name, slug: r.slug, setup: s });
    }
    return out;
  }

  /** A project went away: its own setup goes too, unless another project links to it (then it stays, unowned). */
  async dropProject(projectId: string): Promise<void> {
    const mine = await this.o.db.select().from(connectSetups).where(eq(connectSetups.ownerProjectId, projectId));
    for (const s of mine) {
      const used = (await this.usedBy(s.id)).filter((u) => u.id !== projectId);
      if (used.length) await this.o.db.update(connectSetups).set({ ownerProjectId: null, updatedAt: new Date() }).where(eq(connectSetups.id, s.id));
      else {
        await this.o.env.dropSetup(s.id);
        await this.o.db.delete(connectSetups).where(eq(connectSetups.id, s.id));
      }
    }
  }

  // ---- what the app is given -------------------------------------------------

  /**
   * The variables a project's preview Worker gets (through the dev server's
   * own env, never a file): One Connect on, the app's Connect app, the shared
   * preview callback, and on the sample the stub One's address. Off: only
   * ONE_MODE=off, so the app has no One login and no One calls.
   */
  async previewEnv(projectId: string): Promise<Record<string, string>> {
    const c = await this.projectConnect(projectId);
    if (!c.enabled || !c.setupId) return { ONE_MODE: "off" };
    const v = await this.o.env.setupValues(c.setupId);
    if (!v.ONE_CLIENT_ID || !v.ONE_CLIENT_SECRET || !v.ONE_CONNECT_KEY) return { ONE_MODE: "off" };
    const out: Record<string, string> = {
      ONE_MODE: "connect",
      ONE_CLIENT_ID: v.ONE_CLIENT_ID,
      ONE_CLIENT_SECRET: v.ONE_CLIENT_SECRET,
      ONE_CONNECT_KEY: v.ONE_CONNECT_KEY,
      ONE_REDIRECT_URI: PREVIEW_CALLBACK,
    };
    if (v.ONE_PERMISSION_SET) out.ONE_PERMISSION_SET = v.ONE_PERMISSION_SET;
    if (this.o.sample) {
      out.ONE_API_URL = `${SERVER_ORIGIN}/api/stub-one`;
      out[env("ONE_SAMPLE")] = "1";
    }
    this.o.env.noteLoaded(projectId, v);
    return out;
  }

  /** The Connect app values a publish sends to Vercel (secrets as sensitive). Null when One Connect is off. */
  async publishValues(projectId: string): Promise<{ setupName: string; values: Record<string, string> } | null> {
    const c = await this.projectConnect(projectId);
    if (!c.enabled || !c.setupId) return null;
    const row = await this.get(c.setupId);
    if (!row) return null;
    const v = await this.o.env.setupValues(c.setupId);
    this.o.env.noteLoaded(projectId, v);
    return { setupName: row.name, values: Object.fromEntries(Object.entries(v).filter(([k]) => CONNECT_VAR_NAMES.includes(k))) };
  }

  // ---- the shared preview callback --------------------------------------------

  /**
   * A preview app is about to send the browser to One with this state: bind
   * it to the project (and preview host) the dev token proved. One use, ten
   * minutes. The callback host is never taken from the request.
   */
  bindState(projectId: string, label: string, state: string): boolean {
    if (!STATE.test(state)) return false;
    const now = Date.now();
    for (const [k, v] of this.states) if (now - v.at > STATE_TTL) this.states.delete(k);
    if (this.states.size >= STATE_MAX) this.states.delete(this.states.keys().next().value!);
    if (this.states.has(state) && this.states.get(state)!.projectId !== projectId) return false;
    this.states.set(state, { projectId, label, at: now });
    return true;
  }

  /** The shared callback: which preview this state belongs to, once. Null for unknown, used or expired. */
  takeState(state: string | null): PendingState | null {
    if (!state || !STATE.test(state)) return null;
    const hit = this.states.get(state);
    if (!hit) return null;
    this.states.delete(state);
    return Date.now() - hit.at > STATE_TTL ? null : hit;
  }

  // ---- the sample stand-in and the move from the builder-level app ---------------

  /** The keyless sample's template: made once per home, fake values, labeled Sample everywhere. */
  async ensureSample(): Promise<SetupRow | null> {
    if (!this.o.sample) return null;
    const [have] = await this.o.db.select().from(connectSetups).where(and(eq(connectSetups.sample, true), eq(connectSetups.kind, "template"))).limit(1);
    if (have && this.o.env.setupConfigured(have.id)) return have;
    const row = have ?? (await this.create({ name: SAMPLE_SETUP_NAME, kind: "template", sample: true }));
    await this.o.env.saveSetup(row.id, {
      ONE_CLIENT_ID: "acme-sample-client",
      ONE_CLIENT_SECRET: `one_secret_sample_${randomBytes(18).toString("hex")}`,
      ONE_CONNECT_KEY: `sk_live_sample_${randomBytes(18).toString("hex")}`,
    });
    return row;
  }

  /** The setup whose client id this is (the stub One checks its own fake credentials). Sample only. */
  async byClientId(clientId: string): Promise<{ row: SetupRow; values: Record<string, string> } | null> {
    if (!this.o.sample) return null;
    for (const row of await this.list()) {
      const v = await this.o.env.setupValues(row.id);
      if (v.ONE_CLIENT_ID === clientId) return { row, values: v };
    }
    return null;
  }

  /** The setup whose connect key this is (the stub One's key-mode calls). Sample only. */
  async byConnectKey(key: string): Promise<{ row: SetupRow; values: Record<string, string> } | null> {
    if (!this.o.sample || !key) return null;
    for (const row of await this.list()) {
      const v = await this.o.env.setupValues(row.id);
      if (v.ONE_CONNECT_KEY === key) return { row, values: v };
    }
    return null;
  }

  /**
   * Once per home: the retired builder-level Connect app (BUILDER_HOME/.env
   * or the Keychain) becomes a template, and Connect values a project kept
   * among its app values become that project's own setup (left off). Names
   * are logged, values never.
   */
  async migrate(projectIds: { id: string; name: string }[]): Promise<string[]> {
    const notes: string[] = [];
    try {
      const legacy = await this.o.env.legacyBuilderValues();
      const keep = Object.fromEntries(Object.entries(legacy).filter(([k]) => CONNECT_VAR_NAMES.includes(k)));
      if (keep.ONE_CLIENT_ID) {
        const t = await this.create({ name: "Your earlier Connect app", kind: "template" });
        await this.o.env.saveSetup(t.id, keep);
        await this.o.env.dropLegacyBuilder([...Object.keys(legacy).filter((k) => CONNECT_VAR_NAMES.includes(k) || k === "ONE_REDIRECT_URI")]);
        notes.push(`moved the builder-level Connect app into the template "${t.name}"`);
      }
    } catch (err) {
      if (!(err instanceof EnvInvalid)) throw err;
      notes.push(`left the builder-level Connect app where it was: ${err.message}`);
    }
    for (const p of projectIds) {
      const v = await this.o.env.legacyProjectConnect(p.id).catch(() => ({}) as Record<string, string>);
      if (!Object.keys(v).length) continue;
      const cur = await this.projectConnect(p.id);
      if (!cur.setupId) {
        const own = await this.ownSetup(p.id, p.name);
        try {
          await this.o.env.saveSetup(own.id, v);
          await this.write(p.id, { enabled: false, setupId: own.id, via: "new" });
          notes.push(`moved ${p.name}'s Connect values into its own Connect app (One Connect left off)`);
        } catch (err) {
          notes.push(`${p.name}: ${(err as Error).message}`);
          continue;
        }
      }
      await this.o.env.dropLegacyProjectConnect(p.id, Object.keys(v));
    }
    for (const n of notes) this.o.log?.(`connect: ${n}`);
    return notes;
  }
}
