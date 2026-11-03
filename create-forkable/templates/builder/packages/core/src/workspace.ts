// Projects on disk and in the DB: create from the warm
// template, rename, archive.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { applyProjectVars, cloneTemplate, isWarm, ONE_CONNECT_FILES, pruneTemplateCache, renderFiles, TEMPLATE_VERSION, warmTemplate, type PruneResult } from "@builder/template/render";
import type { HarnessId, Permission } from "@builder/harness/types";
import { BRAND, env, PORTS, previewUrl, SERVER_ORIGIN, trailer } from "./brand.js";
import type { Db } from "./db/client.js";
import { checkpoints, projects } from "./db/schema.js";
import * as git from "./git.js";
import type { Home } from "./home.js";
import { newId, newToken } from "./ids.js";
import type { ProjectSummary, VisitorGrant } from "./types.js";
import { parseVisitors, patchVisitors, type VisitorPatch } from "./visitors.js";

export type ProjectRow = typeof projects.$inferSelect;

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const STOP = new Set(
  "a an the for with to of and or in on at by me my our us we i you your it its this that please build make create want need app application website site page simple small little new some".split(
    " ",
  ),
);

/** "A task list for Acme Inc" -> "task-list-acme". */
export function slugFrom(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w));
  let s = words.slice(0, 3).join("-").slice(0, 40).replace(/-+$/, "");
  if (s.length < 3) s = `app-${s || "new"}`.slice(0, 40);
  return s;
}

/** "A task list for Acme Inc" -> "Task list Acme": the slug's words with the prompt's own casing. */
export function nameFrom(slug: string, prompt?: string): string {
  const cased = new Map<string, string>();
  for (const w of (prompt ?? "").split(/[^A-Za-z0-9]+/)) if (w && !cased.has(w.toLowerCase())) cased.set(w.toLowerCase(), w);
  const words = slug.split("-").map((w) => cased.get(w) ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toSummary(r: ProjectRow, extra: { lastShot: string | null; published: boolean }): ProjectSummary {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    path: r.path,
    previewUrl: previewUrl(r.slug),
    templateVersion: r.templateVersion,
    harness: r.harness as HarnessId,
    model: r.model,
    permission: r.permission as Permission,
    autoFix: r.autoFix,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    lastShot: extra.lastShot,
    published: extra.published,
  };
}

export { DEV_URL, devVarsText } from "./devvars.js";
import { devVarsText } from "./devvars.js";

export interface CreateOptions {
  prompt?: string;
  name?: string;
  harness: HarnessId;
  model: string | null;
  permission: Permission;
  autoFix: boolean;
  onStep?: (step: string) => void;
  log?: (line: string) => void;
}

export interface Created {
  row: ProjectRow;
  devToken: string;
  templateSha: string;
  ms: number;
}

export class Workspace {
  constructor(private db: Db, private home: Home) {}

  private warming: Promise<string> | null = null;

  /** True while this process's warm has not settled. */
  private warmPending = false;

  /** One warm at a time per process (boot and the first project used to race). */
  async ensureTemplate(log?: (line: string) => void): Promise<string> {
    if (!this.warming) {
      const wasWarm = this.templateReady();
      this.warmPending = true;
      this.warming = warmTemplate(this.home.cacheTemplate, BRAND, log ?? (() => {}));
      this.warming.then(
        () => {
          this.warmPending = false;
          // A new version just landed: the old ones can go.
          if (!wasWarm) void this.pruneTemplates(log);
        },
        () => {
          this.warmPending = false;
          this.warming = null;
        },
      );
    }
    return this.warming;
  }

  private pruning: Promise<PruneResult> | null = null;

  /**
   * Keep the current template version and the newest other one, delete the
   * rest (at boot and after a warm). Skipped while a warm runs here or in
   * another process on this cache. Projects that link natives into a
   * version that goes get copies first.
   */
  pruneTemplates(log?: (line: string) => void): Promise<PruneResult> {
    if (this.warmPending) return Promise.resolve({ removed: [], kept: [TEMPLATE_VERSION], relinked: 0, skipped: "a warm is in progress here" });
    if (this.pruning) return this.pruning;
    this.pruning = (async () => {
      try {
        const dirs = new Set<string>();
        const sub = (d: string) => (existsSync(d) ? readdirSync(d).map((n) => join(d, n)) : []);
        for (const d of sub(this.home.projects)) dirs.add(d);
        for (const s of sub(this.home.state)) for (const v of sub(join(s, "versions"))) dirs.add(v);
        for (const r of await this.db.select({ path: projects.path }).from(projects).catch(() => [] as { path: string }[])) dirs.add(r.path);
        return await pruneTemplateCache(this.home.cacheTemplate, { projectDirs: [...dirs], log });
      } catch (e) {
        return { removed: [], kept: [TEMPLATE_VERSION], relinked: 0, skipped: `prune failed: ${(e as Error).message}` };
      } finally {
        this.pruning = null;
      }
    })();
    return this.pruning;
  }

  private spareDir(): string {
    return join(this.home.projects, `.spare-${TEMPLATE_VERSION}`);
  }
  private refilling: Promise<void> | null = null;

  /** Move the spare template copy into place; false when there is none. */
  private async takeSpare(dest: string): Promise<boolean> {
    const spare = this.spareDir();
    if (this.refilling || !existsSync(join(spare, ".spare-ready"))) return false;
    // A spare cloned from a broken cache has the marker and nothing else.
    if (!existsSync(join(spare, "package.json"))) {
      rmSync(spare, { recursive: true, force: true });
      return false;
    }
    try {
      renameSync(spare, dest);
      rmSync(join(dest, ".spare-ready"), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Clone the next spare in the background (one at a time; old versions' spares go). */
  refillSpare(cache?: string): Promise<void> {
    if (this.refilling) return this.refilling;
    this.refilling = (async () => {
      // Yield first, so the finally below never runs before this assignment.
      await Promise.resolve();
      try {
        const spare = this.spareDir();
        if (existsSync(join(spare, ".spare-ready")) && existsSync(join(spare, "package.json"))) return;
        mkdirSync(this.home.projects, { recursive: true });
        for (const n of readdirSync(this.home.projects)) if (n.startsWith(".spare-") && join(this.home.projects, n) !== spare) rmSync(join(this.home.projects, n), { recursive: true, force: true });
        rmSync(spare, { recursive: true, force: true });
        await cloneTemplate(cache ?? (await this.ensureTemplate()), spare);
        writeFileSync(join(spare, ".spare-ready"), "");
      } catch {
        /* the next create clones directly */
      } finally {
        this.refilling = null;
      }
    })();
    return this.refilling;
  }

  templateReady(): boolean {
    return isWarm(join(this.home.cacheTemplate, TEMPLATE_VERSION));
  }

  async uniqueSlug(base: string): Promise<string> {
    const rows = await this.db.select({ slug: projects.slug }).from(projects);
    const taken = new Set(rows.map((r) => r.slug));
    let slug = base;
    for (let n = 2; taken.has(slug) || existsSync(join(this.home.projects, slug)); n++) slug = `${base.slice(0, 36)}-${n}`;
    return slug;
  }

  async create(o: CreateOptions): Promise<Created> {
    const t0 = Date.now();
    const step = o.onStep ?? (() => {});
    const base = slugFrom(o.name || o.prompt || "new app");
    const slug = await this.uniqueSlug(base);
    const name = o.name?.trim() || nameFrom(base, o.prompt);
    const id = newId("p");
    const dir = join(this.home.projects, slug);

    step(this.templateReady() ? "Copying template" : "Getting your first project ready, about a minute, only once");
    const cache = await this.ensureTemplate(o.log);
    step("Copying template");
    mkdirSync(this.home.projects, { recursive: true });
    // A spare copy made ahead of time turns the 2 s clone into a rename.
    if (!(await this.takeSpare(dir))) await cloneTemplate(cache, dir);
    void this.refillSpare(cache);
    await applyProjectVars(dir, { name, slug, projectId: id });

    const devToken = newToken();
    writeFileSync(join(dir, ".dev.vars"), devVarsText(id, devToken));

    step("Saving the first version");
    if (!existsSync(join(dir, ".git"))) await git.initRepo(dir);
    const who = await git.identity(dir, { name: BRAND.name, email: `${BRAND.slug}@localhost` });
    const first = await git.commitWorkingTree(
      dir,
      git.message("Template", { [trailer("Kind")]: "template", [trailer("Harness")]: null }),
      who,
    );
    if (!first) throw new Error("The template had no files to commit");

    const [row] = await this.db
      .insert(projects)
      .values({
        id,
        slug,
        name,
        path: dir,
        templateVersion: TEMPLATE_VERSION,
        harness: o.harness,
        model: o.model,
        permission: o.permission,
        autoFix: o.autoFix,
        relayTokenHash: sha256(devToken),
      })
      .returning();
    const files = readdirSync(dir).length;
    await this.db.insert(checkpoints).values({
      sha: first.sha,
      projectId: id,
      turnId: null,
      kind: "template",
      subject: "Template",
      harness: null,
      files: [],
      additions: 0,
      deletions: 0,
    });
    o.log?.(`created ${slug} (${files} entries) in ${Date.now() - t0} ms`);
    return { row: row!, devToken, templateSha: first.sha, ms: Date.now() - t0 };
  }

  async get(id: string): Promise<ProjectRow | null> {
    const [r] = await this.db.select().from(projects).where(eq(projects.id, id));
    return r ?? null;
  }

  async bySlug(slug: string): Promise<ProjectRow | null> {
    const [r] = await this.db.select().from(projects).where(and(eq(projects.slug, slug), isNull(projects.archivedAt)));
    return r ?? null;
  }

  async list(): Promise<ProjectRow[]> {
    return this.db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(desc(projects.updatedAt));
  }

  async update(id: string, patch: Partial<Pick<ProjectRow, "name" | "harness" | "model" | "permission" | "autoFix">>): Promise<ProjectRow | null> {
    const [r] = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return r ?? null;
  }

  /** Visitors on the owner's grant (off until the builder turns it on). */
  async visitors(id: string): Promise<VisitorGrant> {
    const [r] = await this.db.select({ v: projects.visitorGrant }).from(projects).where(eq(projects.id, id));
    return parseVisitors(r?.v);
  }

  /** Only the editor's own routes call this, never a turn or the relay. */
  async setVisitors(id: string, patch: VisitorPatch): Promise<VisitorGrant> {
    const next = patchVisitors(await this.visitors(id), patch);
    await this.db.update(projects).set({ visitorGrant: next }).where(eq(projects.id, id));
    return next;
  }

  async touch(id: string): Promise<void> {
    await this.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
  }

  async archive(id: string, deleteFiles: boolean): Promise<void> {
    const r = await this.get(id);
    if (!r) return;
    await this.db
      .update(projects)
      .set({ archivedAt: new Date(), slug: `${r.slug}~${Date.now().toString(36)}` })
      .where(eq(projects.id, id));
    if (deleteFiles && r.path.startsWith(this.home.projects + "/")) rmSync(r.path, { recursive: true, force: true });
  }

  /**
   * An older project still calls the retired preview relay from its
   * platform-owned One files (server/one/*, the connect components, the One
   * skills). Render the current ones over them and keep it as its own
   * version, so the app connects itself. Code the agent wrote is untouched.
   * Returns the files written, or null when the project is current.
   */
  async upgradeOneConnect(row: ProjectRow, commit: (files: string[]) => Promise<void>): Promise<string[] | null> {
    const client = join(row.path, "server", "one", "client.ts");
    if (!existsSync(client)) return null;
    const text = readFileSync(client, "utf8");
    if (!text.includes(`${env("RELAY_URL")}`) && !text.includes("RELAY_URL")) return null;
    const files = await renderFiles(row.path, BRAND, ONE_CONNECT_FILES);
    await commit(files);
    return files;
  }

  /** Dev token check (stored hashed; the column keeps its old relay name). */
  async devOk(projectId: string, token: string | undefined): Promise<ProjectRow | null> {
    if (!token) return null;
    const r = await this.get(projectId);
    return r && !r.archivedAt && r.relayTokenHash === sha256(token) ? r : null;
  }

  /** The dev token is needed to (re)start the dev server; it lives only in the project's .dev.vars (older projects: the relay line). */
  devToken(row: ProjectRow): string {
    try {
      const text = readFileSync(join(row.path, ".dev.vars"), "utf8");
      const m = text.match(new RegExp(`^${env("DEV_TOKEN")}=(.+)$`, "m")) ?? text.match(new RegExp(`^${env("RELAY_TOKEN")}=(.+)$`, "m"));
      return m?.[1]?.trim() ?? "";
    } catch {
      return "";
    }
  }
}

export const PREVIEW_PORT = PORTS.proxy;
