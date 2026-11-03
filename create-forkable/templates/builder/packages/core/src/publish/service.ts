// Publish: the scan, GitHub export and Vercel deploy, on the
// builder's own One account through the One CLI (or the sample source).
// Every catalog call is one action run and one Activity row with source
// "platform". The app's own Connect app (per-project Connect) goes to
// Vercel with it: the client id and ask id plain, the secret and connect key
// as sensitive variables. Nothing publishes while a turn runs. Progress goes out on the bus as
// publish.progress, the end as publish.done; the row in `publishes` keeps
// the result, the steps and the options worth reusing (never a token).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type {
  GitHubPublishOptions,
  GitHubPublishResult,
  PublishBody,
  PublishesResponse,
  PublishRecord,
  PublishStep,
  PublishTarget,
  ScanResult,
  VercelPublishOptions,
  VercelPublishResult,
} from "../api-types.js";
import type { ActivityLedger } from "../activity.js";
import { BRAND } from "../brand.js";
import type { Bus } from "../bus.js";
import type { CatalogService } from "../catalog/service.js";
import type { Checkpoints } from "../checkpoints.js";
import type { ConnectSetups } from "../connect.js";
import type { OneSource } from "../onesource.js";
import type { Db } from "../db/client.js";
import { publishes } from "../db/schema.js";
import * as git from "../git.js";
import type { Home } from "../home.js";
import type { ProjectRef, ScopeService } from "../scopes/service.js";
import type { Manifest, VisitorGrant } from "../types.js";
import { VISITORS_OFF } from "../visitors.js";
import { isSecretName } from "../envvars.js";
import type { EnvService } from "../envservice.js";
import { GITHUB_CONN_DEF, VERCEL_CONN_DEF, type PublishAction } from "./actions.js";
import { materialize, uploadSet } from "./files.js";
import { exportToGitHub, PublishError, type ActionRunner, type RunAnswer } from "./github.js";
import { runScan } from "./scan.js";
import { checkDatabaseUrl, deployToVercel, looksSecret, redirectUriFor } from "./vercel.js";

type Row = typeof publishes.$inferSelect;

export class PublishRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
    readonly scan: ScanResult | null = null,
  ) {
    super(message);
  }
}

export interface PublishDeps {
  db: Db;
  bus: Bus;
  home: Home;
  /** The builder's own One: the One CLI, or the sample stub. */
  source: OneSource;
  /** Each project's own Connect app. */
  connect: ConnectSetups;
  catalog: CatalogService;
  scopes: ScopeService;
  activity: ActivityLedger;
  checkpoints: Checkpoints;
  activeTurn: (projectId: string) => Promise<{ id: string; status: string } | null>;
  /** The builder's visitor setting (off when absent). */
  visitors?: (projectId: string) => Promise<VisitorGrant>;
  /** Reads a published app's /api/one/health on the live grant (the stub answers it on the sample grant). */
  fetchHealth?: (url: string) => Promise<unknown>;
  /** pnpm audit --prod during the scan (needs the network; off in the demo and tests). */
  audit?: boolean;
  /** Vercel status polling interval. */
  pollMs?: number;
  pnpm?: () => Promise<string | null>;
  log?: (line: string) => void;
  /** The project's Environment values for the published app (sent to Vercel as sensitive variables). */
  env?: Pick<EnvService, "projectValues"> | null;
}

export function toPublishRecord(r: Row): PublishRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    target: r.target as PublishTarget,
    sha: r.sha,
    shortSha: r.sha.slice(0, 7),
    status: r.status as PublishRecord["status"],
    url: r.url,
    repo: r.repo,
    manifestHash: r.manifestHash,
    scan: (r.scan as unknown as ScanResult | null) ?? null,
    result: (r.result as unknown as PublishRecord["result"]) ?? null,
    options: (r.options as PublishRecord["options"]) ?? null,
    steps: (r.steps as unknown as PublishStep[] | null) ?? [],
    error: r.error,
    grant: (r.grant as PublishRecord["grant"]) ?? null,
    at: r.at.toISOString(),
  };
}

async function defaultHealth(url: string): Promise<unknown> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/one/health`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`health answered ${res.status}`);
  return res.json();
}

export class PublishService {
  private scans = new Map<string, ScanResult>();
  private running = new Map<string, Promise<PublishRecord>>();

  constructor(private d: PublishDeps) {
    // The Access tab's diff reads "against the published one" once there is one.
    d.scopes.lastPublishedOf = (p) => this.lastPublishedManifest(p);
  }

  private emit(projectId: string, target: PublishTarget | "scan", publishId: number | null, step: string, status: PublishStep["status"], detail?: string | null) {
    this.d.bus.emit(projectId, { type: "publish.progress", target, publishId, step, status, detail: detail ?? null });
  }

  async list(projectId: string, limit = 30): Promise<PublishRecord[]> {
    const rows = await this.d.db.select().from(publishes).where(eq(publishes.projectId, projectId)).orderBy(desc(publishes.id)).limit(limit);
    return rows.map(toPublishRecord);
  }

  async get(id: number): Promise<PublishRecord | null> {
    const [r] = await this.d.db.select().from(publishes).where(eq(publishes.id, id)).limit(1);
    return r ? toPublishRecord(r) : null;
  }

  private async lastOk(projectId: string, target?: PublishTarget): Promise<PublishRecord | null> {
    const where = target ? and(eq(publishes.projectId, projectId), eq(publishes.status, "ok"), eq(publishes.target, target)) : and(eq(publishes.projectId, projectId), eq(publishes.status, "ok"));
    const [r] = await this.d.db.select().from(publishes).where(where).orderBy(desc(publishes.id)).limit(1);
    return r ? toPublishRecord(r) : null;
  }

  /** scopes.json at the sha of the last successful publish. */
  async lastPublishedManifest(p: ProjectRef): Promise<Manifest | null> {
    const last = await this.lastOk(p.id);
    if (!last) return null;
    const text = await git.showFile(p.path, last.sha, `${BRAND.projectDir}/scopes.json`).catch(() => null);
    return text ? (JSON.parse(text) as Manifest) : { version: 1, actions: [], unused: [] };
  }

  private async head(p: ProjectRef): Promise<{ sha: string; shortSha: string; subject: string } | null> {
    const sha = await git.headCommit(p.path);
    if (!sha) return null;
    const cp = await this.d.checkpoints.get(p.id, sha);
    const subject = cp?.subject ?? (await git.runGit(p.path, ["log", "-1", "--format=%s", sha])).stdout.trim();
    return { sha, shortSha: sha.slice(0, 7), subject };
  }

  private async resolveSha(p: ProjectRef, sha?: string): Promise<{ sha: string; subject: string | null }> {
    if (sha) {
      const r = await git.runGit(p.path, ["rev-parse", "--verify", "-q", `${sha}^{commit}`]);
      if (!r.ok) throw new PublishRefused("That version is not in this project's history.", "bad_sha", 404);
      const full = r.stdout.trim();
      return { sha: full, subject: (await this.d.checkpoints.get(p.id, full))?.subject ?? null };
    }
    const h = await this.head(p);
    if (!h) throw new PublishRefused("This project has no versions yet.", "no_versions", 409);
    return { sha: h.sha, subject: h.subject };
  }

  /** True when schema.ts declares tables beyond the template's users, sessions and connect_users. */
  hasAppTables(p: ProjectRef): boolean {
    const f = join(p.path, "server", "db", "schema.ts");
    if (!existsSync(f)) return false;
    return (readFileSync(f, "utf8").match(/\bsqliteTable\(/g) ?? []).length > 3;
  }

  // ---- scan ----------------------------------------------------------------

  private async visitorsOf(projectId: string): Promise<VisitorGrant> {
    return (await this.d.visitors?.(projectId).catch(() => VISITORS_OFF)) ?? VISITORS_OFF;
  }

  /** A scan answers for one sha under one visitor setting (a tick changes what blocks). */
  private scanKey(projectId: string, sha: string, v: VisitorGrant): string {
    return `${projectId}:${sha}:${v.enabled ? v.actions.join(",") : "off"}`;
  }

  async scan(p: ProjectRef, sha?: string): Promise<ScanResult> {
    const target = await this.resolveSha(p, sha);
    const visitors = await this.visitorsOf(p.id);
    this.emit(p.id, "scan", null, "files", "running");
    const set = await uploadSet(p.path, target.sha);
    this.emit(p.id, "scan", null, "files", "done", `${set.files.length} files`);
    const dir = join(this.d.home.stateFor(p.id), `scan-${target.sha.slice(0, 12)}`);
    const cleanup = materialize(set, dir, p.path);
    try {
      const installed = this.d.scopes.installed(p);
      const platforms = new Map<string, string | null>();
      for (const a of installed) if (!platforms.has(a.platform)) platforms.set(a.platform, (await this.d.catalog.platformInfo(a.platform).catch(() => null))?.connDefId ?? null);
      const lastPublished = await this.lastPublishedManifest(p);
      const { manifest } = await this.d.scopes.derive(p);
      const oneConnect = await this.d.connect.projectConnect(p.id);
      const describe = await this.d.scopes.describe([...manifest.actions, ...(lastPublished?.actions ?? [])]);
      const result = await runScan({
        dir,
        set,
        subject: target.subject,
        envFile: this.d.home.envFile,
        knowledge: (id) => this.d.catalog.cached(id),
        connDef: (slug) => platforms.get(slug) ?? null,
        lastPublished,
        describe,
        visitors,
        oneConnect: oneConnect.enabled,
        // The app's Connect app and Environment values: none may be in a file that leaves this computer.
        secretValues: [
          ...Object.entries((await this.d.connect.publishValues(p.id).catch(() => null))?.values ?? {}),
          ...Object.entries((await this.d.env?.projectValues(p.id, "publish").catch(() => ({}))) ?? {}),
        ].filter(([name]) => isSecretName(name)).map(([name, value]) => ({ name, value: String(value) })),
        audit: this.d.audit ?? false,
        pnpm: this.d.audit && this.d.pnpm ? await this.d.pnpm() : null,
        progress: (step, status, detail) => this.emit(p.id, "scan", null, step, status, detail),
      });
      this.scans.set(this.scanKey(p.id, target.sha, visitors), result);
      this.emit(p.id, "scan", null, "scan", result.ok ? "done" : "failed", `${result.blocks.length} blocking, ${result.warns.length} warnings`);
      return result;
    } finally {
      cleanup();
    }
  }

  // ---- publish -------------------------------------------------------------

  /** Starts a publish; resolves when the row exists. `done` resolves when it ends. */
  async publish(p: ProjectRef, body: PublishBody): Promise<{ record: PublishRecord; done: Promise<PublishRecord> }> {
    if (body.target !== "github" && body.target !== "vercel") throw new PublishRefused("Publish to github or vercel.", "bad_target", 400);
    if (this.running.has(p.id)) throw new PublishRefused("A publish is already running for this project.", "busy");
    const active = await this.d.activeTurn(p.id);
    if (active) throw new PublishRefused("The agent is working on this project. Publish when the turn ends.", "turn_running");
    const options = this.validate(body);
    const source = this.d.source;
    const cli = await source.status();
    if (!cli.installed) throw new PublishRefused(`Publishing runs on your own One account through the One CLI, which is not installed. Install it (${cli.installHint}) and sign in from Settings, One CLI.`, "no_cli", 409);
    if (!cli.signedIn) throw new PublishRefused("Publishing runs on your own One account through the One CLI. Sign in from Settings, One CLI, then publish.", "signed_out", 401);
    const name = body.target === "github" ? "GitHub" : "Vercel";
    const connected = await source.connections().catch(() => []);
    if (!connected.some((c) => c.platform === body.target)) throw new PublishRefused(`${name} is not connected to your One account. Run \`one add ${body.target}\` in a terminal, then publish.`, "not_connected", 409);

    const target = await this.resolveSha(p, body.sha);
    const scan = this.scans.get(this.scanKey(p.id, target.sha, await this.visitorsOf(p.id))) ?? (await this.scan(p, target.sha));
    if (!scan.ok) throw new PublishRefused(`The checks found ${scan.blocks.length} thing${scan.blocks.length === 1 ? "" : "s"} to fix before publishing.`, "scan_blocked", 409, scan);

    const [row] = await this.d.db
      .insert(publishes)
      .values({ projectId: p.id, target: body.target, sha: target.sha, status: "running", scan: scan as unknown as Record<string, unknown>, manifestHash: scan.manifestHash, options: this.keep(body), steps: [], grant: source.kind })
      .returning();
    const record = toPublishRecord(row!);
    const steps: PublishStep[] = [];
    const progress = (step: string, status: PublishStep["status"], detail?: string | null) => {
      const i = steps.findIndex((s) => s.step === step);
      const s = { step, status, detail: detail ?? null };
      if (i >= 0) steps[i] = s;
      else steps.push(s);
      this.emit(p.id, body.target, record.id, step, status, detail);
    };

    const run: ActionRunner = async (a: PublishAction, input) => {
      const t0 = Date.now();
      let r: RunAnswer;
      try {
        const out = await source.run({ platform: a.platform, actionId: a.actionId, title: a.title, method: a.method, path: a.path, pathParams: input.pathParams, body: input.body, query: input.query, headers: a.headers });
        r = { ok: out.ok, status: out.status, data: out.data, blockedByGrant: out.blockedByGrant };
      } catch (err) {
        r = { ok: false, status: 502, data: { message: `One did not answer: ${(err as Error).message}` } };
      }
      const label = source.kind === "sample" ? "sample" : "one";
      await this.d.activity.record(p.id, {
        platform: a.platform,
        actionId: a.actionId,
        title: a.title,
        method: a.method,
        path: a.path,
        source: "platform",
        status: r.status,
        ok: r.ok,
        blockedByGrant: Boolean(r.blockedByGrant),
        refusal: r.blockedByGrant ? { source: label, code: "blocked_by_grant" } : null,
        ms: Date.now() - t0,
      });
      return r;
    };

    const finish = async (patch: Partial<typeof publishes.$inferInsert>): Promise<PublishRecord> => {
      const [r] = await this.d.db.update(publishes).set({ ...patch, steps: steps as unknown as Record<string, unknown>[] }).where(eq(publishes.id, record.id)).returning();
      const out = toPublishRecord(r!);
      this.d.bus.emit(p.id, { type: "publish.done", publish: out });
      return out;
    };

    const work = (async (): Promise<PublishRecord> => {
      try {
        const set = await uploadSet(p.path, target.sha);
        if (body.target === "github") {
          const o = options as GitHubPublishOptions;
          const prev = await this.lastOk(p.id, "github");
          const pr = prev?.result as GitHubPublishResult | null;
          const cps = await this.d.checkpoints.list(p.id);
          const at = cps.findIndex((c) => c.sha === target.sha);
          const subjects = (at >= 0 ? cps.slice(at) : cps).filter((c) => c.kind !== "template").map((c) => c.subject);
          const result = await exportToGitHub({
            run,
            progress,
            files: set.files,
            skipped: set.skipped.map((s) => s.path),
            repo: o.repo,
            visibility: o.visibility,
            appName: p.name,
            slug: p.slug ?? o.repo,
            sha: target.sha,
            subjects,
            previous: pr ? { owner: pr.owner, repo: pr.repo, commitSha: pr.commitSha } : null,
          });
          return await finish({ status: "ok", url: result.url, repo: `${result.owner}/${result.repo}`, result: result as unknown as Record<string, unknown> });
        }
        const o = options as VercelPublishOptions;
        const prev = await this.lastOk(p.id, "vercel");
        const pr = prev?.result as VercelPublishResult | null;
        const stub = source.stub;
        const health = stub ? (url: string) => stub.health(url) : (this.d.fetchHealth ?? defaultHealth);
        // The app's Environment fills what the dialog left empty; the rest go as sensitive variables.
        const appEnv = { ...((await this.d.env?.projectValues(p.id, "publish").catch(() => ({}))) ?? {}) } as Record<string, string>;
        const take = (k: string) => {
          const v = appEnv[k];
          delete appEnv[k];
          return v || undefined;
        };
        // The app's own Connect app (per-project Connect): ids plain, the secret and connect key sensitive.
        const own = await this.d.connect.publishValues(p.id);
        const cv = own?.values ?? {};
        if (cv.ONE_CLIENT_SECRET) appEnv.ONE_CLIENT_SECRET = cv.ONE_CLIENT_SECRET;
        if (cv.ONE_CONNECT_KEY) appEnv.ONE_CONNECT_KEY = cv.ONE_CONNECT_KEY;
        const fromEnv = { clientId: cv.ONE_CLIENT_ID, permissionSet: cv.ONE_PERMISSION_SET, databaseUrl: take("DATABASE_URL"), databaseAuthToken: take("DATABASE_AUTH_TOKEN") };
        const result = await deployToVercel({
          run,
          progress,
          files: set.files,
          project: o.project,
          existingProjectId: pr && pr.projectName === o.project ? pr.projectId : null,
          clientId: o.clientId || fromEnv.clientId,
          permissionSet: o.permissionSet || fromEnv.permissionSet,
          databaseUrl: o.databaseUrl || fromEnv.databaseUrl,
          databaseAuthToken: o.databaseAuthToken || fromEnv.databaseAuthToken,
          appEnv,
          oneMode: own ? "connect" : "off",
          visitorActions: scan.visitorActions,
          health,
          pollMs: this.d.pollMs,
        });
        return await finish({ status: "ok", url: result.productionUrl, repo: result.projectName, result: result as unknown as Record<string, unknown> });
      } catch (err) {
        const e = err instanceof PublishError ? err : new PublishError((err as Error).message ?? "Publish stopped.", "publish");
        const failed = [...steps].reverse().find((s) => s.status === "running");
        if (failed) progress(failed.step, "failed", e.message);
        this.d.log?.(`publish ${body.target} ${record.id} failed at ${e.step}`);
        return finish({ status: "failed", error: e.message });
      } finally {
        this.running.delete(p.id);
      }
    })();
    this.running.set(p.id, work);
    return { record, done: work };
  }

  private validate(body: PublishBody): GitHubPublishOptions | VercelPublishOptions {
    const o = (body.options ?? {}) as unknown as Record<string, unknown>;
    if (body.target === "github") {
      const repo = String(o.repo ?? "").trim();
      const visibility = o.visibility === "public" ? "public" : "private";
      if (!repo) throw new PublishRefused("Name the repository.", "bad_options", 400);
      if (visibility === "public" && o.confirmPublic !== true) throw new PublishRefused("A public repository needs the confirmation in the dialog: anyone can see this code.", "public_unconfirmed", 400);
      return { repo, visibility, confirmPublic: visibility === "public" };
    }
    const project = String(o.project ?? "").trim();
    if (!project) throw new PublishRefused("Name the Vercel project.", "bad_options", 400);
    const clientId = typeof o.clientId === "string" ? o.clientId.trim() : "";
    const permissionSet = typeof o.permissionSet === "string" ? o.permissionSet.trim() : "";
    if (clientId && looksSecret(clientId)) throw new PublishRefused("That client id looks like a secret. Set secrets in Vercel yourself.", "looks_secret", 400);
    if (permissionSet && looksSecret(permissionSet)) throw new PublishRefused("That ask id looks like a secret.", "looks_secret", 400);
    const databaseUrl = typeof o.databaseUrl === "string" ? o.databaseUrl.trim() : "";
    if (databaseUrl) {
      const c = checkDatabaseUrl(databaseUrl);
      if (!c.ok) throw new PublishRefused(c.message!, "bad_database_url", 400);
    }
    const databaseAuthToken = typeof o.databaseAuthToken === "string" ? o.databaseAuthToken.trim() : "";
    return { project, clientId: clientId || undefined, permissionSet: permissionSet || undefined, databaseUrl: databaseUrl || undefined, databaseAuthToken: databaseAuthToken || undefined };
  }

  /** What the row keeps for next time. Never the database token; the URL only as its host. */
  private keep(body: PublishBody): Record<string, unknown> {
    if (body.target === "github") return { repo: body.options.repo.trim(), visibility: body.options.visibility === "public" ? "public" : "private" };
    const o = body.options;
    return {
      project: o.project.trim(),
      clientId: o.clientId?.trim() || null,
      permissionSet: o.permissionSet?.trim() || null,
      databaseHost: o.databaseUrl ? (checkDatabaseUrl(o.databaseUrl).host ?? null) : null,
      databaseToken: o.databaseAuthToken?.trim() ? "given once, not kept" : null,
    };
  }

  /** The app's One Connect as Publish shows it: on or off, which Connect app, the production redirect URI to register. */
  private async connectInfo(projectId: string): Promise<PublishesResponse["connect"]> {
    const c = await this.d.connect.projectConnect(projectId);
    const setup = c.setupId ? await this.d.connect.get(c.setupId) : null;
    const last = (await this.lastOk(projectId, "vercel"))?.result as VercelPublishResult | null;
    return { enabled: c.enabled, setupName: setup?.name ?? null, productionRedirectUri: last?.redirectUri ?? null };
  }

  /** Waits for the project's running publish, if any. */
  async idle(projectId: string): Promise<void> {
    await this.running.get(projectId)?.catch(() => {});
  }

  async response(p: ProjectRef): Promise<PublishesResponse> {
    const cli = await this.d.source.status();
    const usable = cli.installed && cli.signedIn;
    const connected = usable ? await this.d.catalog.granted().catch(() => []) : [];
    const info = async (slug: PublishTarget, connDef: string) => {
      const pi = await this.d.catalog.platformInfo(slug).catch(() => null);
      return { connected: connected.some((c) => c.platform === slug), name: pi?.name ?? (slug === "github" ? "GitHub" : "Vercel"), image: pi?.image ?? null, last: await this.lastOk(p.id, slug), connDef };
    };
    const gh = await info("github", GITHUB_CONN_DEF);
    const vc = await info("vercel", VERCEL_CONN_DEF);
    return {
      publishes: await this.list(p.id),
      grant: usable ? this.d.source.kind : null,
      cli,
      connect: await this.connectInfo(p.id),
      targets: {
        github: { connected: gh.connected, name: gh.name, image: gh.image, last: gh.last },
        vercel: { connected: vc.connected, name: vc.name, image: vc.image, last: vc.last, redirectUriFor: redirectUriFor("{project}") },
      },
      head: await this.head(p),
      hasAppTables: this.hasAppTables(p),
      busy: Boolean(await this.d.activeTurn(p.id)) || this.running.has(p.id),
    };
  }
}
